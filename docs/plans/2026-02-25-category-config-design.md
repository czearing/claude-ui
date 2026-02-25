# Category Config Page — Design

**Date:** 2026-02-25
**Status:** Approved

## Overview

A global Settings page that lets users create and edit task categories. Each category is a real Claude skill file written to `~/.claude/skills/`. When a task is handed to Claude, the server injects the matching skill content — so categories directly shape how Claude behaves on that task.

The page lives at `/settings`, outside the per-repo tree, because categories are global across all repos.

---

## Routing & Architecture

```
/settings
  app/settings/
    page.tsx          ← renders <SettingsPage />
    SettingsPage.tsx
    SettingsPage.module.css
```

The Sidebar's dead "Settings" `NavItem` navigates to `/settings` via `router.push('/settings')`. Since `/settings` is outside the `/repos/[repoId]/` tree, the Sidebar renders without a `repoId` on that page.

Layout: master/detail split, same visual pattern as Backlog + SpecEditor. Fixed ratio (no resizable divider). Left rail: `CategoryList`. Right panel: `CategoryEditor`. Empty right state when nothing is selected.

---

## Data Model

```ts
interface SkillCategory {
  name: string;     // filename without .md, e.g. "spec"
  content: string;  // raw markdown string
}
```

Skill files live at `path.join(os.homedir(), '.claude', 'skills')`. The server creates this directory if it doesn't exist.

Name validation: `/^[a-z0-9-]{1,64}$/` — prevents path traversal, enforces lowercase kebab-case.

---

## Server API

Five endpoints mounted under `/api/skills` in `server.ts`:

```
GET    /api/skills           → 200 { skills: { name: string }[] }
GET    /api/skills/:name     → 200 { name, content } | 404
POST   /api/skills           → 201 { name, content } | 400 | 409 (already exists)
PUT    /api/skills/:name     → 200 { name, content } | 404
DELETE /api/skills/:name     → 204 | 404
```

No other files in `server.ts` are touched.

---

## File Tree

```
src/
  app/
    settings/
      page.tsx
      SettingsPage.tsx
      SettingsPage.module.css
  components/
    Editor/
      LexicalEditor/
        LexicalEditor.tsx        ← add format?: "json" | "markdown" prop (backward-compatible)
        LexicalEditor.types.ts   ← add format to LexicalEditorProps
    Settings/
      CategoryList/
        CategoryList.tsx
        CategoryList.types.ts
        CategoryList.module.css
        index.ts
      CategoryEditor/
        CategoryEditor.tsx
        CategoryEditor.types.ts
        CategoryEditor.module.css
        index.ts
  hooks/
    useSkills.ts                 ← useQuery + useMutation hooks
    useSkills.types.ts
  utils/
    skills.client.ts             ← fetch wrappers for /api/skills
```

---

## Component Contracts

### LexicalEditor (extended)

Add `format?: "json" | "markdown"` to `LexicalEditorProps`. Default: `"json"` (no change to existing behavior).

When `format="markdown"`:
- `StateLoader` uses `$convertFromMarkdownString(value, TRANSFORMERS)` instead of `editor.parseEditorState(value)`
- `handleChange` uses `$convertToMarkdownString(TRANSFORMERS)` instead of `JSON.stringify(editorState.toJSON())`

`@lexical/markdown` is already installed and `TRANSFORMERS` is already imported — no new dependencies.

### CategoryList

```ts
interface CategoryListProps {
  categories: { name: string }[];
  selectedName: string | null;
  onSelect: (name: string) => void;
  onNew: () => void;
}
```

Scrollable left rail. "New Category" button at top. Each row shows the skill name. Selected row is highlighted. No drag-reorder.

### CategoryEditor

```ts
interface CategoryEditorProps {
  name: string;
  content: string;
  onChange: (content: string) => void;   // debounced 800ms → PUT /api/skills/:name
  onRename: (newName: string) => void;   // on blur/enter → POST new + DELETE old
  onDelete: () => void;
}
```

Top row: editable name input + delete button. Body: `<LexicalEditor format="markdown" value={content} onChange={onChange} />`.

### SettingsPage

Owns `selectedName: string | null` state. Fetches list via `useSkills()`. Fetches selected content via `useSkill(selectedName)`. Passes mutations down to `CategoryEditor`.

### Sidebar (minor change)

Wire the existing "Settings" `NavItem` `onClick` to `router.push('/settings')`. When `currentView` is undefined (on the settings page), no nav item is highlighted active — or add `"Settings"` to the `View` union.

---

## Hooks

- `useSkills()` — `useQuery(['skills'])` → `GET /api/skills`
- `useSkill(name)` — `useQuery(['skills', name])` → `GET /api/skills/:name`
- `useCreateSkill()` — `useMutation` → `POST /api/skills`
- `useUpdateSkill()` — `useMutation` → `PUT /api/skills/:name`
- `useDeleteSkill()` — `useMutation` → `DELETE /api/skills/:name`

All follow the existing `useTasks` pattern exactly.

---

## Styling

All CSS uses existing design tokens from `global.css`:
- `--color-bg`, `--color-surface`, `--color-border`, `--color-text`, `--color-text-muted`
- `--space-*`, `--radius-*`, `--text-*`
- No new tokens needed. No hardcoded hex values in component CSS.
- `clsx` for all conditional class composition.
- Every component accepts a `className` prop merged last.

---

## Agent Team & Contracts

### Agent 1 — Backend Engineer
Owns `server.ts` only. Implements the five `/api/skills` endpoints per the API contract above. Done when all five endpoints return correct status codes with real files written to `~/.claude/skills/` on disk.

### Agent 2 — Frontend Engineer
Owns: LexicalEditor `format` extension, all Settings components, hooks, utils, SettingsPage, Sidebar wiring. Works from the component contracts above. No new npm dependencies. Uses mock data from `skills.client.ts` if Backend isn't ready.

### Agent 3 — Code Reviewer
Reviews Agent 1 & 2 output against this document. Checks: API contract matches exactly, name validation present, no path traversal risk, LexicalEditor `format` prop is backward-compatible, CSS uses only design tokens, folder structure matches spec, no new dependencies.

### Agent 4 — Test Writer
Runs after review is approved. Writes:
- `useSkills.test.ts` — mock fetch, assert query/mutation behavior
- `CategoryEditor.test.tsx` — renders with content, fires onChange
- `CategoryList.test.tsx` — renders list, highlights selected, fires onSelect

Does not touch implementation files. Reports bugs back to the relevant agent.
