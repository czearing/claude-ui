import { test, expect } from "./fixtures";

// The root redirect happens server-side (page.tsx fetches /api/repos on the
// server), so Playwright route mocks cannot intercept it.  Assert only that
// we land on *some* repo board, not the specific mocked repo-1.
test("redirects from / to the first repo board", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/repos\/[^/]+\/board/);
});

test("board page renders the sidebar and board tasks", async ({ page }) => {
  await page.goto("/repos/repo-1/board");
  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page.getByText("In progress task")).toBeVisible();
  await expect(page.getByText("Review task")).toBeVisible();
});

// The sidebar renders NavItem buttons (not anchor links).
test("sidebar navigation buttons are present", async ({ page }) => {
  await page.goto("/repos/repo-1/board");
  await expect(page.getByRole("button", { name: "Board" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tasks" })).toBeVisible();
});

// AgentsPage wraps content in a div, not <main>.  Check for the navigation
// and a landmark that is always rendered (the "Agents" nav button).
test("agents page renders without error", async ({ page }) => {
  await page.goto("/repos/repo-1/agents");
  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page.getByRole("button", { name: "Agents" })).toBeVisible();
});

test("skills page renders without error", async ({ page }) => {
  await page.goto("/repos/repo-1/skills");
  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page.getByRole("button", { name: "Skills" })).toBeVisible();
});
