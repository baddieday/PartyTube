import { expect, test } from "playwright/test";
import { SAMPLE_URLS, getSecureAudioUrl, loginAsAdmin, resetTestState } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetTestState(request);
});

test("Audio-Fenster: bleibt separat offen und nutzt den sicheren Host-Link", async ({ page, request }) => {
  await page.goto("/");

  const [publicAudioPage] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("button", { name: "Audio-Fenster oeffnen" }).click(),
  ]);
  await expect(publicAudioPage.getByText("Host-Link fehlt")).toBeVisible();
  await publicAudioPage.close();

  await loginAsAdmin(page);
  const secureAudioUrl = await getSecureAudioUrl(page);

  const [audioPage] = await Promise.all([
    page.waitForEvent("popup"),
    page.evaluate((url) => window.open(url, "partytube-audio-window"), secureAudioUrl),
  ]);

  await expect(audioPage.getByRole("heading", { name: "Audio Deck" })).toBeVisible();
  await expect(audioPage.getByText("Host-Link fehlt")).toHaveCount(0);

  const addResponse = await request.post("/api/songs", {
    data: {
      url: SAMPLE_URLS.watch,
      guestName: "Audio Check",
      deviceId: "audio-seed",
    },
  });
  expect(addResponse.ok()).toBeTruthy();

  await expect(audioPage.locator("#audio-current-card")).toContainText("YouTube Video dQw4w9WgXcQ");

  await page.goto("/player");
  await expect(page.locator("#player-mode-note")).toContainText("Audio-Fenster aktiv");
});
