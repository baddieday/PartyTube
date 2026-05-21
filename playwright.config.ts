import { defineConfig } from "playwright/test";

const testPort = Number(process.env.TEST_PORT || process.env.PORT || "8090");
const testHost = process.env.TEST_HOST || process.env.HOST_IP || "127.0.0.1";
const baseURL = process.env.BASE_URL || `http://${testHost}:${testPort}`;
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
        port: testPort,
        timeout: 120_000,
        reuseExistingServer: true,
      },
});
