import { expect, Page, APIRequestContext } from "playwright/test";
import fs from "node:fs";

export const ADMIN_PIN = process.env.ADMIN_PIN || "2468";

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
  await expect(page.getByText("Host-Login aktiv.")).toBeVisible();
}

export async function expectToast(page: Page, text: string) {
  await expect(page.locator(".toast").filter({ hasText: text }).last()).toBeVisible();
}

export async function saveShot(page: Page, name: string) {
  fs.mkdirSync("artifacts/screenshots", { recursive: true });
  await page.screenshot({ path: `artifacts/screenshots/${name}.png`, fullPage: true });
}
