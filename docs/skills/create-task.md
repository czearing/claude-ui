---
name: create-task
description: Create a new task/card in the claude-code-ui board. Use when asked to create a task, issue, ticket, or spec for the current repo.
---

The user's message IS the spec. Do not ask questions.

1. Derive a short title from the message (first sentence or summary)
2. Use the full message as the spec content
3. Run immediately:

```bash
cat > /tmp/task-spec.md << 'SPEC_EOF'
<full user message>
SPEC_EOF

node C:/Code/Personal/claude-code-ui/scripts/create-task.mjs --title "<derived title>" --spec-file /tmp/task-spec.md
```

4. Report the task ID back. Done.
