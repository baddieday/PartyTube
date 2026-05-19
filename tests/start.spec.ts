import { expect, test } from "playwright/test";
import { SAMPLE_URLS, resetTestState } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetTestState(request);
});

test("Startseite: priorisiert Audio + TV und zeigt kompakte QR-Codes", async ({ page, request }) => {
  await page.goto("/start");
  await expect(page.getByRole("heading", { name: /Audio stabil halten, TV starten/i })).toBeVisible();
  await expect(page.getByAltText("Kleiner QR-Code fuer die Party-Seite")).toBeVisible();
  await expect(page.getByAltText("Kleiner QR-Code fuer das WLAN")).toBeVisible();

  const [audioPage, playerPage] = await Promise.all([
    page.waitForEvent("popup"),
    page.waitForEvent("popup"),
    page.getByRole("button", { name: "Audio + TV starten" }).click(),
  ]);

  const popupTitles = await Promise.all([audioPage.title(), playerPage.title()]);
  expect(popupTitles.join(" ")).toContain("PartyTube");

  const addResponse = await request.post("/api/songs", {
    data: {
      url: SAMPLE_URLS.watch,
      guestName: "Start Flow",
      deviceId: "start-seed",
    },
  });
  expect(addResponse.ok()).toBeTruthy();

  await expect(page.locator("#start-current-song")).toContainText("YouTube Video dQw4w9WgXcQ");
  await expect(page.locator("#start-audio-state")).toContainText(/Audio-Fenster offen|Audio-Fenster spielt/i);
});
