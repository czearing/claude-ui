# Multi-Repo Workspaces Design

**Date:** 2026-02-24
**Status:** Approved

## Overview

Add support for multiple git repos as isolated workspaces. Each repo has its own board and task list. Switching between repos does not affect actively running Claude instances. The active repo is encoded in the URL, making it bookmarkable and multi-tab safe.

---

## Data Model & Storage

### `repos.json` (new file, project root)

```typescript
interface Repo {
  id: string; // stable UUID
  name: string; // user-defined display name (e.g. "Frontend")
  path: string; // absolute path on disk (e.g. "/Users/caleb/code/my-app")
  createdAt: string; // ISO 8601
}
```

### `tasks.json` (updated)

Every task gains a `repoId: string` field. Existing tasks are migrated to `repoId: "default"` on first boot.

### Default repo

On first boot, if `repos.json` is empty, the server auto-creates a default repo using `process.cwd()` as the path and `"Default"` as the name. Existing tasks are assigned its ID. Zero migration friction.

---

## Server API Changes

### New endpoints

```
GET    /api/repos          — list all repos
POST   /api/repos          — create repo { name, path }
PATCH  /api/repos/:id      — update name or path
DELETE /api/repos/:id      — remove repo (tasks remain, orphaned by repoId)
```

### Updated endpoints

```
GET /api/tasks?repoId=:id  — filter tasks by repo
```

### PTY spawning

`POST /api/tasks/:id/handover` looks up the task's `repoId`, resolves the repo's `path`, and passes it as `cwd` to `pty.spawn`. Previously hardcoded to `process.cwd()`.

### Path validation

`POST /api/repos` and `PATCH /api/repos/:id` validate that the path exists on disk via `fs.existsSync`. Returns `400` with a descriptive error message on failure.

### Board WebSocket new events

- `repo:created` — broadcast when a repo is added
- `repo:deleted` — broadcast when a repo is removed

---

## Routing Structure

| Route                                 | Description                                                                |
| ------------------------------------- | -------------------------------------------------------------------------- |
| `/`                                   | Redirects to `/repos/[firstRepoId]`, or repo picker if no repos configured |
| `/repos/[repoId]`                     | Board/backlog view scoped to that repo                                     |
| `/repos/[repoId]/session/[sessionId]` | Terminal session                                                           |

### Migration

The existing `/session/[id]` route redirects to `/repos/[repoId]/session/[id]` using the `repoId` stored on the task, preserving any bookmarked session URLs.

### Navigation flow

- Sidebar repo dropdown selection → `router.push('/repos/[repoId]')`
- Launching a session from a task → `router.push('/repos/[repoId]/session/[sessionId]')`
- Back button on session page → returns to `/repos/[repoId]`

`[repoId]` is read via `useParams()` in `AppShell` and passed to all task queries and mutations to scope them to the active repo.

---

## Sidebar UI

### Brand lockup (static)

The "Claude Code" wordmark + kanban icon remains fixed at the top of the sidebar. It never changes regardless of the active repo.

### RepoSwitcher (below brand)

A button showing the active repo name with a chevron. Clicking opens a Radix `DropdownMenu`:

- List of all configured repos — active repo has a checkmark
- Divider
- "Add repo" item with a `+` icon

Selecting a repo navigates to `/repos/[repoId]`.
Selecting "Add repo" opens a Radix `Dialog` (`AddRepoDialog`).

### AddRepoDialog

Fields:

- **Name** — text input, required
- **Path** — text input, required, validated on submit

On success: calls `POST /api/repos`, closes dialog, navigates to the new repo's board.
On path validation failure: inline error below the path field (no toast).

---

## New Components

All follow the standard folder convention (`ComponentName.tsx`, `.types.ts`, `.module.css`, `index.ts`).

```
src/components/Layout/Sidebar/
  RepoSwitcher/
    RepoSwitcher.tsx
    RepoSwitcher.types.ts
    RepoSwitcher.module.css
    index.ts
    AddRepoDialog/
      AddRepoDialog.tsx
      AddRepoDialog.types.ts
      AddRepoDialog.module.css
      index.ts
```

### New hook

`useRepos` — TanStack Query `useQuery` for `GET /api/repos`. Lives at `src/hooks/useRepos.ts`.

### New util types

`Repo` interface added to `src/utils/tasks.types.ts` (or a new `src/utils/repos.types.ts`).

---

## Key Constraints

- Switching repos never kills or pauses running Claude instances — sessions are tied to `sessionId`, not the active repo URL
- Tasks are never deleted when a repo is removed — they become orphaned (repoId points to a deleted repo) and are simply not shown
- No multi-select or bulk-move of tasks between repos in v1
