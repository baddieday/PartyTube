import { expect, test } from "playwright/test";
import { SAMPLE_URLS, addSong, expectToast, loginAsAdmin, resetTestState, saveShot } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetTestState(request);
});

test("Admin: PIN-Schutz, Entfernen, Skip, Queue leeren und Logout", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByText("Nicht eingeloggt")).toBeVisible();

  await page.getByLabel("Admin-PIN").fill("0000");
  await page.getByRole("button", { name: "Einloggen" }).click();
  await expectToast(page, "PIN falsch.");

  await page.goto("/");
  await addSong(page, SAMPLE_URLS.watch, "Gast A");
  await addSong(page, SAMPLE_URLS.short, "Gast B");
  await addSong(page, SAMPLE_URLS.shorts, "Gast C");

  await loginAsAdmin(page);
  await page.getByRole("button", { name: "Song skippen" }).click();
  await expectToast(page, "Song uebersprungen.");

  await page.locator("#admin-queue-list [data-action='remove']").first().click();
  await expectToast(page, "Song entfernt.");

  await page.getByRole("button", { name: "Queue leeren" }).click();
  await expectToast(page, "Aktive Queue geleert.");
  await expect(page.getByText("Die Warteschlange ist leer.")).toBeVisible();

  await page.getByRole("button", { name: "Logout" }).click();
  await expectToast(page, "Host-Session beendet.");
  await expect(page.getByText("Nicht eingeloggt")).toBeVisible();

  await saveShot(page, "admin-console");
});

test("Admin: Party-, Invite-only- und Live-Settings lassen sich pflegen", async ({ page }) => {
  await loginAsAdmin(page);

  await page.getByLabel("Party-Name").fill("Afterwork Mix");
  await page.getByLabel("Party-Code").fill("afterwork");
  await page.getByLabel("Oeffentliche Basis-URL (optional)").fill("http://party.lokal");
  await page.getByLabel("WLAN-SSID").fill("Party Mesh");
  await page.getByLabel("WLAN-Passwort").fill("NeonBeat2026");
  await page.getByLabel("WLAN-Sicherheit").selectOption("WPA");
  await page.getByLabel("Autoplay aus dem Party-Verlauf aktivieren, wenn die Queue leer wird").check();
  await page.getByLabel("Chat aktivieren").uncheck();
  await page.getByLabel("Invite-only Mode aktivieren. Root `/` zeigt dann nur noch den Join-Code-Einstieg.").check();
  await page.getByLabel("Max Songs pro Geraet").fill("3");
  await page.getByLabel("Max Queue-Laenge").fill("50");
  await page.getByRole("button", { name: "Netzwerkdaten speichern" }).click();
  await expectToast(page, "Party- und Netzwerkdaten gespeichert.");
  await expect(page.locator("#settings-join-preview")).toHaveText("http://party.lokal/join/afterwork");
  await expect(page.getByLabel("Autoplay aus dem Party-Verlauf aktivieren, wenn die Queue leer wird")).toBeChecked();
  await expect(page.locator("#admin-join-url")).toHaveText("http://party.lokal/join/afterwork");

  await page.goto("/");
  await expect(page.getByText("Party-Code eingeben")).toBeVisible();

  await page.goto("/qr");
  await expect(page.getByRole("heading", { name: "Afterwork Mix" })).toBeVisible();
  await expect(page.locator(".qr-card .qr-text").first()).toHaveText("http://party.lokal/join/afterwork");
  await expect(page.getByText("WPA / Party Mesh")).toBeVisible();
});
