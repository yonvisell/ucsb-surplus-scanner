import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: true,
  workers: 3,
  reporter: [["list"], ["html", { open: "never" }]],
  webServer: process.env.APP_URL
    ? undefined
    : {
        command: "npm run preview",
        url: "http://127.0.0.1:4173/ucsb-surplus-scanner/",
        reuseExistingServer: !process.env.CI,
      },
  use: {
    baseURL:
      process.env.APP_URL || "http://127.0.0.1:4173/ucsb-surplus-scanner/",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.CI ? undefined : "chrome",
      },
    },
    {
      name: "android-chrome",
      use: {
        ...devices["Pixel 7"],
        browserName: "chromium",
        channel: process.env.CI ? undefined : "chrome",
      },
    },
    {
      name: "webkit-mobile",
      use: { ...devices["iPhone 13"], browserName: "webkit" },
    },
  ],
});
