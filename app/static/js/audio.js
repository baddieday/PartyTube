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

  const ALLOWED_CROSSFADE_SECONDS = new Set([0, 1, 2, 3, 5, 10]);
  const TRANSITION_POLL_MS = 250;
  const TRANSITION_START_TIMEOUT_MS = 4000;
  const queuePreview = document.getElementById("audio-queue-preview");
  const currentCard = document.getElementById("audio-current-card");
  const overlay = document.getElementById("audio-overlay");
  const resumeButton = document.getElementById("resume-audio");
  const transitionNote = document.getElementById("audio-transition-note");
  const deckElements = [
    document.getElementById("audio-youtube-player-a"),
    document.getElementById("audio-youtube-player-b"),
  ];

  const players = [null, null];
  const ready = [false, false];
  const deckVideoIds = [null, null];
  let activeDeckIndex = 0;
  let currentVideoId = null;
  let pendingSong = null;
  let heartbeatTimer = null;
  let transitionPollTimer = null;
  let currentWindowState = "idle";
  let crossfadeSeconds = normalizeCrossfadeSeconds(appConfig.crossfadeSeconds);
  let transition = null;
  let advanceInFlight = false;
  let autoplayEnabled = Boolean(appConfig.autoplayEnabled);
  let autoplayActive = false;
  let autoplayVideoId = null;
  let autoplayPool = [];
  let autoplayPoolSignature = "";
  let autoplayIndex = 0;

  function normalizeCrossfadeSeconds(value) {
    const seconds = Number(value || 0);
    return ALLOWED_CROSSFADE_SECONDS.has(seconds) ? seconds : 0;
  }

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
    if (heartbeatTimer) window.clearInterval(heartbeatTimer);
    localStorage.removeItem(audioWindowKeys.heartbeat);
    localStorage.removeItem(audioWindowKeys.state);
    localStorage.removeItem(audioWindowKeys.title);
  }

  function playerCall(index, method, ...args) {
    try {
      return players[index]?.[method]?.(...args);
    } catch (_error) {
      return undefined;
    }
  }

  function playerState(index) {
    return Number(playerCall(index, "getPlayerState") ?? -1);
  }

  function playerNumber(index, method) {
    const value = Number(playerCall(index, method));
    return Number.isFinite(value) ? value : 0;
  }

  function setActiveDeck(index) {
    activeDeckIndex = index;
    deckElements.forEach((element, deckIndex) => element?.classList.toggle("active", deckIndex === index));
  }

  function updateTransitionNote() {
    if (!transitionNote) return;
    if (!appConfig.playerAuthorized && crossfadeSeconds > 0) {
      transitionNote.textContent = "Übergang braucht den Host-Link.";
      return;
    }
    transitionNote.textContent = crossfadeSeconds > 0
      ? `Übergang ${crossfadeSeconds} s.`
      : "Übergang aus.";
  }

  function clearTransitionTimers(candidate) {
    if (!candidate) return;
    if (candidate.startTimeout) window.clearTimeout(candidate.startTimeout);
    if (candidate.rampTimer) window.clearInterval(candidate.rampTimer);
  }

  function cancelTransition({ stopTarget = true } = {}) {
    const candidate = transition;
    if (!candidate) return;
    clearTransitionTimers(candidate);
    playerCall(candidate.sourceIndex, "setVolume", 100);
    if (stopTarget) {
      playerCall(candidate.targetIndex, "stopVideo");
      playerCall(candidate.targetIndex, "mute");
      deckVideoIds[candidate.targetIndex] = null;
    }
    transition = null;
  }

  function syncAutoplayPool() {
    const nextPool = buildAutoplayPool(stateStore.history);
    const nextSignature = nextPool.map((song) => song.videoId).join("|");
    if (nextSignature === autoplayPoolSignature) return;
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
    if (!autoplayPool.length) return null;
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
    const nextIndex = autoplayPool.findIndex((song) => song.videoId !== latestHistoryVideoId);
    autoplayIndex = nextIndex >= 0 ? nextIndex : 0;
    return autoplayPool[autoplayIndex];
  }

  function startAutoplayFallback({ advance = false, forcePlayback = false } = {}) {
    if (!autoplayEnabled || !ready[activeDeckIndex]) return false;
    syncAutoplayPool();
    const song = pickAutoplaySong(advance);
    if (!song) return false;

    cancelTransition();
    const standbyIndex = 1 - activeDeckIndex;
    playerCall(standbyIndex, "stopVideo");
    deckVideoIds[standbyIndex] = null;
    autoplayActive = true;
    autoplayVideoId = song.videoId;
    currentVideoId = song.videoId;
    currentCard.innerHTML = autoplayCard(song);
    deckVideoIds[activeDeckIndex] = song.videoId;
    playerCall(activeDeckIndex, "setVolume", 100);
    playerCall(activeDeckIndex, "unMute");
    playerCall(activeDeckIndex, "loadVideoById", { videoId: song.videoId, startSeconds: 0 });
    if (forcePlayback) playerCall(activeDeckIndex, "playVideo");
    overlay?.classList.remove("visible");
    writeWindowState("autoplay", song.title);
    return true;
  }

  function preloadNextSong() {
    if (
      crossfadeSeconds <= 0 ||
      !appConfig.playerAuthorized ||
      transition ||
      !stateStore.current ||
      !stateStore.queue[0]
    ) {
      return;
    }
    const standbyIndex = 1 - activeDeckIndex;
    const nextSong = stateStore.queue[0];
    if (!ready[standbyIndex] || deckVideoIds[standbyIndex] === nextSong.videoId) return;
    playerCall(standbyIndex, "stopVideo");
    playerCall(standbyIndex, "setVolume", 0);
    playerCall(standbyIndex, "mute");
    playerCall(standbyIndex, "cueVideoById", { videoId: nextSong.videoId, startSeconds: 0 });
    deckVideoIds[standbyIndex] = nextSong.videoId;
  }

  function syncPlayerToSong(song, forcePlayback = false) {
    if (!ready.every(Boolean) || !song) return;
    if (currentVideoId === song.videoId && deckVideoIds[activeDeckIndex] === song.videoId) {
      if (forcePlayback) playerCall(activeDeckIndex, "playVideo");
      preloadNextSong();
      return;
    }

    cancelTransition();
    const standbyIndex = 1 - activeDeckIndex;
    playerCall(standbyIndex, "stopVideo");
    playerCall(standbyIndex, "mute");
    deckVideoIds[standbyIndex] = null;
    autoplayActive = false;
    autoplayVideoId = null;
    currentVideoId = song.videoId;
    deckVideoIds[activeDeckIndex] = song.videoId;
    playerCall(activeDeckIndex, "setVolume", 100);
    playerCall(activeDeckIndex, "unMute");
    playerCall(activeDeckIndex, "loadVideoById", {
      videoId: song.videoId,
      startSeconds: playbackStartSeconds(song),
    });
    if (forcePlayback) playerCall(activeDeckIndex, "playVideo");
    writeWindowState("loading", song.title);
    preloadNextSong();
  }

  async function advanceServerCurrent() {
    if (advanceInFlight || !appConfig.playerAuthorized) {
      if (!appConfig.playerAuthorized) overlay?.classList.add("visible");
      return;
    }
    advanceInFlight = true;
    try {
      await apiFetch("/api/player/ended", { method: "POST", body: JSON.stringify({}) });
    } catch (error) {
      overlay?.classList.add("visible");
      toast(error.message, "error");
    } finally {
      advanceInFlight = false;
    }
  }

  async function finishCrossfade(candidate) {
    if (!transition || transition !== candidate || candidate.phase === "finishing") return;
    candidate.phase = "finishing";
    clearTransitionTimers(candidate);
    playerCall(candidate.sourceIndex, "setVolume", 0);
    playerCall(candidate.sourceIndex, "stopVideo");
    playerCall(candidate.targetIndex, "setVolume", 100);
    setActiveDeck(candidate.targetIndex);
    currentVideoId = candidate.nextSong.videoId;
    deckVideoIds[candidate.sourceIndex] = null;
    transition = null;
    writeWindowState("playing", candidate.nextSong.title);
    await advanceServerCurrent();
  }

  function startVolumeRamp(candidate) {
    if (!transition || transition !== candidate || candidate.phase !== "starting") return;
    if (candidate.startTimeout) window.clearTimeout(candidate.startTimeout);
    candidate.phase = "ramping";
    candidate.startedAt = performance.now();
    const durationMs = Math.max(1, crossfadeSeconds * 1000);

    candidate.rampTimer = window.setInterval(() => {
      if (!transition || transition !== candidate) return;
      const progress = Math.min(1, (performance.now() - candidate.startedAt) / durationMs);
      const targetVolume = Math.round(progress * 100);
      playerCall(candidate.sourceIndex, "setVolume", 100 - targetVolume);
      playerCall(candidate.targetIndex, "setVolume", targetVolume);
      if (progress >= 1) finishCrossfade(candidate);
    }, 100);
  }

  function maybeStartCrossfade() {
    if (
      transition ||
      crossfadeSeconds <= 0 ||
      !appConfig.playerAuthorized ||
      !stateStore.current ||
      !stateStore.queue[0] ||
      playerState(activeDeckIndex) !== window.YT?.PlayerState?.PLAYING
    ) {
      return;
    }

    const duration = playerNumber(activeDeckIndex, "getDuration");
    const currentTime = playerNumber(activeDeckIndex, "getCurrentTime");
    const remaining = duration - currentTime;
    if (duration <= crossfadeSeconds + 1 || remaining <= 0 || remaining > crossfadeSeconds + 0.25) return;

    const sourceIndex = activeDeckIndex;
    const targetIndex = 1 - sourceIndex;
    const nextSong = stateStore.queue[0];
    const candidate = {
      sourceIndex,
      targetIndex,
      nextSong,
      phase: "starting",
      startTimeout: null,
      rampTimer: null,
      startedAt: 0,
    };
    transition = candidate;
    deckVideoIds[targetIndex] = nextSong.videoId;
    playerCall(targetIndex, "setVolume", 0);
    playerCall(targetIndex, "unMute");
    playerCall(targetIndex, "loadVideoById", { videoId: nextSong.videoId, startSeconds: 0 });
    playerCall(targetIndex, "playVideo");
    candidate.startTimeout = window.setTimeout(() => {
      if (transition === candidate && candidate.phase === "starting") cancelTransition();
    }, TRANSITION_START_TIMEOUT_MS);
  }

  async function onPlayerStateChange(index, event) {
    if (transition && index === transition.targetIndex) {
      if (event.data === window.YT.PlayerState.PLAYING) startVolumeRamp(transition);
      return;
    }
    if (index !== activeDeckIndex) return;

    if (event.data === window.YT.PlayerState.ENDED) {
      if (transition) {
        const candidate = transition;
        if (candidate.phase === "ramping") {
          await finishCrossfade(candidate);
          return;
        }
        cancelTransition();
      }
      if (autoplayActive) {
        startAutoplayFallback({ advance: true, forcePlayback: true });
        return;
      }
      writeWindowState("ended", stateStore.current?.title || "");
      await advanceServerCurrent();
      return;
    }

    if (
      event.data === window.YT.PlayerState.PAUSED ||
      event.data === window.YT.PlayerState.CUED ||
      event.data === window.YT.PlayerState.UNSTARTED
    ) {
      overlay?.classList.add("visible");
      writeWindowState("blocked", stateStore.current?.title || "");
    }
    if (event.data === window.YT.PlayerState.PLAYING) {
      overlay?.classList.remove("visible");
      writeWindowState("playing", stateStore.current?.title || "");
      preloadNextSong();
    }
  }

  function onPlayerError(index) {
    if (transition && index === transition.targetIndex) {
      cancelTransition();
      toast("Überblendung blockiert. Normaler Wechsel bleibt aktiv.", "error");
      return;
    }
    if (index === activeDeckIndex) {
      writeWindowState("error", stateStore.current?.title || "");
      overlay?.classList.add("visible");
      toast("Audio-Fehler. Start drücken.", "error");
    }
  }

  function renderState(payload) {
    stateStore.current = payload.current;
    stateStore.queue = payload.queue || [];
    stateStore.history = payload.history || [];
    autoplayEnabled = payload.runtime?.autoplayEnabled ?? autoplayEnabled;
    crossfadeSeconds = normalizeCrossfadeSeconds(payload.runtime?.crossfadeSeconds ?? crossfadeSeconds);
    updateTransitionNote();
    currentCard.innerHTML = payload.current
      ? songCard(payload.current, { playerMode: true, highlight: true })
      : emptyState("Noch kein Song aktiv.");
    queuePreview.innerHTML = stateStore.queue.length
      ? stateStore.queue.slice(0, 3).map((song) => songCard(song, { playerMode: true })).join("")
      : emptyState("Queue ist leer.");

    if (!payload.current) {
      pendingSong = null;
      if (startAutoplayFallback()) return;
      autoplayActive = false;
      autoplayVideoId = null;
      currentVideoId = null;
      cancelTransition();
      players.forEach((_player, index) => {
        playerCall(index, "stopVideo");
        deckVideoIds[index] = null;
      });
      overlay?.classList.remove("visible");
      writeWindowState("idle");
      return;
    }

    pendingSong = payload.current;
    writeWindowState("ready", payload.current.title);
    if (ready.every(Boolean)) syncPlayerToSong(payload.current);
  }

  function createPlayer(index) {
    return new window.YT.Player(deckElements[index].id, {
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
          ready[index] = true;
          playerCall(index, "setVolume", index === activeDeckIndex ? 100 : 0);
          if (index !== activeDeckIndex) playerCall(index, "mute");
          if (!ready.every(Boolean)) return;
          if (pendingSong?.videoId) {
            syncPlayerToSong(pendingSong);
          } else if (!stateStore.current && autoplayEnabled) {
            startAutoplayFallback();
          }
        },
        onStateChange: (event) => onPlayerStateChange(index, event),
        onError: () => onPlayerError(index),
      },
    });
  }

  async function initPlayers() {
    await loadYouTubeApi();
    setActiveDeck(0);
    players[0] = createPlayer(0);
    players[1] = createPlayer(1);
    transitionPollTimer = window.setInterval(maybeStartCrossfade, TRANSITION_POLL_MS);
  }

  resumeButton?.addEventListener("click", () => {
    try {
      if (stateStore.current?.videoId) {
        syncPlayerToSong(stateStore.current, true);
      } else if (autoplayActive) {
        playerCall(activeDeckIndex, "playVideo");
      }
      overlay?.classList.remove("visible");
    } catch (_error) {
      toast("Audio-Start fehlgeschlagen.", "error");
    }
  });

  function cleanup() {
    clearHeartbeat();
    if (transitionPollTimer) window.clearInterval(transitionPollTimer);
    cancelTransition();
    players.forEach((_player, index) => playerCall(index, "destroy"));
  }

  window.addEventListener("pagehide", cleanup, { once: true });
  startHeartbeat();
  updateTransitionNote();
  initPlayers().catch((error) => toast(error.message, "error"));
  connectLive(renderState);
  apiFetch(`/api/state?deviceId=${encodeURIComponent(window.PartyTube.getDeviceId())}&role=audio`)
    .then(renderState)
    .catch((error) => toast(error.message, "error"));
})();
