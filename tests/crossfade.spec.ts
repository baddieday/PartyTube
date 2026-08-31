import { expect, test } from "playwright/test";
import {
  getSecureAudioUrl,
  loginAsAdmin,
  openAdminSettings,
  resetTestState,
} from "./helpers";

const videoUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

test.beforeEach(async ({ request }) => {
  await resetTestState(request);
});

test("Display clients receive a bounded state while guests keep the complete queue", async ({ request }) => {
  for (const [index, videoId] of [
    "AAAAAAAAAAA",
    "BBBBBBBBBBB",
    "CCCCCCCCCCC",
    "DDDDDDDDDDD",
    "EEEEEEEEEEE",
    "FFFFFFFFFFF",
  ].entries()) {
    const response = await request.post("/api/songs", {
      data: { url: videoUrl(videoId), guestName: `Bounded ${index}`, deviceId: `bounded-${index}` },
    });
    expect(response.ok()).toBeTruthy();
  }
  const message = await request.post("/api/messages", {
    data: { guestName: "Bounded", message: "Only guests need this", deviceId: "bounded-chat" },
  });
  expect(message.ok()).toBeTruthy();

  const guestState = await (await request.get("/api/state?role=guest")).json();
  const invalidRoleState = await (await request.get("/api/state?role=not-a-client")).json();
  const audioState = await (await request.get("/api/state?role=audio")).json();
  const screenState = await (await request.get("/api/state?role=screen")).json();

  expect(guestState.queue).toHaveLength(5);
  expect(guestState.messages).toHaveLength(1);
  expect(invalidRoleState.queue).toHaveLength(5);
  expect(invalidRoleState.messages).toHaveLength(1);
  expect(audioState.queue).toHaveLength(3);
  expect(audioState.messages).toEqual([]);
  expect(screenState.queue).toHaveLength(3);
  expect(screenState.messages).toEqual([]);
  expect(screenState.history).toEqual([]);
});

test("Host configures a fixed crossfade value and two bounded decks advance the queue", async ({ page, request }) => {
  await loginAsAdmin(page);
  await openAdminSettings(page);
  await page.getByLabel("Übergang zwischen Songs").selectOption("1");
  await page.getByRole("button", { name: "Netzwerkdaten speichern" }).click();

  const settingsResponse = await page.request.get("/api/admin/settings");
  expect(settingsResponse.ok()).toBeTruthy();
  expect((await settingsResponse.json()).crossfadeSeconds).toBe(1);
  const secureAudioUrl = await getSecureAudioUrl(page);

  for (const [index, videoId] of ["AAAAAAAAAAA", "BBBBBBBBBBB"].entries()) {
    const response = await request.post("/api/songs", {
      data: { url: videoUrl(videoId), guestName: `Fade ${index}`, deviceId: `fade-${index}` },
    });
    expect(response.ok()).toBeTruthy();
  }

  await page.route("https://www.youtube.com/iframe_api", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      body: `
        window.__ytVolumeEvents = [];
        window.__ytPlayers = [];
        window.YT = {
          PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
          Player: class {
            constructor(id, options) {
              this.id = id;
              this.options = options;
              this.state = -1;
              this.videoId = null;
              this.volume = 100;
              this.index = window.__ytPlayers.length;
              window.__ytPlayers.push(this);
              setTimeout(() => options.events.onReady({ target: this }), 0);
            }
            loadVideoById(value) {
              this.videoId = typeof value === "string" ? value : value.videoId;
              this.state = 1;
              setTimeout(() => this.options.events.onStateChange({ data: 1, target: this }), 0);
            }
            cueVideoById(value) {
              this.videoId = typeof value === "string" ? value : value.videoId;
              this.state = 5;
              setTimeout(() => this.options.events.onStateChange({ data: 5, target: this }), 0);
            }
            playVideo() {
              this.state = 1;
              setTimeout(() => this.options.events.onStateChange({ data: 1, target: this }), 0);
            }
            stopVideo() { this.state = -1; }
            mute() {}
            unMute() {}
            destroy() { this.destroyed = true; }
            getPlayerState() { return this.state; }
            getDuration() { return 120; }
            getCurrentTime() { return this.index === 0 ? 119.2 : 0; }
            setVolume(value) {
              this.volume = value;
              window.__ytVolumeEvents.push({ deck: this.index, value });
            }
          }
        };
        setTimeout(() => window.onYouTubeIframeAPIReady?.(), 0);
      `,
    });
  });

  await page.goto(secureAudioUrl);
  await expect(page.locator(".audio-player-deck")).toHaveCount(2);
  await expect(page.locator("#audio-transition-note")).toContainText("1 s");
  await expect(page.locator("#audio-current-card")).toContainText("YouTube Video BBBBBBBBBBB", {
    timeout: 8_000,
  });

  const volumes = await page.evaluate(() => (window as any).__ytVolumeEvents);
  expect(volumes.some((event: { deck: number; value: number }) => event.deck === 0 && event.value < 100)).toBeTruthy();
  expect(volumes.some((event: { deck: number; value: number }) => event.deck === 1 && event.value > 0)).toBeTruthy();
});
