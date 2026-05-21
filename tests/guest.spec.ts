import { expect, test } from "playwright/test";
import { SAMPLE_URLS, addSong, expectToast, openDetailsByHeading, resetTestState, saveShot } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetTestState(request);
});

test("Gastmodus: Startseite, Linktypen, Fehler und Duplicate-Erkennung", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Song rein/i })).toBeVisible();
  await openDetailsByHeading(page, "Extras");
  await expect(page.getByAltText("Kleiner QR-Code fuer die Party-Seite")).toBeVisible();
  await expect(page.locator("#queue-duration")).toBeVisible();

  await addSong(page, SAMPLE_URLS.watch, "Gast A");
  await expectToast(page, "Song ist live in der Queue");
  await expect(page.locator("#current-song")).toContainText("YouTube Video dQw4w9WgXcQ");

  await addSong(page, SAMPLE_URLS.short, "Gast B");
  await addSong(page, SAMPLE_URLS.shorts, "Gast C");
  await addSong(page, SAMPLE_URLS.embed, "Gast D");
  expect(await page.locator("[data-song-id]").count()).toBeGreaterThan(2);

  await page.getByLabel("YouTube-Link").fill("https://example.com/not-youtube");
  await page.getByRole("button", { name: "Song in die Queue" }).click();
  await expectToast(page, "Bitte gib einen gueltigen YouTube-Link ein.");

  await page.getByLabel("YouTube-Link").fill(SAMPLE_URLS.watch);
  await page.getByRole("button", { name: "Song in die Queue" }).click();
  await expectToast(page, "Schon in der Queue");

  await page.getByLabel("Nachricht").fill("Hallo PartyTube");
  await page.getByRole("button", { name: "Senden" }).click();
  await expectToast(page, "Nachricht live gesendet.");
  await expect(page.locator("#chat-list")).toContainText("Hallo PartyTube");

  await saveShot(page, "guest-home");
});
