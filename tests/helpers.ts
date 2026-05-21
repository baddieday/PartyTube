import { expect, Page, APIRequestContext } from "playwright/test";
import fs from "node:fs";

export const ADMIN_PIN = process.env.ADMIN_PIN || "2468";
export const TEST_PORT = process.env.TEST_PORT || process.env.PORT || "8090";
export const TEST_HOST = process.env.HOST_IP || "127.0.0.1";
export const TEST_BASE_URL = process.env.BASE_URL || `http://${TEST_HOST}:${TEST_PORT}`;
export const PARTY_CODE = process.env.PARTY_CODE || "test-rave";
export const EXPECTED_JOIN_URL = `${TEST_BASE_URL}/join/${PARTY_CODE}`;
export const WIFI_SSID = process.env.WIFI_SSID || "PartyLAN";
export const WIFI_PASSWORD = process.env.WIFI_PASSWORD || "TestWifiPass123!";
export const WIFI_SECURITY = process.env.WIFI_SECURITY || "WPA";

export const SAMPLE_URLS = {
  watch: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  short: "https://youtu.be/3JZ4pnNtyxQ",
  shorts: "https://www.youtube.com/shorts/M7lc1UVf-VE",
  embed: "https://www.youtube.com/embed/ysz5S6PUM-U",
};

export async function resetTestState(request: APIRequestContext) {
  const response = await request.post("/api/test/reset");
  expect(response.ok()).toBeTruthy();
}

export async function addSong(page: Page, url: string, guestName = "Alex") {
  await page.getByLabel("YouTube-Link").fill(url);
  await page.getByLabel("Dein Name (optional)").fill(guestName);
  const submitButton = page.getByRole("button", { name: "Song in die Queue" });
  await submitButton.click();
  await expect(submitButton).toBeEnabled();
}

export async function loginAsAdmin(page: Page) {
  await page.goto("/admin");
  await page.getByLabel("Admin-PIN").fill(ADMIN_PIN);
  await page.getByRole("button", { name: "Einloggen" }).click();
  await expectToast(page, "Host-Login aktiv.");
  await expect(page.locator("#admin-open-player")).toHaveAttribute("href", /player_key=/);
}

export async function expectToast(page: Page, text: string) {
  await expect(page.locator(".toast").filter({ hasText: text }).last()).toBeVisible();
}

export async function getSecurePlayerUrl(page: Page) {
  const href = await page.locator("#admin-open-player").getAttribute("href");
  expect(href).toContain("player_key=");
  return href!;
}

export async function getSecureAudioUrl(page: Page) {
  const href = await page.locator("#admin-open-audio").getAttribute("href");
  expect(href).toContain("player_key=");
  return href!;
}

export async function saveShot(page: Page, name: string) {
  fs.mkdirSync("artifacts/screenshots", { recursive: true });
  await page.screenshot({ path: `artifacts/screenshots/${name}.png`, fullPage: true });
}
