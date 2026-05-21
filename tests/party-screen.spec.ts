import { expect, test } from "playwright/test";
import {
  EXPECTED_JOIN_URL,
  SAMPLE_URLS,
  WIFI_PASSWORD,
  WIFI_SSID,
  expectToast,
  loginAsAdmin,
  resetTestState,
  saveShot,
} from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetTestState(request);
});

test("Party-Screen: QR, Join-Link, WLAN-Schutz, aktueller Song, Top 3 und Live-Update", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/party-screen");
  await expect(page.locator(".screen-qr")).toBeVisible();
  await expect(page.getByText(EXPECTED_JOIN_URL)).toBeVisible();
  await expect(page.getByText(WIFI_SSID)).toBeVisible();
  await expect(page.getByText(WIFI_PASSWORD)).toHaveCount(0);
  await expect(page.locator("#screen-current")).toContainText("Scanne den QR-Code");

  const addResponse = await request.post("/api/songs", {
    data: { url: SAMPLE_URLS.watch, guestName: "Screen Gast", deviceId: "screen-seed-a" },
  });
  expect(addResponse.ok()).toBeTruthy();
  await expect(page.locator("#screen-current")).toContainText("YouTube Video dQw4w9WgXcQ");

  for (const [index, url] of [SAMPLE_URLS.short, SAMPLE_URLS.shorts, SAMPLE_URLS.embed].entries()) {
    const response = await request.post("/api/songs", {
      data: { url, guestName: `Queue ${index}`, deviceId: `screen-seed-${index + 1}` },
    });
    expect(response.ok()).toBeTruthy();
  }
  await expect(page.locator(".screen-next-song")).toHaveCount(3);
  await expect(page.getByText("QR scannen")).toBeVisible();
  await expect(page.getByText("Song einreichen")).toBeVisible();
  await expect(page.getByText("Voten")).toBeVisible();

  await saveShot(page, "party-screen-tv");
});

test("Party-Screen: WLAN-Passwort erscheint nur nach bewusster Host-Aktivierung", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByLabel("Passwort am TV zeigen").check();
  await page.getByLabel("WLAN-QR auf Party-Screen zeigen").check();
  await page.getByRole("button", { name: "Netzwerkdaten speichern" }).click();
  await expectToast(page, "Party- und Netzwerkdaten gespeichert.");

  await page.goto("/party-screen");
  await expect(page.getByText(WIFI_PASSWORD)).toBeVisible();
  await expect(page.locator(".screen-wifi-qr")).toBeVisible();
});
