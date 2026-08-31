(function () {
  const {
    appConfig,
    stateStore,
    updateAppConfig,
    songCard,
    emptyState,
    acceptStateRevision,
    connectLive,
    apiFetch,
    toast,
    copyText,
    ambientAudio,
    launchPartyStack,
    formatDuration,
  } = window.PartyTube;

  const launchPartyButton = document.getElementById("launch-party-stack");
  const launchAudioButton = document.getElementById("launch-audio-only");
  const copyJoinButton = document.getElementById("copy-start-join-link");
  const audioState = document.getElementById("start-audio-state");
  const hostAuth = document.getElementById("start-host-auth");
  const hostAuthNote = document.getElementById("start-host-auth-note");
  const currentSong = document.getElementById("start-current-song");
  const queueCount = document.getElementById("start-queue-count");
  const queueList = document.getElementById("start-queue-list");
  const queueDuration = document.getElementById("start-queue-duration");
  const nextSong = document.getElementById("start-next-song");
  const warningList = document.getElementById("start-warning-list");
  const playerUrlLink = document.getElementById("start-player-url");
  const audioUrlLink = document.getElementById("start-audio-url");

  let hostReady = Boolean(appConfig.adminAuthenticated);

  function renderWarnings(warnings) {
    warningList.innerHTML = warnings.length
      ? warnings
          .map(
            (warning) => `
              <article class="alert-card alert-${warning.level}">
                <strong>${warning.title}</strong>
                <p>${warning.detail}</p>
              </article>
            `,
          )
          .join("")
      : "";
  }

  function renderAudioState() {
    const status = ambientAudio.getStatus();
    if (!audioState) return;

    if (status.active && status.state === "playing") {
      audioState.textContent = "Audio-Fenster spielt";
      audioState.classList.add("live-ok");
      return;
    }

    if (status.active) {
      audioState.textContent = "Audio-Fenster offen";
      audioState.classList.add("live-ok");
      return;
    }

    audioState.textContent = "Audio-Fenster aus";
    audioState.classList.remove("live-ok");
  }

  function renderCurrent(song) {
    currentSong.innerHTML = song
      ? songCard(song, { playerMode: true, highlight: true })
      : emptyState("Noch kein Song aktiv.");
  }

  function renderQueue(queue) {
    queueCount.textContent = `${queue.length} offen`;
    queueList.innerHTML = queue.length
      ? queue.slice(0, 5).map((song) => songCard(song, { playerMode: true })).join("")
      : emptyState("Noch keine Songs in der Warteschlange.");
  }

  function renderQueueMeta(queueMeta) {
    nextSong.textContent = queueMeta?.nextSong?.title || "Kein Song";
    queueDuration.textContent = Number.isFinite(queueMeta?.totalDurationSeconds)
      ? formatDuration(queueMeta.totalDurationSeconds)
      : "Teilweise unbekannt";
  }

  function renderState(payload) {
    if (!acceptStateRevision(payload)) return;
    stateStore.current = payload.current;
    stateStore.queue = payload.queue;
    stateStore.history = payload.history;
    stateStore.queueMeta = payload.queueMeta || {};
    if (payload.runtime) {
      updateAppConfig({ runtime: payload.runtime });
    }
    ambientAudio.sync(payload.current);
    renderAudioState();
    renderCurrent(payload.current);
    renderQueue(payload.queue);
    renderQueueMeta(payload.queueMeta || {});
  }

  function renderHostStatus(payload) {
    hostReady = Boolean(payload.authenticated);
    updateAppConfig({
      adminAuthenticated: hostReady,
      csrfToken: payload.csrfToken || "",
      playerUrl: payload.playerUrl || "/player",
      audioUrl: payload.audioUrl || "/audio",
      securePlayerUrl: payload.playerUrl || "/player",
      secureAudioUrl: payload.audioUrl || "/audio",
    });
    playerUrlLink.href = payload.playerUrl || "/player";
    audioUrlLink.href = payload.audioUrl || "/audio";
    playerUrlLink.textContent = hostReady ? payload.playerUrl : "Nach Host-Login abgesichert";
    audioUrlLink.textContent = hostReady ? payload.audioUrl : "Nach Host-Login abgesichert";

    if (hostReady) {
      hostAuth.textContent = "Host-Login aktiv";
      hostAuth.classList.add("live-ok");
      hostAuthNote.textContent = "Audio + TV gesichert.";
    } else {
      hostAuth.textContent = "Host-Login fehlt";
      hostAuth.classList.remove("live-ok");
      hostAuthNote.textContent = "Einmal in /admin einloggen.";
    }

    renderWarnings(payload.warnings || appConfig.warnings || []);
  }

  launchPartyButton?.addEventListener("click", () => {
    if (!hostReady) {
      toast("Bitte zuerst im Host-Bereich einloggen.", "error");
      window.location.href = "/admin";
      return;
    }
    const result = launchPartyStack();
    if (result.audioWindow || result.playerWindow) {
      toast("Audio-Deck und TV-Tab wurden gestartet.", "success");
      window.setTimeout(renderAudioState, 400);
    }
  });

  launchAudioButton?.addEventListener("click", () => {
    if (!hostReady) {
      toast("Bitte zuerst im Host-Bereich einloggen.", "error");
      window.location.href = "/admin";
      return;
    }
    const popup = ambientAudio.openWindow();
    if (popup) {
      toast("Audio-Deck geöffnet.", "success");
      window.setTimeout(renderAudioState, 250);
    }
  });

  copyJoinButton?.addEventListener("click", () => {
    copyText(appConfig.joinUrl, "Party-Link kopiert.");
  });

  window.addEventListener("partytube:audio-window-status", renderAudioState);

  connectLive(renderState);
  Promise.all([apiFetch("/api/state"), apiFetch("/api/admin/status")])
    .then(([statePayload, statusPayload]) => {
      renderState(statePayload);
      renderHostStatus(statusPayload);
    })
    .catch((error) => toast(error.message, "error"));
  renderAudioState();
})();
