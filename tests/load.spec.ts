import { expect, test } from "playwright/test";
import { resetTestState } from "./helpers";

function makeVideoId(index: number) {
  return `aa${index.toString().padStart(9, "0")}`.slice(0, 11);
}

test.beforeEach(async ({ request }) => {
  await resetTestState(request);
});

test("Last- und Fehlerfaelle: 50 Songs, parallele Votes, XSS und lange Eingaben", async ({ request, page }) => {
  const adds = Array.from({ length: 50 }, (_, index) =>
    request.post("/api/songs", {
      data: {
        url: `https://www.youtube.com/watch?v=${makeVideoId(index + 1)}`,
        guestName: `<script>alert(${index})</script>`,
        deviceId: `adder-${index}`,
      },
    }),
  );
  const responses = await Promise.all(adds);
  for (const response of responses) {
    expect(response.ok()).toBeTruthy();
  }

  const state = await request.get("/api/state").then((response) => response.json());
  expect(state.stats.activeCount).toBe(50);

  const voteBursts = Array.from({ length: 20 }, (_, index) =>
    request.post(`/api/songs/${state.queue[0].id}/vote`, {
      data: { deviceId: `vote-${index}` },
    }),
  );
  const votes = await Promise.all(voteBursts);
  for (const response of votes) {
    expect(response.ok()).toBeTruthy();
  }

  const longResponse = await request.post("/api/songs", {
    data: {
      url: `https://www.youtube.com/watch?v=${makeVideoId(999)}`.padEnd(700, "x"),
      guestName: "Gast",
      deviceId: "too-long",
    },
  });
  expect(longResponse.status()).toBe(400);

  await page.goto("/");
  await expect(page.locator("#queue-list .song-card")).toHaveCount(49);
  await expect(page.locator("body")).not.toContainText("<script>alert");
});

