import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { expect, test } from "playwright/test";

const pythonBin = process.env.PYTHON_BIN || "python";

function startServer(port: number, dbPath: string) {
  const env = {
    ...process.env,
    PORT: String(port),
    HOST_IP: "127.0.0.1",
    BASE_URL: `http://127.0.0.1:${port}`,
    DATA_DIR: path.dirname(dbPath),
    DATABASE_PATH: dbPath,
    ADMIN_PIN: process.env.ADMIN_PIN || "2468",
    PARTY_NAME: "Persistence Party",
    PARTY_CODE: "persist",
    WIFI_SSID: "PartyLAN",
    WIFI_PASSWORD: "HouseParty2026!",
    TEST_MODE: "1",
    TITLE_LOOKUP_TIMEOUT_SECONDS: "0.1",
    ENABLE_TITLE_LOOKUP: "0",
  };
  return spawn(
    pythonBin,
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(port)],
    { cwd: process.cwd(), env, stdio: "ignore" },
  );
}

async function waitForServer(url: string) {
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server ${url} did not start in time`);
}

test("Persistenz: Queue ueberlebt Server-Neustart", async ({ browser }) => {
  const tempDir = path.join(process.cwd(), ".tmp");
  const dbPath = path.join(tempDir, "persist-check.db");
  fs.mkdirSync(tempDir, { recursive: true });
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  const port = 8091;
  const baseURL = `http://127.0.0.1:${port}`;
  let server = startServer(port, dbPath);
  await waitForServer(baseURL);

  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByLabel("YouTube-Link").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await page.getByRole("button", { name: "Song in die Queue" }).click();
  await expect(page.locator("#current-song")).toContainText("YouTube Video dQw4w9WgXcQ");
  await context.close();

  server.kill("SIGTERM");
  await new Promise((resolve) => server.once("exit", resolve));

  server = startServer(port, dbPath);
  await waitForServer(baseURL);

  const verifyContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const verifyPage = await verifyContext.newPage();
  await verifyPage.goto("/");
  await expect(verifyPage.locator("#current-song")).toContainText("YouTube Video dQw4w9WgXcQ");
  await verifyContext.close();

  server.kill("SIGTERM");
});
