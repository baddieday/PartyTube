import { expect, test } from "playwright/test";
import { SAMPLE_URLS, resetTestState } from "./helpers";

const SHORT_CANONICAL = "https://www.youtube.com/watch?v=3JZ4pnNtyxQ";

test.beforeEach(async ({ request }) => {
  await resetTestState(request);
});

test("PWA: Manifest enthaelt Share Target und gueltige Icons", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBeTruthy();
  expect(response.headers()["content-type"]).toContain("application/manifest+json");

  const manifest = await response.json();
  expect(manifest.name).toContain("PartyTube");
  expect(manifest.short_name).toBe("PartyTube");
  expect(manifest.start_url).toBe("/");
  expect(manifest.scope).toBe("/");
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.some((icon: { src: string }) => icon.src === "/static/img/icon-512.png")).toBeTruthy();
  expect(manifest.share_target).toEqual({
    action: "/share-target",
    method: "GET",
    params: {
      title: "title",
      text: "text",
      url: "url",
    },
  });
});

test("PWA: Diagnose-Seite laedt und zeigt die wichtigsten Debug-Felder", async ({ page }) => {
  await page.goto("/pwa-debug");

  await expect(page.getByRole("heading", { name: "Installierbarkeit und Share Target pruefen" })).toBeVisible();
  await expect(page.locator("#pwa-debug-manifest-url")).not.toHaveText("-");
  await expect(page.locator("#pwa-debug-secure")).not.toHaveText("Pruefung laeuft...");
  await expect(page.locator("#pwa-debug-sw")).not.toHaveText("Pruefung laeuft...");
});

test("Share Target: gueltige YouTube-Links werden serverseitig auf die Gastseite umgeleitet", async ({ request }) => {
  const viaUrl = await request.get(`/share-target?url=${encodeURIComponent(SAMPLE_URLS.watch)}`, {
    maxRedirects: 0,
  });
  expect(viaUrl.status()).toBe(303);
  const viaUrlLocation = new URL(viaUrl.headers().location || "", "http://localhost");
  expect(viaUrlLocation.pathname).toBe("/");
  expect(viaUrlLocation.searchParams.get("shared_url")).toBe(SAMPLE_URLS.watch);
  expect(viaUrlLocation.searchParams.get("shared_submit")).toBe("1");
  expect(viaUrlLocation.searchParams.get("share_flow_id")).toBeTruthy();

  const viaText = await request.get(
    `/share-target?text=${encodeURIComponent(`Hoer dir das an ${SAMPLE_URLS.short}`)}`,
    { maxRedirects: 0 },
  );
  expect(viaText.status()).toBe(303);
  const viaTextLocation = new URL(viaText.headers().location || "", "http://localhost");
  expect(viaTextLocation.pathname).toBe("/");
  expect(viaTextLocation.searchParams.get("shared_url")).toBe(SHORT_CANONICAL);
  expect(viaTextLocation.searchParams.get("shared_submit")).toBe("1");
  expect(viaTextLocation.searchParams.get("share_flow_id")).toBeTruthy();

  const invalid = await request.get("/share-target?url=https%3A%2F%2Fexample.com%2Fnot-youtube", {
    maxRedirects: 0,
  });
  expect(invalid.status()).toBe(303);
  expect(invalid.headers().location).toBe("/?share_error=invalid");
});

test("Share Target: Gastseite uebernimmt geteilte Links nur als Vorbelegung", async ({ page }) => {
  await page.goto(`/?shared_url=${encodeURIComponent(SAMPLE_URLS.watch)}`);

  await expect(page.getByLabel("YouTube-Link")).toHaveValue(SAMPLE_URLS.watch);
  await expect(page.locator(".toast").filter({ hasText: "Geteilter YouTube-Link erkannt." }).last()).toBeVisible();
  await expect(page.locator("[data-song-id]")).toHaveCount(0);
});

test("Share Target: Teilen-Flow reicht einen gueltigen Link automatisch ein", async ({ page }) => {
  await page.goto(`/share-target?url=${encodeURIComponent(SAMPLE_URLS.watch)}`);

  await expect(page.locator(".toast").filter({ hasText: "Geteilter Song ist live:" }).last()).toBeVisible();
  await expect(page.locator("[data-song-id]")).toHaveCount(1);
  await expect(page.locator("#current-song")).toContainText("YouTube Video dQw4w9WgXcQ");
  await expect(page.getByLabel("YouTube-Link")).toHaveValue("");
});

test("Share Target: ungueltige Daten zeigen einen kurzen Fehler", async ({ page }) => {
  await page.goto("/?share_error=invalid");

  await expect(page.locator(".toast").filter({ hasText: "Kein gueltiger YouTube-Link erkannt." }).last()).toBeVisible();
  await expect(page.getByLabel("YouTube-Link")).toHaveValue("");
});
