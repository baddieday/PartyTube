import { expect, test } from "playwright/test";
import { SAMPLE_URLS, addSong, expectToast, resetTestState } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetTestState(request);
});

test("Voting: Live-Sync, Sortierung, Vote-Limit und Refresh-Persistenz", async ({ browser, page }) => {
  await page.goto("/");
  await addSong(page, SAMPLE_URLS.watch, "Host");
  await addSong(page, SAMPLE_URLS.short, "Gast B");
  await addSong(page, SAMPLE_URLS.shorts, "Gast C");

  const guestB = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const guestBPage = await guestB.newPage();
  await guestBPage.goto("/");

  await guestBPage.locator("#queue-list [data-action='vote']").first().click();
  await expectToast(guestBPage, "Vote registriert.");

  const topQueueCard = page.locator("#queue-list .song-card").first();
  await expect(topQueueCard).toContainText("2 Votes");

  await guestBPage.locator("#queue-list [data-action='vote']").first().click();
  await expectToast(guestBPage, "Dieses Geraet hat fuer den Song schon gevotet.");

  await guestBPage.reload();
  await expect(guestBPage.locator("#queue-list [data-action='vote']").first()).toBeDisabled();

  await guestB.close();
});

