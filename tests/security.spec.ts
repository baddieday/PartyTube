import { expect, test } from "playwright/test";
import { SAMPLE_URLS, resetTestState } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetTestState(request);
});

test("Security: Admin-Session, CSRF und Player-Token sind abgesichert", async ({ request }) => {
  const beforeStatus = await request.get("/api/admin/status").then((response) => response.json());
  expect(beforeStatus.authenticated).toBeFalsy();
  expect(beforeStatus.playerUrl).toBe("/player");

  const wrongLogin = await request.post("/api/admin/login", {
    data: { pin: "0000" },
  });
  expect(wrongLogin.status()).toBe(401);

  const login = await request.post("/api/admin/login", {
    data: { pin: "2468" },
  });
  expect(login.ok()).toBeTruthy();
  const loginBody = await login.json();
  expect(loginBody.csrfToken).toBeTruthy();

  const missingCsrf = await request.put("/api/admin/settings", {
    data: { chatEnabled: false },
  });
  expect(missingCsrf.status()).toBe(403);

  const wrongCsrf = await request.put("/api/admin/settings", {
    data: { chatEnabled: false },
    headers: { "X-PartyTube-CSRF": "wrong-token" },
  });
  expect(wrongCsrf.status()).toBe(403);

  const status = await request.get("/api/admin/status").then((response) => response.json());
  expect(status.authenticated).toBeTruthy();
  expect(status.playerUrl).toContain("player_key=");

  const validCsrf = await request.put("/api/admin/settings", {
    data: { chatEnabled: true, votingEnabled: true, inviteOnlyMode: false, maxSongsPerDevice: 4, maxQueueItems: 60 },
    headers: { "X-PartyTube-CSRF": loginBody.csrfToken },
  });
  expect(validCsrf.ok()).toBeTruthy();

  const song = await request.post("/api/songs", {
    data: { url: SAMPLE_URLS.watch, guestName: "Sec Test", deviceId: "sec-device" },
  });
  expect(song.ok()).toBeTruthy();

  const noToken = await request.post("/api/player/ended", {
    data: {},
  });
  expect(noToken.status()).toBe(401);

  const wrongToken = await request.post("/api/player/ended", {
    data: {},
    headers: { "X-PartyTube-Player-Token": "wrong-token" },
  });
  expect(wrongToken.status()).toBe(403);

  const token = new URL(`http://local${status.playerUrl}`).searchParams.get("player_key");
  expect(token).toBeTruthy();

  const goodToken = await request.post("/api/player/ended", {
    data: {},
    headers: { "X-PartyTube-Player-Token": token! },
  });
  expect(goodToken.ok()).toBeTruthy();

  const logout = await request.post("/api/admin/logout", {
    data: {},
    headers: { "X-PartyTube-CSRF": loginBody.csrfToken },
  });
  expect(logout.ok()).toBeTruthy();

  const afterLogout = await request.get("/api/admin/settings");
  expect(afterLogout.status()).toBe(401);
});
