import { expect, test } from "playwright/test";
import { expectToast, loginAsAdmin, openDetailsByHeading, resetTestState } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetTestState(request);
});

test("Chat: Nachricht senden, live anzeigen, XSS nicht ausfuehren und Admin-Loeschung", async ({ browser, page }) => {
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const adminPage = await adminContext.newPage();
  await loginAsAdmin(adminPage);
  await openDetailsByHeading(adminPage, "Best-of und Moderation");

  await page.goto("/");
  await openDetailsByHeading(page, "Extras");
  await page.getByLabel("Nachricht").fill("<img src=x onerror=alert(1)> Halloooo");
  await page.getByRole("button", { name: "Senden" }).click();
  await expectToast(page, "Nachricht live gesendet.");
  await expect(page.locator("#chat-list")).toContainText("<img src=x onerror=alert(1)> Halloooo");
  await expect(page.locator("#chat-list img")).toHaveCount(0);

  await expect(adminPage.locator("#admin-message-list")).toContainText("<img src=x onerror=alert(1)> Halloooo");
  await adminPage.locator("#admin-message-list [data-action='delete-message']").first().click();
  await expectToast(adminPage, "Nachricht geloescht.");
  await expect(page.locator("#chat-list")).not.toContainText("Halloooo");

  await adminContext.close();
});

test("Chat: zu lange Nachricht wird abgelehnt", async ({ page }) => {
  await page.goto("/");
  await openDetailsByHeading(page, "Extras");
  await page.getByLabel("Nachricht").fill("x".repeat(300));
  await page.getByRole("button", { name: "Senden" }).click();
  await expectToast(page, "Die Nachricht ist zu lang.");
});
