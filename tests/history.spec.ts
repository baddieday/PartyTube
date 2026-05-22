import { expect, test } from "playwright/test";
import { SAMPLE_URLS, addSong, expectToast, loginAsAdmin, openAdminSettings, resetTestState } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetTestState(request);
});

test("History: gespielt, übersprungen, entfernt, Re-Add, Exporte und Best-of", async ({ page }) => {
  await page.goto("/");
  await addSong(page, SAMPLE_URLS.watch, "Gast A");
  await addSong(page, SAMPLE_URLS.short, "Gast B");
  await addSong(page, SAMPLE_URLS.shorts, "Gast C");

  await loginAsAdmin(page);
  await page.getByRole("button", { name: "Gespielt" }).click();
  await expectToast(page, "Als gespielt markiert.");
  await page.locator("#skip-current").click();
  await expectToast(page, "Song übersprungen.");
  await page.locator("#admin-current-song [data-action='remove']").click();
  await expectToast(page, "Song entfernt.");

  await page.goto("/history");
  await expect(page.getByRole("heading", { name: "Verlauf" })).toBeVisible();
  await expect(page.locator("#history-page-list")).toContainText("Gespielt");
  await expect(page.locator("#history-page-list")).toContainText("Übersprungen");
  await expect(page.locator("#history-page-list")).toContainText("Entfernt");

  await page.locator("#history-page-list [data-action='readd-history']").first().click();
  await expectToast(page, "Wieder in der Queue:");
  await page.locator("#history-page-list [data-action='readd-history']").first().click();
  await expectToast(page, "Song ist bereits in der Warteschlange:");

  await page.goto("/admin");
  const historyJson = await page.evaluate(async () => {
    const response = await fetch("/api/admin/history/export.json", { credentials: "same-origin" });
    return { ok: response.ok, body: await response.json() };
  });
  expect(historyJson.ok).toBeTruthy();
  expect(historyJson.body.history.length).toBeGreaterThanOrEqual(3);

  const historyCsv = await page.evaluate(async () => {
    const response = await fetch("/api/admin/history/export.csv", { credentials: "same-origin" });
    return { ok: response.ok, text: await response.text() };
  });
  expect(historyCsv.ok).toBeTruthy();
  expect(historyCsv.text).toContain("statusLabel");

  const bestOf = await page.evaluate(async () => {
    const response = await fetch("/api/admin/best-of", { credentials: "same-origin" });
    return { ok: response.ok, body: await response.json() };
  });
  expect(bestOf.ok).toBeTruthy();
  expect(bestOf.body.bestOf[0].bestScore).toBeDefined();

  await page.goto("/admin/best-of");
  await expect(page.getByRole("heading", { name: "Topliste" })).toBeVisible();
  await expect(page.locator("#best-of-list .best-of-card")).toHaveCount(3);
});

test("History: HISTORY_PUBLIC=false sperrt Gäste, Admin bleibt erlaubt", async ({ page, request }) => {
  await loginAsAdmin(page);
  await openAdminSettings(page);
  await page.getByLabel("Verlauf für Gäste sichtbar").uncheck();
  await page.getByRole("button", { name: "Netzwerkdaten speichern" }).click();
  await expectToast(page, "Party- und Netzwerkdaten gespeichert.");

  const guestHistory = await request.get("/history");
  expect(guestHistory.status()).toBe(403);

  await page.goto("/history");
  await expect(page.getByRole("heading", { name: "Verlauf" })).toBeVisible();
});
