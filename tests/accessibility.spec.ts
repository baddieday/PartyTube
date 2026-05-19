import { expect, test } from "playwright/test";
import { loginAsAdmin, resetTestState } from "./helpers";

async function injectAxe(page) {
  await page.addScriptTag({ url: "/static/vendor/axe.min.js" });
}

async function expectNoSeriousViolations(page, label: string) {
  const results = await page.evaluate(async () => {
    return await (window as any).axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa"],
      },
    });
  });
  const serious = results.violations.filter((violation) =>
    ["serious", "critical"].includes(String(violation.impact || "")),
  );
  expect(
    serious,
    `${label} has serious accessibility violations: ${JSON.stringify(
      serious.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.length,
      })),
      null,
      2,
    )}`,
  ).toEqual([]);
}

test.beforeEach(async ({ request }) => {
  await resetTestState(request);
});

test("Accessibility: Guest-, Admin-, Start- und Player-Seiten haben keine kritischen Axe-Verstoesse", async ({ page }) => {
  await page.goto("/");
  await injectAxe(page);
  await expectNoSeriousViolations(page, "guest");

  await loginAsAdmin(page);
  await injectAxe(page);
  await expectNoSeriousViolations(page, "admin");

  await page.goto("/start");
  await injectAxe(page);
  await expectNoSeriousViolations(page, "start");

  const securePlayerUrl = await page.locator("#start-player-url").getAttribute("href");
  expect(securePlayerUrl).toContain("player_key=");
  await page.goto(securePlayerUrl);
  await injectAxe(page);
  await expectNoSeriousViolations(page, "player");
});
