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
    ambientAudio,
  } = window.PartyTube;

  const queuePreview = document.getElementById("player-queue-preview");
  const currentCard = document.getElementById("player-current-card");
  const controlOverlay = document.getElementById("player-control-overlay");
  const resumeButton = document.getElementById("resume-playback");
  const pauseButton = document.getElementById("pause-playback");
  const stopButton = document.getElementById("stop-playback");
  const controlHint = document.getElementById("player-control-hint");
  const modeNote = document.getElementById("player-mode-note");
  const activationKey = "partytube:player:tvActivated:v1";

  let player;
  let currentVideoId = null;
  let pendingSong = null;
  let autoplayEnabled = Boolean(appConfig.autoplayEnabled);
  let autoplayActive = false;
  let autoplayVideoId = null;
  let autoplayPool = [];
  let autoplayPoolSignature = "";
  let autoplayIndex = 0;
  let playbackStopped = false;
  let playbackPaused = false;

  function rememberActivation() {
    sessionStorage.setItem(activationKey, "1");
  }

  function hasActivation() {
    return sessionStorage.getItem(activationKey) === "1";
  }

  function setControlHint(text) {
    if (controlHint) {
      controlHint.textContent = text;
    }
  }

  function showPlaybackControls(text = "Bereit") {
    setControlHint(text);
    controlOverlay?.classList.add("visible");
  }

  function hidePlaybackControls() {
    controlOverlay?.classList.remove("visible");
  }

  function safePlayerState() {
    try {
      return player?.getPlayerState?.() ?? -1;
    } catch {
      return -1;
    }
  }

  function shouldUseVideoOnlyMode() {
    return ambientAudio.isWindowActive() || ambientAudio.hasLaunchIntent?.();
  }

  function applyPlaybackMode() {
    if (!player) return;
    if (shouldUseVideoOnlyMode()) {
      player.mute?.();
      if (modeNote) {
        modeNote.textContent = ambientAudio.isWindowActive()
          ? "Audio aktiv. TV bleibt stumm."
          : "Audio startet. TV bleibt stumm.";
      }
      return;
    }

    player.unMute?.();
    if (modeNote) {
      modeNote.textContent = "Kein Audio-Fenster aktiv. TV spielt Ton.";
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
    if (!autoplayEnabled || playbackStopped) {
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
    playbackPaused = false;
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
      applyPlaybackMode();
      return true;
    }

    const startSeconds = 0;
    applyPlaybackMode();
    if (shouldUseVideoOnlyMode() || hasActivation() || forcePlayback) {
      if (forcePlayback) {
        rememberActivation();
      }
      player.loadVideoById({ videoId: song.videoId, startSeconds });
      hidePlaybackControls();
      return true;
    }

    player.cueVideoById({ videoId: song.videoId, startSeconds });
    showPlaybackControls("Browser blockiert? Play drücken.");
    return true;
  }

  function syncPlayerToSong(song, forcePlayback = false) {
    if (!player || !song) return;
    autoplayActive = false;
    autoplayVideoId = null;
    playbackStopped = false;
    playbackPaused = false;
    currentVideoId = song.videoId;
    const startSeconds = playbackStartSeconds(song);
    applyPlaybackMode();

    if (shouldUseVideoOnlyMode() || hasActivation() || forcePlayback) {
      if (forcePlayback) {
        rememberActivation();
      }
      player.loadVideoById({ videoId: song.videoId, startSeconds });
      hidePlaybackControls();
      return;
    }

    player.cueVideoById({ videoId: song.videoId, startSeconds });
    showPlaybackControls("Browser blockiert? Play drücken.");
  }

  function renderState(payload) {
    const previousVideoId = stateStore.current?.videoId;
    stateStore.current = payload.current;
    stateStore.queue = payload.queue;
    stateStore.history = payload.history;
    autoplayEnabled = payload.runtime?.autoplayEnabled ?? autoplayEnabled;
    currentCard.innerHTML = payload.current
      ? songCard(payload.current, { playerMode: true, highlight: true })
      : emptyState("Keine Wiedergabe aktiv.");
    queuePreview.innerHTML = payload.queue.length
      ? payload.queue.slice(0, 3).map((song) => songCard(song, { playerMode: true })).join("")
      : emptyState("Queue ist leer.");

    if (payload.current?.videoId && payload.current.videoId !== previousVideoId) {
      playbackStopped = false;
      playbackPaused = false;
    }

    if (!payload.current) {
      pendingSong = null;
      if (startAutoplayFallback()) {
        return;
      }
      autoplayActive = false;
      autoplayVideoId = null;
      currentVideoId = null;
      hidePlaybackControls();
      if (player?.stopVideo) player.stopVideo();
      return;
    }

    pendingSong = payload.current;
    if (!player) {
      return;
    }

    if (playbackStopped && currentVideoId === payload.current.videoId) {
      showPlaybackControls("Gestoppt");
      return;
    }

    if (playbackPaused && currentVideoId === payload.current.videoId) {
      showPlaybackControls("Pausiert");
      return;
    }

    const state = safePlayerState();
    if (
      currentVideoId !== payload.current.videoId ||
      ![window.YT.PlayerState.PLAYING, window.YT.PlayerState.BUFFERING].includes(state)
    ) {
      syncPlayerToSong(payload.current);
      return;
    }

    applyPlaybackMode();
  }

  async function initPlayer() {
    await loadYouTubeApi();
    player = new window.YT.Player("youtube-player", {
      height: "100%",
      width: "100%",
      playerVars: {
        autoplay: 1,
        controls: 1,
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
          if (event.data === window.YT.PlayerState.ENDED && !shouldUseVideoOnlyMode()) {
            try {
              await apiFetch("/api/player/ended", { method: "POST", body: JSON.stringify({}) });
            } catch (error) {
              toast(error.message, "error");
            }
          }
          if (event.data === window.YT.PlayerState.PAUSED) {
            playbackPaused = true;
            showPlaybackControls("Pausiert");
          }
          if (event.data === window.YT.PlayerState.CUED || event.data === window.YT.PlayerState.UNSTARTED) {
            if (!hasActivation()) {
              showPlaybackControls("Browser blockiert? Play drücken.");
            }
          }
          if (event.data === window.YT.PlayerState.PLAYING) {
            playbackStopped = false;
            playbackPaused = false;
            rememberActivation();
            hidePlaybackControls();
          }
        },
        onError: () => {
          toast("YouTube-Fehler. Nächsten Song starten.", "error");
        },
      },
    });
  }

  resumeButton?.addEventListener("click", () => {
    try {
      playbackStopped = false;
      playbackPaused = false;
      rememberActivation();
      if (stateStore.current?.videoId) {
        syncPlayerToSong(stateStore.current, true);
      } else if (autoplayActive && autoplayVideoId) {
        player?.loadVideoById?.({ videoId: autoplayVideoId, startSeconds: 0 });
      } else {
        player?.playVideo?.();
      }
      hidePlaybackControls();
    } catch {
      toast("Start fehlgeschlagen.", "error");
    }
  });

  pauseButton?.addEventListener("click", () => {
    try {
      playbackStopped = false;
      playbackPaused = true;
      rememberActivation();
      player?.pauseVideo?.();
      showPlaybackControls("Pausiert");
    } catch {
      toast("Pause fehlgeschlagen.", "error");
    }
  });

  stopButton?.addEventListener("click", () => {
    try {
      playbackStopped = true;
      playbackPaused = false;
      rememberActivation();
      autoplayActive = false;
      autoplayVideoId = null;
      player?.stopVideo?.();
      showPlaybackControls("Gestoppt");
    } catch {
      toast("Stop fehlgeschlagen.", "error");
    }
  });

  window.addEventListener("partytube:audio-window-status", () => {
    applyPlaybackMode();
  });

  initPlayer().catch((error) => toast(error.message, "error"));
  connectLive(renderState);
  apiFetch("/api/state").then(renderState).catch((error) => toast(error.message, "error"));
})();
