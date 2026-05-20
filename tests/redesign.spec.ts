import { expect, test } from "playwright/test";
import { SAMPLE_URLS, loginAsAdmin, resetTestState, saveShot } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetTestState(request);
});

test("Redesign: Startseite nutzt das Premium Rot/Schwarz Designsystem", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/start");

  await expect(page.getByAltText("PartyTube")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Party starten/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Audio + TV starten" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Party-Screen" }).first()).toBeVisible();

  const primary = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim());
  expect(primary).toBe("#d71d2a");

  await saveShot(page, "redesign-start-desktop");
});

test("Redesign: Guest Mobile priorisiert Song-Eingabe und bleibt ohne horizontales Scrollen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.locator("#add-song-form")).toBeVisible();
  await expect(page.getByLabel("YouTube-Link")).toBeVisible();
  await expect(page.getByRole("button", { name: "Song in die Queue" })).toBeVisible();
  await expect(page.locator("#connection-pill")).toBeVisible();

  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflows).toBeFalsy();

  await saveShot(page, "redesign-guest-mobile");
});

test("Redesign: Admin-Dashboard zeigt hochwertige Status-Kacheln", async ({ page }) => {
  await loginAsAdmin(page);

  await expect(page.locator(".admin-stat-grid")).toBeVisible();
  await expect(page.locator("#admin-stat-guests")).toBeVisible();
  await expect(page.locator("#admin-stat-queue")).toHaveText("0");
  await expect(page.getByRole("button", { name: "Song skippen" })).toBeVisible();

  await saveShot(page, "redesign-admin-dashboard");
});

test("Redesign: TV- und Party-Screen bleiben praesentationsreif in 16:9", async ({ page, request }) => {
  await request.post("/api/songs", {
    data: { url: SAMPLE_URLS.watch, guestName: "Design Gast", deviceId: "design-tv" },
  });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/player");
  await expect(page.getByRole("heading", { name: "Party Player" })).toBeVisible();
  await expect(page.locator("#player-current-card")).toContainText("YouTube Video dQw4w9WgXcQ");
  await saveShot(page, "redesign-player-tv");

  await page.goto("/party-screen");
  await expect(page.locator(".screen-qr")).toBeVisible();
  await expect(page.locator("#screen-current")).toContainText("YouTube Video dQw4w9WgXcQ");
  await expect(page.getByText("QR scannen")).toBeVisible();
  await saveShot(page, "redesign-party-screen-tv");
});
