import { expect, test } from "playwright/test";
import { SAMPLE_URLS, expectToast, loginAsAdmin, resetTestState } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetTestState(request);
});

test("Autoplay-Fallback: wenn die Queue leer wird, laeuft der Party-Verlauf weiter", async ({ page, request }) => {
  await loginAsAdmin(page);
  await page.getByLabel("Autoplay aus dem Party-Verlauf aktivieren, wenn die Queue leer wird").check();
  await page.getByRole("button", { name: "Netzwerkdaten speichern" }).click();
  await expectToast(page, "Party- und Netzwerkdaten gespeichert.");

  await page.goto("/audio");

  const firstAdd = await request.post("/api/songs", {
    data: { url: SAMPLE_URLS.watch, guestName: "Auto A", deviceId: "auto-a" },
  });
  expect(firstAdd.ok()).toBeTruthy();

  const secondAdd = await request.post("/api/songs", {
    data: { url: SAMPLE_URLS.short, guestName: "Auto B", deviceId: "auto-b" },
  });
  expect(secondAdd.ok()).toBeTruthy();

  await expect(page.locator("#audio-current-card")).toContainText("YouTube Video dQw4w9WgXcQ");

  const firstEnded = await request.post("/api/player/ended", { data: {} });
  expect(firstEnded.ok()).toBeTruthy();
  await expect(page.locator("#audio-current-card")).toContainText("YouTube Video 3JZ4pnNtyxQ");

  const secondEnded = await request.post("/api/player/ended", { data: {} });
  expect(secondEnded.ok()).toBeTruthy();
  await expect(page.locator("#audio-current-card")).toContainText("Autoplay aus Verlauf");
  await expect(page.locator("#audio-current-card")).toContainText("YouTube Video dQw4w9WgXcQ");
});
