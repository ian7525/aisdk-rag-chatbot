import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // You can run tests from different files—or even different tests within the same file—simultaneously to speed things up.
  // This works provided that the tests are independent of one another.
  // Since our tests are all read-only and do not affect each other, this approach is safe.
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.BASE_URL ?? "https://ragchatbot.lantaq.com",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
