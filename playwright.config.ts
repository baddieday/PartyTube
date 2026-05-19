import { defineConfig } from "playwright/test";

const baseURL = process.env.BASE_URL || "http://127.0.0.1:8090";
const nodeBin = JSON.stringify(process.execPath);

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { open: "never" }],
  ],
  use: {
    baseURL,
    viewport: { width: 390, height: 844 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: process.env.SKIP_WEBSERVER
    ? undefined
    : {
        command: `${nodeBin} scripts/start-test-server.mjs`,
        port: 8090,
        timeout: 120_000,
        reuseExistingServer: true,
      },
});
