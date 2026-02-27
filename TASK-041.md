---
id: TASK-041
title: Refactor spec status tracking to file-folder-based workflow
status: Backlog
priority: Medium
repoId: 62560362-7fdf-469d-b510-77a86b9ceaeb
createdAt: 2026-02-26T21:51:56.201Z
updatedAt: 2026-02-26T21:51:56.201Z
---

# Refactor Spec Status Tracking to File-Folder-Based Workflow

## Overview

Replace the current server-side spec status tracking (frontmatter `status:` field + complex PTY idle detection + internal API callbacks) with a simple file-folder-based system where a task's status is determined entirely by which subdirectory its markdown file lives in. Claude Code itself moves spec files between folders as it picks up and completes work, eliminating fragile server-side state inference.

---

## Motivation

The current system has produced several real bugs (see: "tasks stuck in In Progress due to spec injection and session recovery bugs"). It requires:

- Idle timeout detection to guess when Claude is done
- Multi-phase handover state machine (`waiting_for_prompt` -> `spec_sent` -> `done`)
- Internal API calls from pty-manager back to server to advance task status
- Startup recovery logic to fix tasks that got stuck
- Complex `parseClaudeStatus` to infer Claude state from PTY output characters

The file-folder approach eliminates all of this. The spec file location IS the status. No inference needed.

---

## New Folder Structure

```
specs/
  {repoId}/
    backlog/
      TASK-001.md      <- awaiting agent pickup
    in-progress/
      TASK-002.md      <- agent is actively working
    review/
      TASK-003.md      <- agent finished, awaiting human review
    done/
      TASK-004.md      <- archived/completed
```

All four status folders must be created when a repo is first set up.

---

## What Changes

### 1. File / Frontmatter Schema

**Remove** the `status` field from task frontmatter entirely. Status is now implicit from folder location.

**Before:**

```yaml
---
id: TASK-001
title: Add dark mode
status: In Progress
priority: Medium
repoId: abc-123
sessionId: sess-456
createdAt: 2025-01-01T00:00:00Z
updatedAt: 2025-01-02T00:00:00Z
---
```

**After:**

```yaml
---
id: TASK-001
title: Add dark mode
priority: Medium
repoId: abc-123
sessionId: sess-456
createdAt: 2025-01-01T00:00:00Z
updatedAt: 2025-01-02T00:00:00Z
---
```

No other frontmatter fields change. `sessionId` remains (needed to associate PTY sessions with tasks).

---

### 2. Data Migration

On server startup (in `ensureDefaultRepo()` / `recoverInProgressTasks()`), run a one-time migration:

1. For each repo, create the four status subdirectories if they do not exist: `backlog/`, `in-progress/`, `review/`, `done/`
2. Scan the flat `specs/{repoId}/` directory for any `TASK-*.md` files not yet in a subfolder
3. Read their current `status` frontmatter field
4. Move each file to the appropriate subfolder based on its status value:
   - `Backlog` -> `backlog/`
   - `Not Started` -> `backlog/`
   - `In Progress` -> `in-progress/`
   - `Review` -> `review/`
   - `Done` -> `done/`
5. Rewrite the file without the `status` field after moving
6. Log migration results to console

Migration must be idempotent: if a file is already in a subfolder, skip it.

---

### 3. `src/server/taskStore.ts` - Full Rewrite

**`getStatusFolder(status: TaskStatus): string`** - new helper:

- Maps `TaskStatus` enum -> folder name string

**`getTaskFilePath(repoId, taskId): Promise<string | null>`** - replaces direct path construction:

- Scans all 4 status folders to find the file
- Returns absolute path or null if not found
- Cache the location to avoid repeated scans

**`readTask(repoId, taskId)`**:

- Use `getTaskFilePath` to locate file
- Parse without `status` field; derive status from folder name
- Inject `status` into returned Task object at read time

**`writeTask(repoId, task)`**:

- Determine current file location via `getTaskFilePath`
- Determine target folder from `task.status`
- If folders differ: `fs.rename(currentPath, targetPath)` - this is atomic on same filesystem
- Serialize frontmatter WITHOUT `status` field
- Write content to target path
- Update cache

**`deleteTaskFile(repoId, taskId)`**:

- Use `getTaskFilePath` to locate, then delete

**`readAllTasksForRepo(repoId)`**:

- Scan all 4 status subdirectories
- For each file found, parse and inject status from folder name
- Return merged array

**`ensureRepoFolders(repoId)`** - new helper:

- Creates `backlog/`, `in-progress/`, `review/`, `done/` under `specs/{repoId}/`
- Called on repo creation and on startup

**`createTask(repoId, task)`**:

- Always write new tasks to `backlog/` subfolder

---

### 4. `src/utils/taskFile.ts` - Remove Status from Serialization

- Remove `status` from `parseTaskFile()` return object (status derived from path externally)
- Remove `status` from `serializeTaskFile()` input (never written to frontmatter)
- Add a `deriveStatusFromPath(filePath: string): TaskStatus` utility that extracts folder name and maps to `TaskStatus`

---

### 5. `src/utils/tasks.types.ts` - No Breaking Changes

Keep `TaskStatus` enum as-is - it is still used at runtime, just no longer serialized to file frontmatter. The enum values map to folder names:

- `"Backlog"` <-> `backlog/`
- `"In Progress"` <-> `in-progress/`
- `"Review"` <-> `review/`
- `"Done"` <-> `done/`

---

### 6. `server.ts` - Simplify Startup Recovery

**`recoverInProgressTasks()`** becomes trivial:

- Scan `specs/*/in-progress/*.md` across all repos
- For each file, check if the `sessionId` frontmatter field is in the live PTY sessions list
- If session is dead: `fs.rename` file from `in-progress/` -> `review/`, broadcast `task:updated`
- No longer needs to load ALL tasks and filter by status field

**`ensureDefaultRepo()`**:

- Call `ensureRepoFolders(repoId)` after creating repo
- Run migration logic for pre-existing flat spec files

---

### 7. `src/server/routes/tasks.ts` - Status Changes Become File Moves

**`PATCH /api/tasks/:id`**:

- When `status` is in the patch payload: call `writeTask` which handles the rename atomically
- No special-casing needed; the move IS the status update

**`POST /api/tasks/:id/handover`**:

- Move file: `backlog/TASK-001.md` -> `in-progress/TASK-001.md` (via `writeTask` with status="In Progress")
- Spawn PTY session with spec content + file movement instructions in prompt
- Update system prompt to reference file location (see Section 9)

**`POST /api/tasks/:id/recall`**:

- Move file: `in-progress/TASK-001.md` -> `backlog/TASK-001.md` (via `writeTask` with status="Backlog")
- Kill PTY session as before

**`POST /api/internal/sessions/:id/advance-to-review`**:

- Keep as a fallback for server-side status advance
- Primary path is Claude moving the file itself (see Section 9)

**`POST /api/tasks` (create)**:

- Writes to `backlog/` subfolder

---

### 8. Filesystem Watcher - New Feature

Add `chokidar` filesystem watching on the `specs/` directory to detect when Claude moves files:

```typescript
// In server.ts or a new src/server/specWatcher.ts
import chokidar from "chokidar";

chokidar
  .watch("specs/**/*.md", { ignoreInitial: true })
  .on("add", handleSpecFileAdded)
  .on("unlink", handleSpecFileRemoved);
```

**`handleSpecFileAdded(filePath)`**:

- Parse the folder path to determine new status
- Load task from the new path
- If status changed (file appeared in new folder): broadcast `task:updated`
- This fires when Claude moves a file INTO a folder

**`handleSpecFileRemoved(filePath)`**:

- Parse the folder path to determine which task was moved OUT of a folder
- The corresponding `add` event for the destination will handle the update
- Only act if no corresponding `add` fires within 500ms (file was deleted, not moved)

This allows the board to update in real time when Claude moves spec files, without any PTY output monitoring.

---

### 9. System Prompt / Handover Prompt Changes

Update the prompt sent to Claude on handover to include explicit file movement instructions.

**New handover prompt format:**

```
{original spec content}

---
TASK FILE MANAGEMENT:
Your task spec file is located at: specs/{repoId}/in-progress/{taskId}.md

When you have completed all work on this task, move the spec file to the review folder:
  From: specs/{repoId}/in-progress/{taskId}.md
  To:   specs/{repoId}/review/{taskId}.md

You can use the Bash tool or any file operation to perform this move.
Do not modify the contents of the spec file. Only move it.
```

This replaces the current mechanism where the server infers completion from PTY idle timeout. Claude explicitly signals completion by moving the file.

---

### 10. `pty-manager.ts` - Simplify Handover Phase

**Remove:**

- `handoverPhase` tracking entirely (`"waiting_for_prompt"` | `"spec_sent"` | `"done"`)
- `specSentAt` timestamp
- `SPEC_ECHO_WINDOW_MS` window (3000ms)
- Spec injection via PTY stdin (bracketed paste injection)
- The multi-phase detection in `ptyHandlers.ts`

**Keep:**

- `-p` flag spec passing to Claude CLI (simplest, most reliable)
- Session spawning logic
- Output buffering for terminal replay

**New approach:**

- Spec content + file movement instructions passed via `-p` flag as before
- Server watches filesystem for file moves instead of monitoring PTY output for idle signals

---

### 11. Dead Files / Code to Remove or Gut

| File                                                  | Action                         | Reason                                                                                                                             |
| ----------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `src/server/ptyHandlers.ts`                           | **Delete**                     | Entire file is handover phase state machine - replaced by fs watcher                                                               |
| `src/utils/parseClaudeStatus.ts`                      | **Delete or gut**              | Status inference from PTY chars no longer drives task transitions. May keep for UI status indicator but remove from state machine. |
| `SPEC_ECHO_WINDOW_MS` constant in `ptyStore.ts`       | **Remove**                     | No longer echo-suppressing startup                                                                                                 |
| `handoverPhase` field in `SessionEntry`               | **Remove**                     | No longer tracking phases                                                                                                          |
| `hadMeaningfulActivity` field in `SessionEntry`       | **Remove**                     | No longer used for advance-to-review trigger                                                                                       |
| `lastMeaningfulStatus` field in `SessionEntry`        | **Remove**                     | No longer used                                                                                                                     |
| `specSentAt` field in `SessionEntry`                  | **Remove**                     | No longer used                                                                                                                     |
| `scheduleIdleStatus()` in `ptyStore.ts`               | **Remove**                     | Idle detection for task advancement eliminated                                                                                     |
| `advanceToReview()` in `ptyStore.ts`                  | **Remove or keep as fallback** | Primary path is now fs watcher                                                                                                     |
| `POST /api/internal/sessions/:id/back-to-in-progress` | **Remove**                     | No longer needed                                                                                                                   |
| Status field parsing in `taskFile.ts`                 | **Remove**                     | Status derived from path, not frontmatter                                                                                          |
| `tasks.json.bak`                                      | **Delete file**                | Legacy migration file, superseded                                                                                                  |

---

### 12. Unit Tests to Add/Update

#### `taskStore.test.ts`

- `getTaskFilePath` - finds file across all 4 status folders, returns null when not found
- `readTask` - correctly derives status from folder location, not frontmatter
- `writeTask` - moves file between status folders when status changes, no-op when status unchanged
- `writeTask` - does NOT write `status` field to frontmatter
- `readAllTasksForRepo` - aggregates across all 4 subdirectories
- `ensureRepoFolders` - creates all 4 subdirs
- Migration - moves flat files to correct subdirs, removes status from frontmatter after move

#### `taskFile.test.ts`

- `parseTaskFile` - does not return `status` field (removed from schema)
- `serializeTaskFile` - does not write `status` field to frontmatter
- `deriveStatusFromPath` - correctly maps folder names to `TaskStatus` enum values

#### `specWatcher.test.ts` - New file

- File move from `in-progress/` -> `review/` triggers `task:updated` broadcast
- File move from `backlog/` -> `in-progress/` triggers `task:updated` broadcast
- File deletion does NOT trigger `task:updated`
- Initial scan on startup does NOT trigger spurious events (`ignoreInitial: true`)
- Multiple rapid moves debounce correctly (no duplicate broadcasts)

#### `routes/tasks.test.ts`

- `PATCH /api/tasks/:id` with status change causes file to be in correct subfolder on disk
- `POST /api/tasks` creates file in `backlog/` subfolder on disk
- `POST /api/tasks/:id/handover` moves file to `in-progress/` subfolder, sets sessionId
- `POST /api/tasks/:id/recall` moves file back to `backlog/`, clears sessionId
- Handover with empty spec skips to `review/` directly (existing behavior preserved)

#### `migration.test.ts` - New file

- Flat `TASK-*.md` files in `specs/{repoId}/` are moved to correct subfolder based on `status` frontmatter
- Migrated files no longer contain `status` field in frontmatter
- Migration is idempotent (running twice produces same result)
- Tasks with unknown status default to `backlog/`
- Migration logs counts of files moved per status

#### Delete these test files entirely:

- `ptyHandlers.test.ts` (1111 lines) - module is being deleted

---

### 13. E2E Tests to Add

#### `spec-folder-movement.spec.ts` - New file

**Setup**: Use fixtures that create real spec files on disk in the correct folder structure

- **"task appears in correct board column based on folder location"**: Place a file in `in-progress/`, verify it shows in the In Progress column without any API call
- **"moving file to review/ updates board without page reload"**: Move file programmatically via `fs.rename`, verify board WebSocket broadcasts update and card appears in Review column within 2 seconds
- **"creating task via UI writes file to backlog/ folder"**: Create task via UI, verify file exists at `specs/{repoId}/backlog/TASK-{n}.md`
- **"handover moves file from backlog/ to in-progress/"**: Click Send to Agent, verify file moved to `in-progress/` subfolder on disk
- **"recall moves file from in-progress/ to backlog/"**: Recall a task, verify file moved back to `backlog/` subfolder on disk
- **"Claude moving file to review/ updates board in real time"**: Simulate Claude file move via test helper, assert board updates without server restart

#### `spec-migration.spec.ts` - New file

- **"server migrates flat spec files on startup"**: Place flat `TASK-*.md` files with various status values in `specs/{repoId}/`, restart server, verify files are in correct subfolders and frontmatter no longer contains `status` field

#### `board.spec.ts` - Update existing

- Remove any assertions that check frontmatter `status` field directly
- Add assertions that verify board column assignment matches folder location (not status field)

#### `handover.spec.ts` - Update existing

- Verify spec file is in `in-progress/` folder after handover (not just that status API returns "In Progress")
- Verify spec file is in `backlog/` folder after recall
- Verify spec file moves to `review/` when Claude completes (file moved, not server-inferred)

#### `task-lifecycle.spec.ts` - Update existing

- Full lifecycle asserts file location at each step: `backlog/` -> `in-progress/` -> `review/` -> `done/`
- Verify no `status` field in frontmatter at any point in lifecycle

---

### 14. Board UI Changes

No significant UI changes required. The board already groups by `task.status`; the status value is now derived server-side from the file folder location and returned identically through the existing API/WebSocket events.

---

### 15. Acceptance Criteria

- [ ] All existing spec files are automatically migrated to subfolders on server restart
- [ ] No task file contains a `status` frontmatter field after migration
- [ ] Moving a spec file manually between subfolders causes the board to update within 2 seconds (no page reload)
- [ ] Claude Code moving a file from `in-progress/` to `review/` via its Bash tool causes the board to show the task in Review column
- [ ] Handover writes file to `in-progress/` folder
- [ ] Task creation writes file to `backlog/` folder
- [ ] Startup recovery scans `in-progress/` folder and moves stale tasks to `review/`
- [ ] All unit tests pass
- [ ] All e2e tests pass
- [ ] `ptyHandlers.ts` is deleted
- [ ] No references to `handoverPhase`, `hadMeaningfulActivity`, `scheduleIdleStatus`, or `SPEC_ECHO_WINDOW_MS` remain in the codebase
- [ ] `tasks.json.bak` is deleted
