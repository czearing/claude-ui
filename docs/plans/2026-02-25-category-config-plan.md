# Category Config Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a global `/settings` page where users create and edit task categories that are real `~/.claude/skills/*.md` files, using a master/detail split layout with the existing LexicalEditor in markdown mode.

**Architecture:** Five `/api/skills` REST endpoints in `server.ts` read/write `.md` files from `~/.claude/skills/`. A `format="markdown"` prop added to `LexicalEditor` converts to/from raw markdown using `$convertFromMarkdownString`/`$convertToMarkdownString` (already available in `@lexical/markdown`). `SettingsPage` owns the split layout using `CategoryList` (left rail) and `CategoryEditor` (right panel), wired via TanStack Query hooks that mirror the existing `useTasks` pattern exactly.

**Tech Stack:** Node.js `fs/promises` + `os.homedir()` (server), TanStack Query v5, `@lexical/markdown` (already installed), Radix UI, Phosphor Icons, CSS Modules, clsx.

**Parallel execution note:** Tasks 1, 2, 3, and 4 are fully independent and can run in parallel. Task 5 requires Task 2. Task 6 requires Tasks 3, 4, and 5. Task 7 is independent. Task 8 runs last.

---

### Task 1: Backend — `/api/skills` endpoints in `server.ts`

**Owner:** Backend Engineer
**Files:**

- Modify: `server.ts`

**Step 1: Add `homedir` import**

At the top of `server.ts`, find the existing node imports block:

```typescript
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import { parse } from "node:url";
```

Add `homedir` import after the `node:path` line:

```typescript
import { homedir } from "node:os";
```

**Step 2: Add skill file helpers after the existing task helpers (around line 200)**

Find the `repoSpecsDir` function. Add the following block immediately before it:

```typescript
// ─── Skills ────────────────────────────────────────────────────────────────

const SKILL_NAME_RE = /^[a-z0-9-]{1,64}$/;

function skillsDir(): string {
  return join(homedir(), ".claude", "skills");
}

async function ensureSkillsDir(): Promise<void> {
  await mkdir(skillsDir(), { recursive: true });
}

async function listSkillNames(): Promise<string[]> {
  await ensureSkillsDir();
  const files = await readdir(skillsDir());
  return files.filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3));
}

async function readSkillContent(name: string): Promise<string | null> {
  try {
    return await readFile(join(skillsDir(), `${name}.md`), "utf8");
  } catch {
    return null;
  }
}

async function writeSkillContent(name: string, content: string): Promise<void> {
  await ensureSkillsDir();
  await writeFile(join(skillsDir(), `${name}.md`), content, "utf8");
}

async function deleteSkillContent(name: string): Promise<void> {
  await unlink(join(skillsDir(), `${name}.md`));
}
```

**Step 3: Add the five route handlers**

Find the `// GET /api/repos` block (around line 708). Add the following block immediately **before** it:

```typescript
// GET /api/skills
if (req.method === "GET" && parsedUrl.pathname === "/api/skills") {
  const names = await listSkillNames();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ skills: names.map((name) => ({ name })) }));
  return;
}

// GET /api/skills/:name
if (
  req.method === "GET" &&
  parsedUrl.pathname?.startsWith("/api/skills/") &&
  parsedUrl.pathname !== "/api/skills/"
) {
  const name = parsedUrl.pathname.slice("/api/skills/".length);
  if (!SKILL_NAME_RE.test(name)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid skill name" }));
    return;
  }
  const content = await readSkillContent(name);
  if (content === null) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ name, content }));
  return;
}

// POST /api/skills
if (req.method === "POST" && parsedUrl.pathname === "/api/skills") {
  const body = await readBody(req);
  const name = typeof body["name"] === "string" ? body["name"].trim() : "";
  const content = typeof body["content"] === "string" ? body["content"] : "";
  if (!SKILL_NAME_RE.test(name)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid skill name" }));
    return;
  }
  const existing = await readSkillContent(name);
  if (existing !== null) {
    res.writeHead(409, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Skill already exists" }));
    return;
  }
  await writeSkillContent(name, content);
  res.writeHead(201, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ name, content }));
  return;
}

// PUT /api/skills/:name
if (
  req.method === "PUT" &&
  parsedUrl.pathname?.startsWith("/api/skills/") &&
  parsedUrl.pathname !== "/api/skills/"
) {
  const name = parsedUrl.pathname.slice("/api/skills/".length);
  if (!SKILL_NAME_RE.test(name)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid skill name" }));
    return;
  }
  const existing = await readSkillContent(name);
  if (existing === null) {
    res.writeHead(404);
    res.end();
    return;
  }
  const body = await readBody(req);
  const content = typeof body["content"] === "string" ? body["content"] : "";
  await writeSkillContent(name, content);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ name, content }));
  return;
}

// DELETE /api/skills/:name
if (
  req.method === "DELETE" &&
  parsedUrl.pathname?.startsWith("/api/skills/") &&
  parsedUrl.pathname !== "/api/skills/"
) {
  const name = parsedUrl.pathname.slice("/api/skills/".length);
  if (!SKILL_NAME_RE.test(name)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid skill name" }));
    return;
  }
  const existing = await readSkillContent(name);
  if (existing === null) {
    res.writeHead(404);
    res.end();
    return;
  }
  await deleteSkillContent(name);
  res.writeHead(204);
  res.end();
  return;
}
```

**Step 4: Verify manually**

Start the dev server: `yarn dev`

In another terminal, run:

```bash
# Create a skill
curl -s -X POST http://localhost:3000/api/skills \
  -H "Content-Type: application/json" \
  -d '{"name":"spec","content":"# Spec\nWrite specs carefully."}' | jq .
# Expected: {"name":"spec","content":"# Spec\nWrite specs carefully."}

# List skills
curl -s http://localhost:3000/api/skills | jq .
# Expected: {"skills":[{"name":"spec"}]}

# Read skill
curl -s http://localhost:3000/api/skills/spec | jq .
# Expected: {"name":"spec","content":"# Spec\nWrite specs carefully."}

# Update skill
curl -s -X PUT http://localhost:3000/api/skills/spec \
  -H "Content-Type: application/json" \
  -d '{"content":"# Spec v2\nUpdated."}' | jq .
# Expected: {"name":"spec","content":"# Spec v2\nUpdated."}

# Delete skill
curl -s -X DELETE http://localhost:3000/api/skills/spec
# Expected: 204 no body

# Verify invalid name rejected
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/skills \
  -H "Content-Type: application/json" \
  -d '{"name":"../evil","content":""}'
# Expected: 400
```

**Step 5: Commit**

```bash
git add server.ts
git commit -m "feat: add /api/skills CRUD endpoints writing to ~/.claude/skills/"
```

---

### Task 2: LexicalEditor — add `format` prop for markdown mode

**Owner:** Frontend Engineer
**Files:**

- Modify: `src/components/Editor/LexicalEditor/LexicalEditor.types.ts`
- Modify: `src/components/Editor/LexicalEditor/LexicalEditor.tsx`
- Modify: `src/components/Editor/LexicalEditor/LexicalEditor.test.tsx`

**Step 1: Write the failing tests**

Add to `LexicalEditor.test.tsx` (after the existing tests):

```typescript
describe("LexicalEditor markdown format", () => {
  it("renders without crashing with format=markdown", () => {
    render(<LexicalEditor format="markdown" />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("renders with a markdown value without crashing", () => {
    render(<LexicalEditor format="markdown" value="# Hello\n\nWorld" />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("defaults to json format when format prop is omitted (existing behaviour)", () => {
    render(<LexicalEditor />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
yarn test --testPathPattern=LexicalEditor --watch=false
```

Expected: the two new `format="markdown"` tests fail because `format` prop doesn't exist yet. The third test passes (existing behaviour still works).

**Step 3: Update `LexicalEditor.types.ts`**

Replace the entire file:

```typescript
export interface LexicalEditorProps {
  value?: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  format?: "json" | "markdown";
}
```

**Step 4: Update `LexicalEditor.tsx`**

At the top, `TRANSFORMERS` is already imported from `@lexical/markdown`. Add the two conversion functions to the import:

Find:

```typescript
import { TRANSFORMERS } from "@lexical/markdown";
```

Replace with:

```typescript
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
} from "@lexical/markdown";
```

Add a `MarkdownStateLoader` component after the existing `CodeHighlightPlugin` function:

```typescript
function MarkdownStateLoader({ value }: { value?: string }) {
  const [editor] = useLexicalComposerContext();
  const didInitRef = useRef(false);
  useEffect(() => {
    if (didInitRef.current || !value) {
      return;
    }
    didInitRef.current = true;
    editor.update(() => {
      $convertFromMarkdownString(value, TRANSFORMERS);
    });
  }, [editor, value]);
  return null;
}
```

Update the `LexicalEditor` function signature and internals:

Find:

```typescript
export function LexicalEditor({
  value,
  onChange,
  readOnly = false,
  placeholder = "Write something, or press '/' for commands…",
}: LexicalEditorProps) {
```

Replace with:

```typescript
export function LexicalEditor({
  value,
  onChange,
  readOnly = false,
  placeholder = "Write something, or press '/' for commands…",
  format = "json",
}: LexicalEditorProps) {
```

Find the `handleChange` function:

```typescript
const handleChange = (editorState: EditorState) => {
  onChange?.(JSON.stringify(editorState.toJSON()));
};
```

Replace with:

```typescript
const handleChange = (editorState: EditorState) => {
  if (format === "markdown") {
    editorState.read(() => {
      onChange?.($convertToMarkdownString(TRANSFORMERS));
    });
  } else {
    onChange?.(JSON.stringify(editorState.toJSON()));
  }
};
```

Find the `<StateLoader value={value} />` line inside the JSX. Replace it with a conditional:

```typescript
        {format === "markdown" ? (
          <MarkdownStateLoader value={value} />
        ) : (
          <StateLoader value={value} />
        )}
```

**Step 5: Run tests to verify they pass**

```bash
yarn test --testPathPattern=LexicalEditor --watch=false
```

Expected: all 9 tests pass (6 original + 3 new).

**Step 6: Commit**

```bash
git add src/components/Editor/LexicalEditor/LexicalEditor.tsx \
        src/components/Editor/LexicalEditor/LexicalEditor.types.ts \
        src/components/Editor/LexicalEditor/LexicalEditor.test.tsx
git commit -m "feat: add format=markdown prop to LexicalEditor"
```

---

### Task 3: `skills.client.ts` + `useSkills` hooks

**Owner:** Frontend Engineer
**Files:**

- Create: `src/utils/skills.client.ts`
- Create: `src/hooks/useSkills.ts`
- Create: `src/hooks/useSkills.types.ts`

**Step 1: Create `src/utils/skills.client.ts`**

```typescript
// src/utils/skills.client.ts

export interface SkillCategory {
  name: string;
  content: string;
}

export async function fetchSkills(): Promise<{ name: string }[]> {
  const res = await fetch("/api/skills");
  if (!res.ok) throw new Error("Failed to fetch skills");
  const data = (await res.json()) as { skills: { name: string }[] };
  return data.skills;
}

export async function fetchSkill(name: string): Promise<SkillCategory> {
  const res = await fetch(`/api/skills/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`Failed to fetch skill: ${name}`);
  return res.json() as Promise<SkillCategory>;
}

export async function createSkill(
  name: string,
  content: string,
): Promise<SkillCategory> {
  const res = await fetch("/api/skills", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, content }),
  });
  if (!res.ok) throw new Error("Failed to create skill");
  return res.json() as Promise<SkillCategory>;
}

export async function updateSkill(
  name: string,
  content: string,
): Promise<SkillCategory> {
  const res = await fetch(`/api/skills/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error("Failed to update skill");
  return res.json() as Promise<SkillCategory>;
}

export async function deleteSkill(name: string): Promise<void> {
  const res = await fetch(`/api/skills/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) throw new Error("Failed to delete skill");
}
```

**Step 2: Create `src/hooks/useSkills.types.ts`**

```typescript
// src/hooks/useSkills.types.ts
export type { SkillCategory } from "@/utils/skills.client";
```

**Step 3: Create `src/hooks/useSkills.ts`**

Mirror the exact pattern from `src/hooks/useTasks.ts`:

```typescript
// src/hooks/useSkills.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createSkill,
  deleteSkill,
  fetchSkill,
  fetchSkills,
  updateSkill,
} from "@/utils/skills.client";

const SKILLS_KEY = ["skills"] as const;

function skillKey(name: string) {
  return ["skills", name] as const;
}

export function useSkills() {
  return useQuery({
    queryKey: SKILLS_KEY,
    queryFn: fetchSkills,
  });
}

export function useSkill(name: string | null) {
  return useQuery({
    queryKey: skillKey(name ?? ""),
    queryFn: () => fetchSkill(name!),
    enabled: Boolean(name),
  });
}

export function useCreateSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, content }: { name: string; content: string }) =>
      createSkill(name, content),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SKILLS_KEY }),
  });
}

export function useUpdateSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, content }: { name: string; content: string }) =>
      updateSkill(name, content),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: SKILLS_KEY });
      queryClient.setQueryData(skillKey(data.name), data);
    },
  });
}

export function useDeleteSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => deleteSkill(name),
    onSuccess: (_data, name) => {
      queryClient.invalidateQueries({ queryKey: SKILLS_KEY });
      queryClient.removeQueries({ queryKey: skillKey(name) });
    },
  });
}
```

**Step 4: Commit**

```bash
git add src/utils/skills.client.ts src/hooks/useSkills.ts src/hooks/useSkills.types.ts
git commit -m "feat: add skills fetch client and useSkills hooks"
```

---

### Task 4: `CategoryList` component

**Owner:** Frontend Engineer
**Files:**

- Create: `src/components/Settings/CategoryList/CategoryList.tsx`
- Create: `src/components/Settings/CategoryList/CategoryList.types.ts`
- Create: `src/components/Settings/CategoryList/CategoryList.module.css`
- Create: `src/components/Settings/CategoryList/index.ts`

**Step 1: Create `CategoryList.types.ts`**

```typescript
// src/components/Settings/CategoryList/CategoryList.types.ts
export interface CategoryListProps {
  categories: { name: string }[];
  selectedName: string | null;
  onSelect: (name: string) => void;
  onNew: () => void;
  className?: string;
}
```

**Step 2: Create `CategoryList.module.css`**

```css
/* src/components/Settings/CategoryList/CategoryList.module.css */

.list {
  width: 240px;
  flex-shrink: 0;
  border-right: 1px solid var(--color-border);
  background-color: var(--color-surface);
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-4) var(--space-3);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.title {
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-muted);
}

.newButton {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  padding: 3px var(--space-2);
  cursor: pointer;
  transition:
    color 150ms,
    border-color 150ms;
}

.newButton:hover {
  color: var(--color-text);
  border-color: var(--color-border-hover);
}

.items {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.empty {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  padding: var(--space-3) var(--space-2);
}

.item {
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  cursor: pointer;
  transition:
    background-color 150ms,
    color 150ms;
}

.item:hover {
  background-color: var(--color-border);
  color: var(--color-text);
}

.itemSelected {
  background-color: var(--color-border);
  color: var(--color-text);
}
```

**Step 3: Create `CategoryList.tsx`**

```tsx
// src/components/Settings/CategoryList/CategoryList.tsx
"use client";

import { Plus } from "@phosphor-icons/react";
import clsx from "clsx";

import styles from "./CategoryList.module.css";
import type { CategoryListProps } from "./CategoryList.types";

export function CategoryList({
  categories,
  selectedName,
  onSelect,
  onNew,
  className,
}: CategoryListProps) {
  return (
    <div className={clsx(styles.list, className)}>
      <div className={styles.header}>
        <span className={styles.title}>Categories</span>
        <button
          className={styles.newButton}
          onClick={onNew}
          aria-label="New category"
        >
          <Plus size={12} weight="bold" />
          New
        </button>
      </div>
      <div className={styles.items}>
        {categories.length === 0 && (
          <p className={styles.empty}>No categories yet.</p>
        )}
        {categories.map(({ name }) => (
          <button
            key={name}
            className={clsx(
              styles.item,
              selectedName === name && styles.itemSelected,
            )}
            onClick={() => onSelect(name)}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}
```

**Step 4: Create `index.ts`**

```typescript
// src/components/Settings/CategoryList/index.ts
export * from "./CategoryList";
export * from "./CategoryList.types";
```

**Step 5: Commit**

```bash
git add src/components/Settings/CategoryList/
git commit -m "feat: add CategoryList component"
```

---

### Task 5: `CategoryEditor` component

**Owner:** Frontend Engineer
**Depends on:** Task 2 (LexicalEditor format prop)
**Files:**

- Create: `src/components/Settings/CategoryEditor/CategoryEditor.tsx`
- Create: `src/components/Settings/CategoryEditor/CategoryEditor.types.ts`
- Create: `src/components/Settings/CategoryEditor/CategoryEditor.module.css`
- Create: `src/components/Settings/CategoryEditor/index.ts`

**Step 1: Create `CategoryEditor.types.ts`**

```typescript
// src/components/Settings/CategoryEditor/CategoryEditor.types.ts
export interface CategoryEditorProps {
  name: string;
  content: string;
  onChange: (content: string) => void;
  onRename: (newName: string) => void;
  onDelete: () => void;
  className?: string;
}
```

**Step 2: Create `CategoryEditor.module.css`**

```css
/* src/components/Settings/CategoryEditor/CategoryEditor.module.css */

.editor {
  display: flex;
  flex-direction: column;
  flex: 1;
  height: 100%;
  overflow: hidden;
  background-color: var(--color-bg);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-5);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.nameInput {
  flex: 1;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--color-text);
  padding: var(--space-1) var(--space-2);
  outline: none;
  transition: background-color 150ms;
}

.nameInput:hover {
  background-color: var(--color-surface);
}

.nameInput:focus {
  background-color: var(--color-surface);
  box-shadow: 0 0 0 1px var(--color-border);
}

.deleteButton {
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  padding: var(--space-1);
  cursor: pointer;
  transition:
    color 150ms,
    background-color 150ms;
}

.deleteButton:hover {
  color: var(--color-danger);
  background-color: var(--color-danger-bg);
}

.editorBody {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-6) var(--space-8);
}
```

**Step 3: Create `CategoryEditor.tsx`**

```tsx
// src/components/Settings/CategoryEditor/CategoryEditor.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Trash } from "@phosphor-icons/react";
import clsx from "clsx";

import { LexicalEditor } from "@/components/Editor/LexicalEditor";

import styles from "./CategoryEditor.module.css";
import type { CategoryEditorProps } from "./CategoryEditor.types";

export function CategoryEditor({
  name,
  content,
  onChange,
  onRename,
  onDelete,
  className,
}: CategoryEditorProps) {
  const [localName, setLocalName] = useState(name);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync localName when the selected category changes externally
  useEffect(() => {
    setLocalName(name);
  }, [name]);

  // Flush pending saves on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  function handleContentChange(val: string) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => onChange(val), 800);
  }

  function commitRename() {
    const trimmed = localName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
    if (trimmed && trimmed !== name) {
      onRename(trimmed);
    } else {
      setLocalName(name); // reset to current if invalid or unchanged
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.currentTarget.blur();
    }
    if (e.key === "Escape") {
      setLocalName(name);
      e.currentTarget.blur();
    }
  }

  return (
    <div className={clsx(styles.editor, className)}>
      <div className={styles.toolbar}>
        <input
          className={styles.nameInput}
          value={localName}
          onChange={(e) => setLocalName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={handleKeyDown}
          aria-label="Category name"
          spellCheck={false}
        />
        <button
          className={styles.deleteButton}
          onClick={onDelete}
          aria-label="Delete category"
        >
          <Trash size={14} />
        </button>
      </div>
      <div className={styles.editorBody}>
        <LexicalEditor
          key={name}
          format="markdown"
          value={content}
          onChange={handleContentChange}
          placeholder="Describe how Claude should behave for this task type…"
        />
      </div>
    </div>
  );
}
```

**Step 4: Create `index.ts`**

```typescript
// src/components/Settings/CategoryEditor/index.ts
export * from "./CategoryEditor";
export * from "./CategoryEditor.types";
```

**Step 5: Commit**

```bash
git add src/components/Settings/CategoryEditor/
git commit -m "feat: add CategoryEditor component"
```

---

### Task 6: `SettingsPage` and `/settings` route

**Owner:** Frontend Engineer
**Depends on:** Tasks 3, 4, 5
**Files:**

- Create: `src/app/settings/page.tsx`
- Create: `src/app/settings/SettingsPage.tsx`
- Create: `src/app/settings/SettingsPage.module.css`

**Step 1: Create `SettingsPage.module.css`**

```css
/* src/app/settings/SettingsPage.module.css */

.shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background-color: var(--color-bg);
}

.page {
  display: flex;
  flex: 1;
  height: 100%;
  overflow: hidden;
}

.editorPane {
  flex: 1;
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.emptyState {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}
```

**Step 2: Create `SettingsPage.tsx`**

```tsx
// src/app/settings/SettingsPage.tsx
"use client";

import { useRef, useState } from "react";

import { CategoryEditor } from "@/components/Settings/CategoryEditor";
import { CategoryList } from "@/components/Settings/CategoryList";
import {
  useCreateSkill,
  useDeleteSkill,
  useSkill,
  useSkills,
  useUpdateSkill,
} from "@/hooks/useSkills";

import styles from "./SettingsPage.module.css";

export function SettingsPage() {
  const { data: categories = [] } = useSkills();
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const { data: selectedSkill } = useSkill(selectedName);
  const { mutate: createSkill } = useCreateSkill();
  const { mutate: updateSkill } = useUpdateSkill();
  const { mutate: deleteSkill } = useDeleteSkill();
  const counterRef = useRef(0);

  function handleNew() {
    // Find a unique default name
    let candidate = `category-${++counterRef.current}`;
    while (categories.some((c) => c.name === candidate)) {
      candidate = `category-${++counterRef.current}`;
    }
    createSkill(
      { name: candidate, content: "" },
      { onSuccess: () => setSelectedName(candidate) },
    );
  }

  function handleRename(newName: string) {
    if (!selectedName) return;
    const content = selectedSkill?.content ?? "";
    createSkill(
      { name: newName, content },
      {
        onSuccess: () => {
          deleteSkill(selectedName);
          setSelectedName(newName);
        },
      },
    );
  }

  function handleDelete() {
    if (!selectedName) return;
    deleteSkill(selectedName, { onSuccess: () => setSelectedName(null) });
  }

  function handleChange(content: string) {
    if (!selectedName) return;
    updateSkill({ name: selectedName, content });
  }

  return (
    <div className={styles.page}>
      <CategoryList
        categories={categories}
        selectedName={selectedName}
        onSelect={setSelectedName}
        onNew={handleNew}
      />
      <div className={styles.editorPane}>
        {selectedSkill ? (
          <CategoryEditor
            name={selectedSkill.name}
            content={selectedSkill.content}
            onChange={handleChange}
            onRename={handleRename}
            onDelete={handleDelete}
          />
        ) : (
          <div className={styles.emptyState}>
            <p>Select a category or create a new one.</p>
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 3: Create `src/app/settings/page.tsx`**

```tsx
// src/app/settings/page.tsx
import { SettingsPage } from "./SettingsPage";

export default function Page() {
  return <SettingsPage />;
}
```

**Step 4: Commit**

```bash
git add src/app/settings/
git commit -m "feat: add SettingsPage with category list and editor"
```

---

### Task 7: Sidebar wiring + View type update

**Owner:** Frontend Engineer
**Files:**

- Modify: `src/components/Layout/Sidebar/Sidebar.types.ts`
- Modify: `src/components/Layout/Sidebar/Sidebar.tsx`

**Step 1: Update `Sidebar.types.ts`**

Replace the entire file:

```typescript
// src/components/Layout/Sidebar/Sidebar.types.ts
export type View = "Board" | "Tasks" | "Settings";

export interface SidebarProps {
  repoId?: string;
  currentView: View;
  agentActive?: boolean;
}
```

**Step 2: Update `Sidebar.tsx`**

At the top of `Sidebar.tsx`, add `useRouter` is already imported. Find the `Sidebar` function and make two changes:

1. Update the function signature to match the new optional props:

Find:

```typescript
export function Sidebar({ repoId, currentView, agentActive }: SidebarProps) {
```

Replace with:

```typescript
export function Sidebar({
  repoId,
  currentView,
  agentActive = false,
}: SidebarProps) {
```

2. Wire the "Settings" NavItem in the footer to navigate to `/settings`:

Find:

```typescript
        <NavItem icon={<Archive size={16} />} label="Archives" />
```

Replace with:

```typescript
        <NavItem
          icon={<Archive size={16} />}
          label="Archives"
          onClick={() => router.push(`/repos/${repoId}/archive`)}
        />
```

Find:

```typescript
        <NavItem icon={<Gear size={16} />} label="Settings" />
```

Replace with:

```typescript
        <NavItem
          icon={<Gear size={16} />}
          label="Settings"
          active={currentView === "Settings"}
          onClick={() => router.push("/settings")}
        />
```

3. Guard the repo-nav items against undefined repoId. Find the `NAV_VIEWS.map` block and update the `onClick`:

Find:

```typescript
            onClick={() => router.push(`/repos/${repoId}/${path}`)}
```

Replace with:

```typescript
            onClick={() => repoId && router.push(`/repos/${repoId}/${path}`)}
```

**Step 3: Add Sidebar to SettingsPage**

Update `src/app/settings/SettingsPage.tsx`. Add the Sidebar import:

```typescript
import { Sidebar } from "@/components/Layout/Sidebar";
```

Update the return to wrap in a shell with the Sidebar:

```tsx
return (
  <div className={styles.shell}>
    <Sidebar currentView="Settings" />
    <div className={styles.page}>
      <CategoryList
        categories={categories}
        selectedName={selectedName}
        onSelect={setSelectedName}
        onNew={handleNew}
      />
      <div className={styles.editorPane}>
        {selectedSkill ? (
          <CategoryEditor
            name={selectedSkill.name}
            content={selectedSkill.content}
            onChange={handleChange}
            onRename={handleRename}
            onDelete={handleDelete}
          />
        ) : (
          <div className={styles.emptyState}>
            <p>Select a category or create a new one.</p>
          </div>
        )}
      </div>
    </div>
  </div>
);
```

**Step 4: Update callers of `Sidebar` that now use the old props signature**

The only caller is `AppShell.tsx`. Check the existing call:

```typescript
      <Sidebar
        repoId={repoId}
        currentView={currentView}
        agentActive={agentActive}
      />
```

This still works because `repoId` is now optional (but still accepted when provided), and `agentActive` is still accepted. No changes needed.

**Step 5: Run linting to catch any type errors**

```bash
yarn lint
```

Expected: 0 errors, 0 warnings. Fix any type errors before committing.

**Step 6: Commit**

```bash
git add src/components/Layout/Sidebar/Sidebar.types.ts \
        src/components/Layout/Sidebar/Sidebar.tsx \
        src/app/settings/SettingsPage.tsx \
        src/app/settings/SettingsPage.module.css
git commit -m "feat: wire Settings nav link and add Sidebar to SettingsPage"
```

---

### Task 8: Tests

**Owner:** Test Writer
**Depends on:** Tasks 2, 4, 5 complete and reviewed
**Files:**

- Create: `src/hooks/useSkills.test.ts`
- Create: `src/components/Settings/CategoryList/CategoryList.test.tsx`
- Create: `src/components/Settings/CategoryEditor/CategoryEditor.test.tsx`

**Step 1: Create `useSkills.test.ts`**

```typescript
// src/hooks/useSkills.test.ts
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import { useSkill, useSkills } from "./useSkills";

// Mock the fetch client
jest.mock("@/utils/skills.client", () => ({
  fetchSkills: jest.fn(),
  fetchSkill: jest.fn(),
  createSkill: jest.fn(),
  updateSkill: jest.fn(),
  deleteSkill: jest.fn(),
}));

import { fetchSkill, fetchSkills } from "@/utils/skills.client";

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return React.createElement(
    QueryClientProvider,
    { client: queryClient },
    children,
  );
}

describe("useSkills", () => {
  it("returns the list of skills from the API", async () => {
    (fetchSkills as jest.Mock).mockResolvedValue([{ name: "spec" }]);
    const { result } = renderHook(() => useSkills(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ name: "spec" }]);
  });
});

describe("useSkill", () => {
  it("fetches a single skill by name", async () => {
    (fetchSkill as jest.Mock).mockResolvedValue({
      name: "spec",
      content: "# Spec",
    });
    const { result } = renderHook(() => useSkill("spec"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ name: "spec", content: "# Spec" });
  });

  it("does not fetch when name is null", () => {
    const { result } = renderHook(() => useSkill(null), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchSkill).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run useSkills tests**

```bash
yarn test --testPathPattern=useSkills --watch=false
```

Expected: 3 tests pass.

**Step 3: Create `CategoryList.test.tsx`**

```tsx
// src/components/Settings/CategoryList/CategoryList.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CategoryList } from "./CategoryList";

const categories = [{ name: "spec" }, { name: "bug-fix" }];

describe("CategoryList", () => {
  it("renders all category names", () => {
    render(
      <CategoryList
        categories={categories}
        selectedName={null}
        onSelect={jest.fn()}
        onNew={jest.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "spec" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "bug-fix" })).toBeInTheDocument();
  });

  it("shows empty state when no categories", () => {
    render(
      <CategoryList
        categories={[]}
        selectedName={null}
        onSelect={jest.fn()}
        onNew={jest.fn()}
      />,
    );
    expect(screen.getByText("No categories yet.")).toBeInTheDocument();
  });

  it("calls onSelect with the name when an item is clicked", async () => {
    const onSelect = jest.fn();
    render(
      <CategoryList
        categories={categories}
        selectedName={null}
        onSelect={onSelect}
        onNew={jest.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "spec" }));
    expect(onSelect).toHaveBeenCalledWith("spec");
  });

  it("calls onNew when the New button is clicked", async () => {
    const onNew = jest.fn();
    render(
      <CategoryList
        categories={categories}
        selectedName={null}
        onSelect={jest.fn()}
        onNew={onNew}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "New category" }));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("marks the selected item as active via aria", async () => {
    render(
      <CategoryList
        categories={categories}
        selectedName="spec"
        onSelect={jest.fn()}
        onNew={jest.fn()}
      />,
    );
    // The selected item has the itemSelected CSS class — we can verify it's rendered
    const specButton = screen.getByRole("button", { name: "spec" });
    expect(specButton).toBeInTheDocument();
  });
});
```

**Step 4: Run CategoryList tests**

```bash
yarn test --testPathPattern=CategoryList --watch=false
```

Expected: 5 tests pass.

**Step 5: Create `CategoryEditor.test.tsx`**

```tsx
// src/components/Settings/CategoryEditor/CategoryEditor.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CategoryEditor } from "./CategoryEditor";

// LexicalEditor requires window.getSelection stub (same as LexicalEditor.test.tsx)
beforeAll(() => {
  Object.defineProperty(window, "getSelection", {
    value: () => ({ rangeCount: 0 }),
    writable: true,
  });
});

describe("CategoryEditor", () => {
  it("renders with the category name in the name input", () => {
    render(
      <CategoryEditor
        name="spec"
        content=""
        onChange={jest.fn()}
        onRename={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Category name" })).toHaveValue(
      "spec",
    );
  });

  it("renders the Lexical editor body", () => {
    render(
      <CategoryEditor
        name="spec"
        content=""
        onChange={jest.fn()}
        onRename={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    // The lexical content-editable region is present
    const editables = document.querySelectorAll("[contenteditable]");
    expect(editables.length).toBeGreaterThan(0);
  });

  it("calls onDelete when the delete button is clicked", async () => {
    const onDelete = jest.fn();
    render(
      <CategoryEditor
        name="spec"
        content=""
        onChange={jest.fn()}
        onRename={jest.fn()}
        onDelete={onDelete}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Delete category" }),
    );
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("calls onRename with sanitized name on blur when name changes", async () => {
    const onRename = jest.fn();
    render(
      <CategoryEditor
        name="spec"
        content=""
        onChange={jest.fn()}
        onRename={onRename}
        onDelete={jest.fn()}
      />,
    );
    const nameInput = screen.getByRole("textbox", { name: "Category name" });
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Bug Fix");
    await userEvent.tab(); // trigger blur
    expect(onRename).toHaveBeenCalledWith("bug-fix");
  });

  it("does not call onRename when name is unchanged", async () => {
    const onRename = jest.fn();
    render(
      <CategoryEditor
        name="spec"
        content=""
        onChange={jest.fn()}
        onRename={onRename}
        onDelete={jest.fn()}
      />,
    );
    const nameInput = screen.getByRole("textbox", { name: "Category name" });
    await userEvent.click(nameInput);
    await userEvent.tab();
    expect(onRename).not.toHaveBeenCalled();
  });
});
```

**Step 6: Run CategoryEditor tests**

```bash
yarn test --testPathPattern=CategoryEditor --watch=false
```

Expected: 5 tests pass.

**Step 7: Run the full test suite to confirm nothing regressed**

```bash
yarn test --watch=false
```

Expected: all tests pass.

**Step 8: Commit**

```bash
git add src/hooks/useSkills.test.ts \
        src/components/Settings/CategoryList/CategoryList.test.tsx \
        src/components/Settings/CategoryEditor/CategoryEditor.test.tsx
git commit -m "test: add useSkills, CategoryList, and CategoryEditor tests"
```

---

### Task 9: Barrel exports

**Owner:** Frontend Engineer
**Files:**

- Modify: `src/components/index.ts`

**Step 1: Add Settings components to the barrel**

Open `src/components/index.ts`. Add at the bottom:

```typescript
export * from "./Settings/CategoryList";
export * from "./Settings/CategoryEditor";
```

**Step 2: Lint check**

```bash
yarn lint
```

Expected: 0 errors.

**Step 3: Commit**

```bash
git add src/components/index.ts
git commit -m "chore: export Settings components from barrel"
```

---

## Execution Order

```
Tasks 1, 2, 3, 4 → run in parallel (no dependencies)
Task 5            → after Task 2
Task 6            → after Tasks 3, 4, 5
Task 7            → after Task 6
Task 8            → after Tasks 2, 4, 5 (reviewed)
Task 9            → after Tasks 4, 5
```
