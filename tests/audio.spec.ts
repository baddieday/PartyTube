import { expect, test } from "playwright/test";
import { SAMPLE_URLS, resetTestState } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetTestState(request);
});

test("Audio-Fenster: bleibt separat offen, waehrend der Haupt-Tab weiter navigiert", async ({ page, request }) => {
  await page.goto("/");

  const [audioPage] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("button", { name: "Audio-Fenster oeffnen" }).click(),
  ]);

  await expect(audioPage.getByRole("heading", { name: "Audio Deck" })).toBeVisible();

  const addResponse = await request.post("/api/songs", {
    data: {
      url: SAMPLE_URLS.watch,
      guestName: "Audio Check",
      deviceId: "audio-seed",
    },
  });
  expect(addResponse.ok()).toBeTruthy();

  await expect(audioPage.locator("#audio-current-card")).toContainText("YouTube Video dQw4w9WgXcQ");

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: /Host-PIN eingeben|Aktiver Abend/i })).toBeVisible();
  await expect(audioPage.locator("#audio-current-card")).toContainText("YouTube Video dQw4w9WgXcQ");

  await page.goto("/player");
  await expect(page.locator("#player-mode-note")).toContainText("Audio-Fenster aktiv");
});
