const appConfig = JSON.parse(document.getElementById("app-config")?.textContent || "{}");

const stateStore = {
  current: null,
  queue: [],
  history: [],
  messages: [],
  queueMeta: {},
  runtime: {
    autoplayEnabled: Boolean(appConfig.autoplayEnabled),
    crossfadeSeconds: Number(appConfig.crossfadeSeconds || 0),
    chatEnabled: Boolean(appConfig.chatEnabled),
    votingEnabled: Boolean(appConfig.votingEnabled),
    inviteOnlyMode: Boolean(appConfig.inviteOnlyMode),
    skipVotingEnabled: Boolean(appConfig.skipVotingEnabled),
    skipThresholdPercent: Number(appConfig.skipThresholdPercent || 40),
    activeGuestWindowSeconds: Number(appConfig.activeGuestWindowSeconds || 300),
    historyPublic: appConfig.historyPublic !== false,
    readdEnabled: appConfig.readdEnabled !== false,
    partyScreenEnabled: appConfig.partyScreenEnabled !== false,
    wifiQrEnabled: Boolean(appConfig.wifiQrEnabled),
    showWifiPasswordOnScreen: Boolean(appConfig.showWifiPasswordOnScreen),
    partyScreenShowActiveGuests: appConfig.partyScreenShowActiveGuests !== false,
    partyScreenShowSkipStatus: appConfig.partyScreenShowSkipStatus !== false,
    maxSongsPerDevice: Number(appConfig.maxSongsPerDevice || 0),
    maxQueueItems: Number(appConfig.maxQueueItems || 0),
  },
  skipVoting: {
    skipVotingEnabled: Boolean(appConfig.skipVotingEnabled),
    skipThresholdPercent: Number(appConfig.skipThresholdPercent || 40),
    activeGuestCount: 0,
    currentSkipVoteCount: 0,
    currentSkipVotePercent: 0,
    skipVotesNeeded: null,
    hasCurrentDeviceSkipVoted: false,
  },
  stats: { activeCount: 0, historyCount: 0, messageCount: 0 },
};

const AUDIO_WINDOW_NAME = "partytube:audioWindow";
const AUDIO_HEARTBEAT_KEY = "partytube:audioWindow:heartbeat";
const AUDIO_TITLE_KEY = "partytube:audioWindow:title";
const AUDIO_STATE_KEY = "partytube:audioWindow:state";
const AUDIO_HEARTBEAT_MAX_AGE_MS = 6500;
const AUDIO_LAUNCH_INTENT_KEY = "partytube:audioWindow:launchIntent";
const AUDIO_LAUNCH_INTENT_TTL_MS = 12000;

function updateAppConfig(values = {}) {
  Object.assign(appConfig, values);
  if (values.runtime) {
    Object.assign(stateStore.runtime, values.runtime);
  }
}

function getDeviceId() {
  const key = "partytube-device-id";
  let value = localStorage.getItem(key);
  if (!value) {
    value = self.crypto?.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(key, value);
  }
  return value;
}

function getVotedSongs() {
  try {
    return new Set(JSON.parse(localStorage.getItem("partytube-votes") || "[]"));
  } catch {
    return new Set();
  }
}

function rememberVote(songId) {
  const set = getVotedSongs();
  set.add(songId);
  localStorage.setItem("partytube-votes", JSON.stringify(Array.from(set)));
}

function clearRememberedVotes() {
  localStorage.removeItem("partytube-votes");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "";
  const seconds = Math.round(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function relativeTime(value) {
  if (!value) return "";
  const date = new Date(value);
  const diff = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.floor(hours / 24);
  return `vor ${days} Tag${days === 1 ? "" : "en"}`;
}

function playbackStartSeconds(song) {
  if (!song?.currentStartedAt) return 0;
  const startedAt = new Date(song.currentStartedAt).getTime();
  if (!Number.isFinite(startedAt)) return 0;
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  return Math.max(0, seconds - 1);
}

function toast(message, kind = "info") {
  const stack = document.getElementById("toast-stack");
  if (!stack) return;
  const item = document.createElement("div");
  item.className = `toast ${kind}`;
  item.textContent = message;
  stack.appendChild(item);
  setTimeout(() => item.classList.add("visible"), 10);
  setTimeout(() => {
    item.classList.remove("visible");
    setTimeout(() => item.remove(), 250);
  }, 3600);
}

function describeApiError(body) {
  if (typeof body === "string") {
    return body;
  }
  if (!body || typeof body !== "object") {
    return "Aktion fehlgeschlagen.";
  }
  if (typeof body.detail === "string") {
    return body.detail;
  }
  if (typeof body.message === "string") {
    return body.message;
  }
  if (body.detail && typeof body.detail.message === "string") {
    return body.detail.message;
  }
  return "Aktion fehlgeschlagen.";
}

async function apiFetch(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  const needsCsrf =
    !["GET", "HEAD", "OPTIONS"].includes(method) &&
    url.startsWith("/api/admin/") &&
    !url.endsWith("/login");
  if (needsCsrf && appConfig.csrfToken) {
    headers["X-PartyTube-CSRF"] = appConfig.csrfToken;
  }

  if (url === "/api/player/ended" && appConfig.playerControlToken) {
    headers["X-PartyTube-Player-Token"] = appConfig.playerControlToken;
  }

  const response = await fetch(url, {
    credentials: "same-origin",
    headers,
    ...options,
  });

  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(describeApiError(body));
    error.status = response.status;
    error.payload = body;
    error.retryAfterSeconds =
      body?.retryAfterSeconds ||
      body?.detail?.retryAfterSeconds ||
      Number(response.headers.get("Retry-After") || 0) ||
      0;
    throw error;
  }
  return body;
}

function songMetaChips(song) {
  const chips = [];
  if (song.statusLabel && !["queued", "current"].includes(song.status)) {
    chips.push(`<span class="tag-pill status-${escapeHtml(song.status)}">${escapeHtml(song.statusLabel)}</span>`);
  }
  if (song.pinned) {
    chips.push('<span class="tag-pill">Priorisiert</span>');
  }
  if (Number.isFinite(song.readdCount) && song.readdCount > 0) {
    chips.push(`<span class="tag-pill">${song.readdCount}x erneut gewünscht</span>`);
  }
  if (Number.isFinite(song.durationSeconds)) {
    chips.push(`<span class="tag-pill">${formatDuration(song.durationSeconds)}</span>`);
  }
  if (Number.isFinite(song.estimatedWaitSeconds)) {
    chips.push(`<span class="tag-pill">ca. in ${formatDuration(song.estimatedWaitSeconds)}</span>`);
  }
  if (Number.isFinite(song.remainingSeconds)) {
    chips.push(`<span class="tag-pill">noch ${formatDuration(song.remainingSeconds)}</span>`);
  }
  return chips.join("");
}

function songCard(song, options = {}) {
  const votedSongs = getVotedSongs();
  const voted = votedSongs.has(song.id);
  const adminMode = options.adminMode || false;
  const playerMode = options.playerMode || false;
  const historyMode = options.historyMode || false;
  const canReadd = historyMode && stateStore.runtime.readdEnabled;
  const completedAt = song.completedAt || song.playedAt || song.skippedAt || song.removedAt;

  return `
    <article class="song-card ${options.highlight ? "highlight" : ""}" data-song-id="${song.id}">
      <img class="song-thumb" src="${escapeHtml(song.thumbnailUrl)}" alt="Thumbnail von ${escapeHtml(song.title)}" loading="lazy">
      <div class="song-meta">
        <div class="song-line">
          <h3>${escapeHtml(song.title)}</h3>
          <span class="vote-chip">${song.votes} Vote${song.votes === 1 ? "" : "s"}</span>
        </div>
        <div class="song-chip-row">
          ${songMetaChips(song)}
        </div>
        <p class="song-subline">
          ${song.guestName ? `von <strong>${escapeHtml(song.guestName)}</strong>` : "von einem Gast"}
          <span class="dot-sep"></span>
          ${relativeTime(song.addedAt)}
          ${song.submitterLabel ? `<span class="dot-sep"></span>Gerät ${escapeHtml(song.submitterLabel)}` : ""}
        </p>
        ${completedAt ? `<p class="song-subline">${escapeHtml(song.statusLabel || "Abgeschlossen")} ${relativeTime(completedAt)}</p>` : ""}
        ${
          song.readdedFromSongId
            ? `<p class="song-subline">erneut hinzugefügt aus Verlauf #${escapeHtml(song.readdedFromSongId)}</p>`
            : ""
        }
        <div class="song-actions">
          ${
            !adminMode && !playerMode && stateStore.runtime.votingEnabled
              ? `<button class="chip-button vote-button" ${voted ? "disabled" : ""} data-action="vote">
                  ${voted ? "Schon gevotet" : "Vote +1"}
                </button>`
              : ""
          }
          ${
            adminMode
              ? `
                ${["queued", "current"].includes(song.status) ? `<button class="chip-button" data-action="pin">${song.pinned ? "Entpinnen" : "Priorisieren"}</button>` : ""}
                ${["queued", "current"].includes(song.status) ? '<button class="chip-button danger" data-action="clear-device">Gerät-Songs löschen</button>' : ""}
                ${["queued", "current"].includes(song.status) ? '<button class="chip-button danger" data-action="mute-device">Gerät sperren</button>' : ""}
                ${["queued", "current"].includes(song.status) ? '<button class="chip-button danger" data-action="remove">Entfernen</button>' : ""}
              `
              : ""
          }
          ${
            canReadd
              ? `<button class="chip-button" data-action="readd-history">Erneut hinzufügen</button>`
              : ""
          }
          <a class="chip-button link-chip" href="${escapeHtml(song.canonicalUrl)}" target="_blank" rel="noreferrer">YouTube</a>
        </div>
      </div>
    </article>
  `;
}

function messageCard(message, options = {}) {
  const adminMode = options.adminMode || false;
  return `
    <article class="chat-card" data-message-id="${message.id}">
      <div class="chat-line">
        <strong>${escapeHtml(message.guestName || "Gast")}</strong>
        <span>${relativeTime(message.createdAt)}</span>
      </div>
      <p>${escapeHtml(message.message)}</p>
      ${
        adminMode
          ? `
            <div class="chat-actions">
              <button class="chip-button danger" data-action="delete-message">Löschen</button>
              <button class="chip-button danger" data-action="mute-message-device">Gerät sperren</button>
            </div>
          `
          : ""
      }
    </article>
  `;
}

function emptyState(message) {
  return `<div class="song-slot empty-state"><p>${escapeHtml(message)}</p></div>`;
}

function buildAutoplayPool(history = []) {
  const unique = new Set();
  return [...history]
    .filter((song) => song.status === "played")
    .sort((left, right) => {
      if ((right.votes || 0) !== (left.votes || 0)) {
        return (right.votes || 0) - (left.votes || 0);
      }
      return new Date(right.playedAt || 0).getTime() - new Date(left.playedAt || 0).getTime();
    })
    .filter((song) => {
      if (!song?.videoId || unique.has(song.videoId)) {
        return false;
      }
      unique.add(song.videoId);
      return true;
    });
}

function autoplayCard(song) {
  const syntheticSong = {
    ...song,
    id: `autoplay-${song.videoId}`,
    guestName: "Autoplay aus Verlauf",
    addedAt: song.playedAt || song.addedAt,
  };
  return `
    <div class="mode-banner">
      <span class="tag-pill">Autoplay</span>
      <p>Queue leer. Autoplay nutzt den Verlauf.</p>
    </div>
    ${songCard(syntheticSong, { playerMode: true, highlight: true })}
  `;
}

function updateConnectionPill(connected) {
  const pill =
    document.getElementById("connection-pill") ||
    document.getElementById("player-status-pill") ||
    document.getElementById("audio-status-pill") ||
    document.getElementById("screen-connection-pill");
  if (!pill) return;
  pill.textContent = connected ? "Live verbunden" : "Verbindung verloren - reconnecting...";
  pill.classList.toggle("live-ok", connected);
}

function connectLive(onState) {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const params = new URLSearchParams({
    device_id: getDeviceId(),
    role: appConfig.clientRole || "guest",
  });
  const guestName = document.getElementById("guest-name")?.value?.trim();
  if (guestName) {
    params.set("guest_name", guestName.slice(0, 80));
  }
  let socket = null;
  let reconnectTimer = null;
  let stopped = false;
  let reconnectDelay = 1000;

  function open() {
    if (stopped) return;
    socket = new WebSocket(`${protocol}://${location.host}/ws?${params.toString()}`);

    socket.addEventListener("open", () => {
      reconnectDelay = 1000;
      updateConnectionPill(true);
    });
    socket.addEventListener("close", () => {
      updateConnectionPill(false);
      if (stopped || reconnectTimer) return;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        reconnectDelay = Math.min(reconnectDelay * 2, 10000);
        open();
      }, reconnectDelay);
    });
    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type !== "state") return;
        if (payload.runtime) Object.assign(stateStore.runtime, payload.runtime);
        if (payload.skipVoting) Object.assign(stateStore.skipVoting, payload.skipVoting);
        onState(payload);
      } catch (_error) {
        // Ignore malformed frames and keep the current UI state intact.
      }
    });
  }

  function close() {
    stopped = true;
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    socket?.close();
  }

  window.addEventListener("pagehide", close, { once: true });
  open();
  return { close };
}

function copyText(value, successMessage = "Kopiert.") {
  navigator.clipboard.writeText(value).then(
    () => toast(successMessage, "success"),
    () => toast("Kopieren fehlgeschlagen.", "error"),
  );
}

function loadYouTubeApi() {
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }
  if (window.__partyTubeYouTubeLoader) {
    return window.__partyTubeYouTubeLoader;
  }

  window.__partyTubeYouTubeLoader = new Promise((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previousReady === "function") {
        previousReady();
      }
      resolve(window.YT);
    };

    let script = document.querySelector("script[data-youtube-api='partytube']");
    if (!script) {
      script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.defer = true;
      script.dataset.youtubeApi = "partytube";
      script.addEventListener("error", () => reject(new Error("YouTube API konnte nicht geladen werden.")), {
        once: true,
      });
      document.head.appendChild(script);
    }
  });

  return window.__partyTubeYouTubeLoader;
}

function readAudioWindowStatus() {
  const lastHeartbeat = Number(localStorage.getItem(AUDIO_HEARTBEAT_KEY) || "0");
  const state = localStorage.getItem(AUDIO_STATE_KEY) || "idle";
  const title = localStorage.getItem(AUDIO_TITLE_KEY) || "";
  return {
    active: Date.now() - lastHeartbeat < AUDIO_HEARTBEAT_MAX_AGE_MS,
    state,
    title,
  };
}

function markAudioLaunchIntent() {
  localStorage.setItem(AUDIO_LAUNCH_INTENT_KEY, String(Date.now()));
}

function isAudioLaunchIntentActive() {
  const createdAt = Number(localStorage.getItem(AUDIO_LAUNCH_INTENT_KEY) || "0");
  return Date.now() - createdAt < AUDIO_LAUNCH_INTENT_TTL_MS;
}

function dispatchAudioWindowStatus() {
  const detail = readAudioWindowStatus();
  window.dispatchEvent(new CustomEvent("partytube:audio-window-status", { detail }));
  return detail;
}

function openAudioWindow() {
  const popup = window.open(appConfig.audioUrl || "/audio", AUDIO_WINDOW_NAME, "popup,width=460,height=820");
  if (!popup) {
    toast("Popup blockiert. Popups erlauben.", "error");
    return null;
  }
  popup.focus?.();
  return popup;
}

function openPlayerWindow() {
  const playerWindow = window.open(appConfig.playerUrl || "/player", "partytube-tv-window");
  if (!playerWindow) {
    toast("TV blockiert. Popups erlauben.", "error");
    return null;
  }
  playerWindow.focus?.();
  return playerWindow;
}

function launchPartyStack() {
  markAudioLaunchIntent();
  const audioWindow = openAudioWindow();
  const playerWindow = openPlayerWindow();
  return { audioWindow, playerWindow };
}

function buildAmbientAudioController() {
  const root = document.getElementById("ambient-audio-dock");
  const title = document.getElementById("ambient-song-title");
  const status = document.getElementById("ambient-audio-status");
  const toggle = document.getElementById("ambient-audio-toggle");

  if (!root || ["player", "audio", "join"].includes(appConfig.page)) {
    return {
      sync() {},
      isWindowActive() {
        return readAudioWindowStatus().active;
      },
      openWindow: openAudioWindow,
      getStatus: readAudioWindowStatus,
      hasLaunchIntent: isAudioLaunchIntentActive,
      launchPartyStack,
    };
  }

  let currentSong = null;

  function updateUi() {
    const audioStatus = dispatchAudioWindowStatus();
    root.classList.remove("hidden");

    if (!currentSong) {
      title.textContent = "Audio bereit";
      status.textContent = audioStatus.active
        ? "Wartet auf Songs."
        : "Einmal öffnen.";
      toggle.textContent = audioStatus.active ? "Audio zeigen" : "Audio";
      return;
    }

    title.textContent = currentSong.title;
    if (audioStatus.active && audioStatus.state === "playing") {
      status.textContent = "Ton läuft.";
      toggle.textContent = "Audio zeigen";
      return;
    }

    if (audioStatus.active) {
      status.textContent = "Audio offen.";
      toggle.textContent = "Audio zeigen";
      return;
    }

    status.textContent = "Audio starten.";
    toggle.textContent = "Audio";
  }

  toggle?.addEventListener("click", () => {
    const popup = openAudioWindow();
    if (popup) {
      toast("Audio-Fenster ist bereit.", "success");
      setTimeout(updateUi, 250);
    }
  });

  window.addEventListener("storage", (event) => {
    if ([AUDIO_HEARTBEAT_KEY, AUDIO_TITLE_KEY, AUDIO_STATE_KEY].includes(event.key || "")) {
      updateUi();
    }
  });

  setInterval(updateUi, 1500);
  updateUi();

  return {
    sync(song) {
      currentSong = song || null;
      updateUi();
    },
    isWindowActive() {
      return readAudioWindowStatus().active;
    },
    openWindow: openAudioWindow,
    getStatus: readAudioWindowStatus,
    hasLaunchIntent: isAudioLaunchIntentActive,
    launchPartyStack,
  };
}

window.addEventListener("storage", (event) => {
  if ([AUDIO_HEARTBEAT_KEY, AUDIO_TITLE_KEY, AUDIO_STATE_KEY].includes(event.key || "")) {
    dispatchAudioWindowStatus();
  }
});

setInterval(dispatchAudioWindowStatus, 1500);

const ambientAudio = buildAmbientAudioController();

window.PartyTube = {
  appConfig,
  stateStore,
  updateAppConfig,
  getDeviceId,
  getVotedSongs,
  rememberVote,
  clearRememberedVotes,
  escapeHtml,
  songCard,
  messageCard,
  emptyState,
  connectLive,
  apiFetch,
  toast,
  copyText,
  loadYouTubeApi,
  playbackStartSeconds,
  relativeTime,
  formatDuration,
  buildAutoplayPool,
  autoplayCard,
  ambientAudio,
  launchPartyStack,
  markAudioLaunchIntent,
  isAudioLaunchIntentActive,
  openPlayerWindow,
  audioWindowKeys: {
    heartbeat: AUDIO_HEARTBEAT_KEY,
    title: AUDIO_TITLE_KEY,
    state: AUDIO_STATE_KEY,
  },
};

