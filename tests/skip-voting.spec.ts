import { expect, test } from "playwright/test";
import { SAMPLE_URLS, addSong, expectToast, loginAsAdmin, openAdminSettings, resetTestState } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetTestState(request);
});

test("Skip-Voting: 40-Prozent-Schwelle, Duplicate-Schutz, Reset und demokratischer Skip", async ({ browser }) => {
  const guestAContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guestBContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guestCContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const hostContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  const guestA = await guestAContext.newPage();
  const guestB = await guestBContext.newPage();
  const guestC = await guestCContext.newPage();
  const host = await hostContext.newPage();

  await Promise.all([guestA.goto("/"), guestB.goto("/"), guestC.goto("/")]);
  await addSong(guestA, SAMPLE_URLS.watch, "Gast A");
  await addSong(guestB, SAMPLE_URLS.short, "Gast B");

  await loginAsAdmin(host);
  await expect(host.locator("#admin-skip-status")).toContainText("0/2");

  await guestA.getByRole("button", { name: "Song ueberspringen" }).click();
  await expectToast(guestA, "Skip-Vote registriert.");
  await expect(host.locator("#admin-skip-status")).toContainText("1/2");

  const duplicate = await guestA.evaluate(async () => {
    const response = await fetch("/api/songs/current/skip-vote", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: localStorage.getItem("partytube-device-id"), guestName: "Gast A" }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(duplicate.status).toBe(409);
  expect(duplicate.body.detail).toContain("bereits Skip gevotet");

  await host.getByRole("button", { name: "Skip-Votes resetten" }).click();
  await expectToast(host, "Skip-Votes fuer den aktuellen Song zurueckgesetzt.");
  await expect(host.locator("#admin-skip-status")).toContainText("0/2");

  await guestA.getByRole("button", { name: "Song ueberspringen" }).click();
  await guestB.getByRole("button", { name: "Song ueberspringen" }).click();
  await expectToast(guestB, "Song wurde demokratisch uebersprungen.");
  await expect(guestA.locator("#current-song")).toContainText("YouTube Video 3JZ4pnNtyxQ");

  const history = await guestA.evaluate(async () => {
    const response = await fetch("/api/history");
    return response.json();
  });
  expect(history.history.some((song: { status: string }) => song.status === "skipped_by_vote")).toBeTruthy();

  await Promise.all([guestAContext.close(), guestBContext.close(), guestCContext.close(), hostContext.close()]);
});

test("Skip-Voting: deaktivierte Einstellung lehnt Gast-Votes ab, Admin-Skip bleibt moeglich", async ({ page }) => {
  await page.goto("/");
  await addSong(page, SAMPLE_URLS.watch, "Gast A");

  await loginAsAdmin(page);
  await openAdminSettings(page);
  await page.getByLabel("Demokratisches Skip-Voting aktivieren").uncheck();
  await page.getByRole("button", { name: "Netzwerkdaten speichern" }).click();
  await expectToast(page, "Party- und Netzwerkdaten gespeichert.");

  await page.goto("/");
  await expect(page.getByText("Skip-Voting ist vom Host deaktiviert.")).toBeVisible();
  await page.evaluate(async () => {
    localStorage.setItem("partytube-device-id", "skip-disabled-device");
  });
  const blocked = await page.evaluate(async () => {
    const response = await fetch("/api/songs/current/skip-vote", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: "skip-disabled-device", guestName: "Gast A" }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(blocked.status).toBe(403);
  expect(blocked.body.detail).toContain("deaktiviert");

  await page.goto("/admin");
  await page.getByRole("button", { name: "Song skippen" }).click();
  await expectToast(page, "Song uebersprungen.");
});
