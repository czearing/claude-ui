import { test as base } from "@playwright/test";

import type { Task } from "../src/utils/tasks.types";

export type { Task };

export const MOCK_REPO = {
  id: "repo-1",
  name: "My Project",
  path: "/projects/my-project",
};

export const MOCK_TASKS: Task[] = [
  {
    id: "task-backlog",
    title: "Backlog item",
    status: "Backlog",
    priority: "Low",
    repoId: "repo-1",
    spec: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "task-ns",
    title: "Not started task",
    status: "Not Started",
    priority: "High",
    repoId: "repo-1",
    spec: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "task-ip",
    title: "In progress task",
    status: "In Progress",
    priority: "Urgent",
    repoId: "repo-1",
    spec: null,
    sessionId: "session-abc",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "task-rv",
    title: "Review task",
    status: "Review",
    priority: "Medium",
    repoId: "repo-1",
    spec: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

interface AppFixtures {
  mockApi: void;
}

export const test = base.extend<AppFixtures>({
  mockApi: [
    async ({ page }, use) => {
      await page.route("**/api/repos", (route) =>
        route.fulfill({ json: [MOCK_REPO] }),
      );
      // Tasks are fetched as /api/tasks?repoId=<id>
      await page.route(/\/api\/tasks\?/, (route) =>
        route.fulfill({ json: MOCK_TASKS }),
      );
      // Agents and skills default to global scope: /api/agents and /api/skills
      await page.route("**/api/agents", (route) =>
        route.fulfill({ json: { agents: [] } }),
      );
      await page.route("**/api/skills", (route) =>
        route.fulfill({ json: { skills: [] } }),
      );
      await use();
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
