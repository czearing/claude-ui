import { test, expect } from "./fixtures";

test("board shows tasks grouped by status columns", async ({ page }) => {
  await page.goto("/repos/repo-1/board");

  await expect(page.getByText("Not started task")).toBeVisible();
  await expect(page.getByText("In progress task")).toBeVisible();
  await expect(page.getByText("Review task")).toBeVisible();
  // Backlog tasks are excluded from the board view
  await expect(page.getByText("Backlog item")).not.toBeVisible();
});

test("board shows status column headings", async ({ page }) => {
  await page.goto("/repos/repo-1/board");

  await expect(
    page.getByRole("heading", { name: "Not Started" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "In Progress" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
});

test("backlog page shows only backlog tasks", async ({ page }) => {
  await page.goto("/repos/repo-1/backlog");

  await expect(page.getByText("Backlog item")).toBeVisible();
  await expect(page.getByText("Not started task")).not.toBeVisible();
});

test("task card shows priority badge", async ({ page }) => {
  await page.goto("/repos/repo-1/board");

  await expect(page.getByText("Urgent")).toBeVisible();
});

test("new task button is present on the board", async ({ page }) => {
  await page.goto("/repos/repo-1/board");

  await expect(
    page.getByRole("button", { name: /new task|add task|create/i }),
  ).toBeVisible();
});
