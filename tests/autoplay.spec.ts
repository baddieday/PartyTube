import { expect, test } from "playwright/test";
import { SAMPLE_URLS, expectToast, getSecureAudioUrl, loginAsAdmin, resetTestState } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetTestState(request);
});

test("Autoplay-Fallback: wenn die Queue leer wird, laeuft der Party-Verlauf weiter", async ({ page, request }) => {
  await loginAsAdmin(page);
  await page.getByLabel("Autoplay aus Verlauf").check();
  await page.getByRole("button", { name: "Netzwerkdaten speichern" }).click();
  await expectToast(page, "Party- und Netzwerkdaten gespeichert.");

  const secureAudioUrl = await getSecureAudioUrl(page);
  const playerToken = new URL(`http://local${secureAudioUrl}`).searchParams.get("player_key");
  expect(playerToken).toBeTruthy();

  await page.goto(secureAudioUrl);

  const firstAdd = await request.post("/api/songs", {
    data: { url: SAMPLE_URLS.watch, guestName: "Auto A", deviceId: "auto-a" },
  });
  expect(firstAdd.ok()).toBeTruthy();

  const secondAdd = await request.post("/api/songs", {
    data: { url: SAMPLE_URLS.short, guestName: "Auto B", deviceId: "auto-b" },
  });
  expect(secondAdd.ok()).toBeTruthy();

  await expect(page.locator("#audio-current-card")).toContainText("YouTube Video dQw4w9WgXcQ");

  const firstEnded = await request.post("/api/player/ended", {
    data: {},
    headers: { "X-PartyTube-Player-Token": playerToken! },
  });
  expect(firstEnded.ok()).toBeTruthy();
  await expect(page.locator("#audio-current-card")).toContainText("YouTube Video 3JZ4pnNtyxQ");

  const secondEnded = await request.post("/api/player/ended", {
    data: {},
    headers: { "X-PartyTube-Player-Token": playerToken! },
  });
  expect(secondEnded.ok()).toBeTruthy();
  await expect(page.locator("#audio-current-card")).toContainText("Autoplay aus Verlauf");
  await expect(page.locator("#audio-current-card")).toContainText("YouTube Video dQw4w9WgXcQ");
});
