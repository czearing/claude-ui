import { test, expect } from "./fixtures";

// Board columns are In Progress, Review, and Done.
// "Not Started" tasks are excluded from all columns.
// "Backlog" tasks are filtered out of boardTasks before the Board renders.
test("board shows tasks grouped by status columns", async ({ page }) => {
  await page.goto("/repos/repo-1/board");

  await expect(page.getByText("In progress task")).toBeVisible();
  await expect(page.getByText("Review task")).toBeVisible();
  await expect(page.getByText("Not started task")).not.toBeVisible();
  await expect(page.getByText("Backlog item")).not.toBeVisible();
});

test("board shows status column headings", async ({ page }) => {
  await page.goto("/repos/repo-1/board");

  await expect(
    page.getByRole("heading", { name: "In Progress" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Review" }),
  ).toBeVisible();
});

// /backlog redirects to /tasks which shows the Backlog component (Backlog-only
// filter applied internally by the Backlog component).
test("backlog page shows only backlog tasks", async ({ page }) => {
  await page.goto("/repos/repo-1/backlog");

  await expect(page.getByText("Backlog item")).toBeVisible();
  await expect(page.getByText("Not started task")).not.toBeVisible();
});

test("in-progress task card shows agent processing badge", async ({ page }) => {
  await page.goto("/repos/repo-1/board");

  await expect(page.getByText("Agent Processing...")).toBeVisible();
});

// The "New Task" button lives on the Tasks (backlog) page, not the Board.
test("new task button is present on the tasks page", async ({ page }) => {
  await page.goto("/repos/repo-1/tasks");

  await expect(
    page.getByRole("button", { name: /new task/i }),
  ).toBeVisible();
});
