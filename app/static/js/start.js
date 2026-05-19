(function () {
  const {
    appConfig,
    stateStore,
    songCard,
    emptyState,
    connectLive,
    apiFetch,
    toast,
    copyText,
    ambientAudio,
    launchPartyStack,
  } = window.PartyTube;

  const launchPartyButton = document.getElementById("launch-party-stack");
  const launchAudioButton = document.getElementById("launch-audio-only");
  const copyJoinButton = document.getElementById("copy-start-join-link");
  const audioState = document.getElementById("start-audio-state");
  const currentSong = document.getElementById("start-current-song");
  const queueCount = document.getElementById("start-queue-count");
  const queueList = document.getElementById("start-queue-list");

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
      : emptyState("Kein Song aktiv. Oeffne Audio + TV und lass die ersten Tracks reinfliegen.");
  }

  function renderQueue(queue) {
    queueCount.textContent = `${queue.length} offen`;
    queueList.innerHTML = queue.length
      ? queue.slice(0, 5).map((song) => songCard(song, { playerMode: true })).join("")
      : emptyState("Noch keine Songs in der Warteschlange.");
  }

  function renderState(payload) {
    stateStore.current = payload.current;
    stateStore.queue = payload.queue;
    stateStore.history = payload.history;
    ambientAudio.sync(payload.current);
    renderAudioState();
    renderCurrent(payload.current);
    renderQueue(payload.queue);
  }

  launchPartyButton?.addEventListener("click", () => {
    const result = launchPartyStack();
    if (result.audioWindow || result.playerWindow) {
      toast("Audio-Deck und TV-Tab wurden gestartet.", "success");
      window.setTimeout(renderAudioState, 400);
    }
  });

  launchAudioButton?.addEventListener("click", () => {
    const popup = ambientAudio.openWindow();
    if (popup) {
      toast("Audio-Deck geoeffnet.", "success");
      window.setTimeout(renderAudioState, 250);
    }
  });

  copyJoinButton?.addEventListener("click", () => {
    copyText(appConfig.joinUrl, "Party-Link kopiert.");
  });

  window.addEventListener("partytube:audio-window-status", renderAudioState);

  connectLive(renderState);
  apiFetch("/api/state")
    .then(renderState)
    .catch((error) => toast(error.message, "error"));
  renderAudioState();
})();
