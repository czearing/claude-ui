import { test, expect } from "./fixtures";

test("redirects from / to the first repo board", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/repos\/repo-1\/board/);
});

test("board page renders the sidebar and board tasks", async ({ page }) => {
  await page.goto("/repos/repo-1/board");
  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page.getByText("Not started task")).toBeVisible();
  await expect(page.getByText("In progress task")).toBeVisible();
});

test("sidebar navigation links are present", async ({ page }) => {
  await page.goto("/repos/repo-1/board");
  await expect(page.getByRole("link", { name: /board/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /backlog/i })).toBeVisible();
});

test("agents page renders without error", async ({ page }) => {
  await page.goto("/repos/repo-1/agents");
  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
});

test("skills page renders without error", async ({ page }) => {
  await page.goto("/repos/repo-1/skills");
  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
});
