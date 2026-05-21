(function () {
  const {
    appConfig,
    stateStore,
    songCard,
    emptyState,
    buildAutoplayPool,
    autoplayCard,
    connectLive,
    apiFetch,
    toast,
    loadYouTubeApi,
    playbackStartSeconds,
    audioWindowKeys,
  } = window.PartyTube;

  const queuePreview = document.getElementById("audio-queue-preview");
  const currentCard = document.getElementById("audio-current-card");
  const overlay = document.getElementById("audio-overlay");
  const resumeButton = document.getElementById("resume-audio");

  let player;
  let currentVideoId = null;
  let pendingSong = null;
  let heartbeatTimer = null;
  let currentWindowState = "idle";
  let autoplayEnabled = Boolean(appConfig.autoplayEnabled);
  let autoplayActive = false;
  let autoplayVideoId = null;
  let autoplayPool = [];
  let autoplayPoolSignature = "";
  let autoplayIndex = 0;

  function writeWindowState(state, title = "") {
    currentWindowState = state;
    localStorage.setItem(audioWindowKeys.heartbeat, String(Date.now()));
    localStorage.setItem(audioWindowKeys.state, state);
    localStorage.setItem(audioWindowKeys.title, title);
  }

  function startHeartbeat() {
    writeWindowState(currentWindowState, stateStore.current?.title || "");
    heartbeatTimer = window.setInterval(() => {
      writeWindowState(currentWindowState, stateStore.current?.title || "");
    }, 2000);
  }

  function clearHeartbeat() {
    if (heartbeatTimer) {
      window.clearInterval(heartbeatTimer);
    }
    localStorage.removeItem(audioWindowKeys.heartbeat);
    localStorage.removeItem(audioWindowKeys.state);
    localStorage.removeItem(audioWindowKeys.title);
  }

  function safePlayerState() {
    try {
      return player?.getPlayerState?.() ?? -1;
    } catch {
      return -1;
    }
  }

  function syncAutoplayPool() {
    const nextPool = buildAutoplayPool(stateStore.history);
    const nextSignature = nextPool.map((song) => song.videoId).join("|");
    if (nextSignature === autoplayPoolSignature) {
      return;
    }
    autoplayPool = nextPool;
    autoplayPoolSignature = nextSignature;
    if (autoplayActive) {
      const existingIndex = autoplayPool.findIndex((song) => song.videoId === autoplayVideoId);
      autoplayIndex = existingIndex >= 0 ? existingIndex : 0;
      return;
    }
    autoplayIndex = 0;
  }

  function pickAutoplaySong(advance = false) {
    if (!autoplayPool.length) {
      return null;
    }
    if (advance) {
      autoplayIndex = (autoplayIndex + 1) % autoplayPool.length;
      return autoplayPool[autoplayIndex];
    }
    if (autoplayActive) {
      const existingIndex = autoplayPool.findIndex((song) => song.videoId === autoplayVideoId);
      if (existingIndex >= 0) {
        autoplayIndex = existingIndex;
        return autoplayPool[autoplayIndex];
      }
    }
    const latestHistoryVideoId = stateStore.history[0]?.videoId;
    const nonRepeatingIndex = autoplayPool.findIndex((song) => song.videoId !== latestHistoryVideoId);
    autoplayIndex = nonRepeatingIndex >= 0 ? nonRepeatingIndex : 0;
    return autoplayPool[autoplayIndex];
  }

  function startAutoplayFallback(options = {}) {
    const { advance = false, forcePlayback = false } = options;
    if (!autoplayEnabled) {
      return false;
    }

    syncAutoplayPool();
    const song = pickAutoplaySong(advance);
    if (!song) {
      return false;
    }

    autoplayActive = true;
    autoplayVideoId = song.videoId;
    currentVideoId = song.videoId;
    currentCard.innerHTML = autoplayCard(song);

    if (!player) {
      return true;
    }

    const playerState = safePlayerState();
    if (
      !advance &&
      currentVideoId === song.videoId &&
      [window.YT.PlayerState.PLAYING, window.YT.PlayerState.BUFFERING].includes(playerState)
    ) {
      writeWindowState("playing", song.title);
      return true;
    }

    player.loadVideoById({ videoId: song.videoId, startSeconds: 0 });
    if (forcePlayback) {
      player.playVideo();
    }
    overlay.classList.remove("visible");
    writeWindowState("autoplay", song.title);
    return true;
  }

  function syncPlayerToSong(song, forcePlayback = false) {
    if (!player || !song) return;
    autoplayActive = false;
    autoplayVideoId = null;
    currentVideoId = song.videoId;
    const startSeconds = playbackStartSeconds(song);
    player.loadVideoById({ videoId: song.videoId, startSeconds });
    if (forcePlayback) {
      player.playVideo();
    }
    writeWindowState("loading", song.title);
  }

  function renderState(payload) {
    stateStore.current = payload.current;
    stateStore.queue = payload.queue;
    stateStore.history = payload.history;
    autoplayEnabled = payload.runtime?.autoplayEnabled ?? autoplayEnabled;
    currentCard.innerHTML = payload.current
      ? songCard(payload.current, { playerMode: true, highlight: true })
      : emptyState("Noch kein Song aktiv.");
    queuePreview.innerHTML = payload.queue.length
      ? payload.queue.slice(0, 6).map((song) => songCard(song, { playerMode: true })).join("")
      : emptyState("Queue ist leer.");

    if (!payload.current) {
      pendingSong = null;
      if (startAutoplayFallback()) {
        return;
      }
      autoplayActive = false;
      autoplayVideoId = null;
      currentVideoId = null;
      overlay.classList.remove("visible");
      writeWindowState("idle");
      if (player?.stopVideo) player.stopVideo();
      return;
    }

    pendingSong = payload.current;
    writeWindowState("ready", payload.current.title);
    if (!player) {
      return;
    }

    const state = safePlayerState();
    if (
      currentVideoId !== payload.current.videoId ||
      ![window.YT.PlayerState.PLAYING, window.YT.PlayerState.BUFFERING].includes(state)
    ) {
      syncPlayerToSong(payload.current);
    }
  }

  async function initPlayer() {
    await loadYouTubeApi();
    player = new window.YT.Player("audio-youtube-player", {
      height: "100%",
      width: "100%",
      playerVars: {
        autoplay: 1,
        controls: 0,
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
      },
      events: {
        onReady: () => {
          if (pendingSong?.videoId) {
            syncPlayerToSong(pendingSong);
            return;
          }
          if (!stateStore.current && autoplayEnabled) {
            startAutoplayFallback();
          }
        },
        onStateChange: async (event) => {
          if (event.data === window.YT.PlayerState.ENDED && autoplayActive) {
            startAutoplayFallback({ advance: true, forcePlayback: true });
            return;
          }
          if (event.data === window.YT.PlayerState.ENDED) {
            writeWindowState("ended", stateStore.current?.title || "");
            try {
              await apiFetch("/api/player/ended", { method: "POST", body: JSON.stringify({}) });
            } catch (error) {
              toast(error.message, "error");
            }
          }
          if (
            event.data === window.YT.PlayerState.PAUSED ||
            event.data === window.YT.PlayerState.CUED ||
            event.data === window.YT.PlayerState.UNSTARTED
          ) {
            overlay.classList.add("visible");
            writeWindowState("blocked", stateStore.current?.title || "");
          }
          if (event.data === window.YT.PlayerState.PLAYING) {
            overlay.classList.remove("visible");
            writeWindowState("playing", stateStore.current?.title || "");
          }
        },
        onError: () => {
          writeWindowState("error", stateStore.current?.title || "");
          toast("Audio-Fehler. Start druecken.", "error");
        },
      },
    });
  }

  resumeButton?.addEventListener("click", () => {
    try {
      if (stateStore.current?.videoId) {
        syncPlayerToSong(stateStore.current, true);
      } else {
        player?.playVideo?.();
      }
      overlay.classList.remove("visible");
    } catch {
      toast("Audio-Start fehlgeschlagen.", "error");
    }
  });

  window.addEventListener("beforeunload", clearHeartbeat);
  startHeartbeat();
  initPlayer().catch((error) => toast(error.message, "error"));
  connectLive(renderState);
  apiFetch("/api/state").then(renderState).catch((error) => toast(error.message, "error"));
})();
