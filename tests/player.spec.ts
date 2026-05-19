import { expect, test } from "playwright/test";
import { SAMPLE_URLS, getSecurePlayerUrl, loginAsAdmin, resetTestState } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetTestState(request);
});

test("Player: oeffentlicher TV-Link zeigt Warnung, sicherer TV-Link schaltet Queue weiter", async ({ page, request }) => {
  await page.goto("/player");
  await expect(page.getByRole("heading", { name: "Party Player" })).toBeVisible();
  await expect(page.getByText("Nur Video-Link aktiv")).toBeVisible();
  await expect(page.locator("#player-current-card")).toContainText(/Keine aktive|Keine Wiedergabe aktiv/i);

  await loginAsAdmin(page);
  const securePlayerUrl = await getSecurePlayerUrl(page);
  const playerToken = new URL(`http://local${securePlayerUrl}`).searchParams.get("player_key");
  expect(playerToken).toBeTruthy();
  await page.goto(securePlayerUrl);
  await expect(page.getByText("Nur Video-Link aktiv")).toHaveCount(0);

  const addResponse = await request.post("/api/songs", {
    data: {
      url: SAMPLE_URLS.watch,
      guestName: "Player Check",
      deviceId: "player-seed",
    },
  });
  expect(addResponse.ok()).toBeTruthy();

  await expect(page.locator("#player-current-card")).toContainText("YouTube Video dQw4w9WgXcQ");
  await page.reload();
  await expect(page.locator("#player-current-card")).toContainText("YouTube Video dQw4w9WgXcQ");

  const endedResponse = await page.evaluate(async (token) => {
    const response = await fetch("/api/player/ended", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-PartyTube-Player-Token": token,
      },
      body: "{}",
    });
    return { ok: response.ok, status: response.status };
  }, playerToken!);
  expect(endedResponse.ok).toBeTruthy();
  await expect(page.locator("#player-current-card")).toContainText(/Keine aktive|Keine Wiedergabe aktiv/i);
});
