import { expect, test } from "playwright/test";
import { EXPECTED_JOIN_URL, resetTestState, saveShot } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetTestState(request);
});

test("QR-Seite: WLAN- und Party-Link-QR sind sichtbar und poster-tauglich", async ({ page }) => {
  await page.goto("/qr");
  await expect(page.getByRole("heading", { name: /Scannen und beitreten/i })).toBeVisible();
  await expect(page.getByAltText("QR-Code fuer die Party-Seite")).toBeVisible();
  await expect(page.getByAltText("QR-Code fuer das WLAN")).toBeVisible();
  await expect(page.locator(".qr-card .qr-text").first()).toHaveText(EXPECTED_JOIN_URL);
  await saveShot(page, "qr-poster");
});
