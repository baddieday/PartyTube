import { expect, test } from "playwright/test";
import { SAMPLE_URLS, loginAsAdmin, resetTestState } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetTestState(request);
});

test("Startseite: priorisiert Audio + TV, zeigt QR-Codes und sichere Host-Links", async ({ page, request }) => {
  await loginAsAdmin(page);
  await page.goto("/start");

  await expect(page.getByRole("heading", { name: /Party starten/i })).toBeVisible();
  await expect(page.getByAltText("Kleiner QR-Code fuer die Party-Seite")).toBeVisible();
  await expect(page.getByAltText("Kleiner QR-Code fuer das WLAN")).toBeVisible();
  await expect(page.locator("#start-host-auth")).toContainText("Host-Login aktiv");
  await expect(page.locator("#start-player-url")).toHaveAttribute("href", /player_key=/);
  await expect(page.locator("#start-audio-url")).toHaveAttribute("href", /player_key=/);

  await page.evaluate(() => {
    (window as any).__partytubeOpened = [];
    window.open = ((url) => {
      (window as any).__partytubeOpened.push(String(url));
      return { focus() {} } as any;
    }) as any;
  });
  await page.getByRole("button", { name: "Audio + TV starten" }).click();
  const opened = await page.evaluate(() => (window as any).__partytubeOpened);
  expect(opened).toHaveLength(2);
  expect(opened[0]).toContain("/audio?player_key=");
  expect(opened[1]).toContain("/player?player_key=");

  const addResponse = await request.post("/api/songs", {
    data: {
      url: SAMPLE_URLS.watch,
      guestName: "Start Flow",
      deviceId: "start-seed",
    },
  });
  expect(addResponse.ok()).toBeTruthy();

  await expect(page.locator("#start-current-song")).toContainText("YouTube Video dQw4w9WgXcQ");
});
