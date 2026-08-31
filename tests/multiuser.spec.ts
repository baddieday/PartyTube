import { expect, test } from "playwright/test";
import { SAMPLE_URLS, addSong, loginAsAdmin, resetTestState } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetTestState(request);
});

test("Multiuser: Gast A, Gast B und Host bleiben live synchron", async ({ browser }) => {
  const guestA = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guestB = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const host = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  const guestAPage = await guestA.newPage();
  const guestBPage = await guestB.newPage();
  const hostPage = await host.newPage();

  await Promise.all([guestAPage.goto("/"), guestBPage.goto("/"), hostPage.goto("/admin")]);
  await loginAsAdmin(hostPage);

  await Promise.all([
    addSong(guestAPage, SAMPLE_URLS.watch, "Gast A"),
    addSong(guestBPage, SAMPLE_URLS.short, "Gast B"),
  ]);

  await expect(hostPage.locator("#admin-queue-list .song-card")).toHaveCount(1);
  await expect(guestAPage.locator("#current-song .song-card")).toHaveCount(1);
  await expect(guestBPage.locator("#queue-list .song-card")).toHaveCount(1);

  const queuedCard = hostPage.locator("#admin-queue-list .song-card").first();
  const queuedText = await queuedCard.textContent();
  if (queuedText?.includes("dQw4w9WgXcQ")) {
    await guestBPage.locator("#queue-list [data-action='vote']").first().click();
    await expect(queuedCard).toContainText("2 Votes");
    await hostPage.locator("#skip-current").click();
    await expect(guestAPage.locator("#current-song")).toContainText("YouTube Video dQw4w9WgXcQ");
  } else {
    await guestAPage.locator("#queue-list [data-action='vote']").first().click();
    await expect(queuedCard).toContainText("2 Votes");
    await hostPage.locator("#skip-current").click();
    await expect(guestAPage.locator("#current-song")).toContainText("YouTube Video 3JZ4pnNtyxQ");
  }

  await Promise.all([guestA.close(), guestB.close(), host.close()]);
});

test("Multiuser: verspäteter Initialzustand überschreibt kein Live-Update", async ({ browser }) => {
  const delayedGuest = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const activeGuest = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const delayedPage = await delayedGuest.newPage();
  const activePage = await activeGuest.newPage();

  let releaseInitialState!: () => void;
  let initialStateCaptured!: () => void;
  let initialStateDelivered!: () => void;
  const releaseGate = new Promise<void>((resolve) => {
    releaseInitialState = resolve;
  });
  const stateCaptured = new Promise<void>((resolve) => {
    initialStateCaptured = resolve;
  });
  const stateDelivered = new Promise<void>((resolve) => {
    initialStateDelivered = resolve;
  });
  let intercepted = false;

  await delayedPage.route("**/api/state?**", async (route) => {
    if (intercepted) {
      await route.continue();
      return;
    }
    intercepted = true;

    // Capture the empty snapshot, then deliver it only after a newer WebSocket state.
    const response = await route.fetch();
    initialStateCaptured();
    await releaseGate;
    await route.fulfill({ response });
    initialStateDelivered();
  });

  await Promise.all([delayedPage.goto("/"), activePage.goto("/")]);
  await stateCaptured;
  await addSong(activePage, SAMPLE_URLS.watch, "Live Gast");
  await expect(delayedPage.locator("#current-song")).toContainText("YouTube Video dQw4w9WgXcQ");

  releaseInitialState();
  await stateDelivered;
  await expect(delayedPage.locator("#current-song")).toContainText("YouTube Video dQw4w9WgXcQ");

  await Promise.all([delayedGuest.close(), activeGuest.close()]);
});
