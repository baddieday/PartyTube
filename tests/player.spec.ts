import { expect, test } from "playwright/test";
import { SAMPLE_URLS, resetTestState } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetTestState(request);
});

test("Player: Seite laedt, leere Queue wird sauber gezeigt und naechster Song erscheint", async ({ page, request }) => {
  await page.goto("/player");
  await expect(page.getByRole("heading", { name: "Party Player" })).toBeVisible();
  await expect(page.getByAltText("Kleiner QR-Code fuer die Party-Seite")).toBeVisible();
  await expect(page.locator("#player-current-card")).toContainText(/Keine aktive|Keine Wiedergabe aktiv/i);

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

  const endedResponse = await request.post("/api/player/ended", { data: {} });
  expect(endedResponse.ok()).toBeTruthy();
  await expect(page.locator("#player-current-card")).toContainText(/Keine aktive|Keine Wiedergabe aktiv/i);
});
