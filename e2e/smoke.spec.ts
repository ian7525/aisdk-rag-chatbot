import { expect, test } from "@playwright/test";

// Each test gets a fresh browser context with no cookies,
// so every test here runs as a signed-out visitor.

test("home page loads and shows the navigation bar", async ({ page }) => {
  const response = await page.goto("/");

  // The server responds successfully (no 404 / 500)
  expect(response?.status()).toBe(200);

  // Navigation bar: title and signed-out buttons
  await expect(page.getByText("RAG Chatbot")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign Up" })).toBeVisible();
});

test("signed-out visitor is redirected away from /chat to sign-in", async ({
  page,
}) => {
  await page.goto("/chat");

  await expect(page).toHaveURL(/sign-in/);
});

test("signed-out visitor cannot access /upload and is sent home", async ({
  page,
}) => {
  await page.goto("/upload");

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("RAG Chatbot")).toBeVisible();
});
