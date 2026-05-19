import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const port = process.env.TEST_PORT || "8090";
const cwd = process.cwd();
const tmpDir = path.join(cwd, ".tmp");
fs.mkdirSync(tmpDir, { recursive: true });

const env = {
  ...process.env,
  PORT: port,
  HOST_IP: "127.0.0.1",
  BASE_URL: `http://127.0.0.1:${port}`,
  DATA_DIR: tmpDir,
  DATABASE_PATH: path.join(tmpDir, "playwright-party.db"),
  ADMIN_PIN: process.env.ADMIN_PIN || "2468",
  PARTY_NAME: "Playwright Party",
  PARTY_CODE: "test-rave",
  WIFI_SSID: process.env.WIFI_SSID || "PartyLAN",
  WIFI_PASSWORD: process.env.WIFI_PASSWORD || "HouseParty2026!",
  WIFI_SECURITY: process.env.WIFI_SECURITY || "WPA",
  TEST_MODE: "1",
  TITLE_LOOKUP_TIMEOUT_SECONDS: "0.1",
  ENABLE_TITLE_LOOKUP: "0",
};

const pythonBin = process.env.PYTHON_BIN || "python";
const child = spawn(
  pythonBin,
  ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", port],
  {
    cwd,
    env,
    stdio: "inherit",
  },
);

const terminate = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

process.on("SIGINT", () => terminate("SIGINT"));
process.on("SIGTERM", () => terminate("SIGTERM"));

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
