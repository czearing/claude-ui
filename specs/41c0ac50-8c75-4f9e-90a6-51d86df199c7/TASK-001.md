---
id: TASK-001
title: Test
status: Review
priority: Medium
repoId: 41c0ac50-8c75-4f9e-90a6-51d86df199c7
sessionId: e361a573-d391-4b82-b9ae-cbbfc8dc3f36
createdAt: 2026-02-25T19:47:26.587Z
updatedAt: 2026-02-25T19:48:35.072Z
---

Hello world

Every time the user types a character, CiqPlugin fires two commands. If a slash is present it fires OPEN_CIQ_COMMAND
then SLASH_QUERY_CHANGED_COMMAND. If there is no slash it fires SLASH_QUERY_CHANGED_COMMAND then CLOSE_CIQ_COMMAND.
Both pieces of info, open/closed and the query string, could just be sent together in one command. Right now
CiqMenuController also has to register three separate handlers to piece that back together. Here is a cleaner way to
write it:

`CiqPlugin` always dispatches two commands on every keystroke. One to signal open/close, one to pass the query string.
These two pieces of info can just travel together in a single command:

```ts
export const CIQ_STATE_CHANGED_COMMAND: LexicalCommand<{ isOpen: boolean; query: string }> = createCommand();

// before: two dispatches every keystroke
editor.dispatchCommand(OPEN_CIQ_COMMAND, undefined);
editor.dispatchCommand(SLASH_QUERY_CHANGED_COMMAND, textContent.slice(lastSlashIndex + 1));

// after: one dispatch
editor.dispatchCommand(CIQ_STATE_CHANGED_COMMAND, {
  isOpen: lastSlashIndex >= 0,
  query: lastSlashIndex >= 0 ? textContent.slice(lastSlashIndex + 1) : ''
});

This also simplifies CiqMenuController down to one registered handler instead of three.
```
