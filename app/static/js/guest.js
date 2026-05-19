(function () {
  const {
    appConfig,
    stateStore,
    getDeviceId,
    rememberVote,
    songCard,
    emptyState,
    connectLive,
    apiFetch,
    toast,
    copyText,
  } = window.PartyTube;

  const form = document.getElementById("add-song-form");
  const urlInput = document.getElementById("song-url");
  const nameInput = document.getElementById("guest-name");
  const queueList = document.getElementById("queue-list");
  const currentSong = document.getElementById("current-song");
  const historyList = document.getElementById("history-list");
  const queueCount = document.getElementById("queue-count");

  function renderCurrent(song) {
    if (!song) {
      currentSong.innerHTML = emptyState("Noch nichts aktiv. Der naechste Song startet automatisch.");
      return;
    }
    currentSong.innerHTML = songCard(song, { highlight: true, playerMode: true });
  }

  function renderQueue(queue) {
    queueCount.textContent = `${queue.length} offen`;
    queueList.innerHTML = queue.length
      ? queue.map((song) => songCard(song)).join("")
      : emptyState("Noch keine Songs in der Warteschlange.");
  }

  function renderHistory(history) {
    historyList.innerHTML = history.length
      ? history.map((song) => songCard(song, { playerMode: true })).join("")
      : emptyState("Noch kein Verlauf fuer diesen Abend.");
  }

  function renderState(payload) {
    stateStore.current = payload.current;
    stateStore.queue = payload.queue;
    stateStore.history = payload.history;
    stateStore.stats = payload.stats;
    window.PartyTube.ambientAudio.sync(payload.current);
    renderCurrent(payload.current);
    renderQueue(payload.queue);
    renderHistory(payload.history);
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = document.getElementById("submit-song");
    submit.disabled = true;
    submit.textContent = "Wird hinzugefuegt...";
    try {
      const response = await apiFetch("/api/songs", {
        method: "POST",
        body: JSON.stringify({
          url: urlInput.value,
          guestName: nameInput.value,
          deviceId: getDeviceId(),
        }),
      });
      rememberVote(response.song.id);
      form.reset();
      toast("Song ist jetzt live in der Queue.", "success");
    } catch (error) {
      if (error.status === 409 && error.payload?.duplicate) {
        toast("Song existiert schon in der aktiven Queue.", "error");
      } else {
        toast(error.message, "error");
      }
    } finally {
      submit.disabled = false;
      submit.textContent = "Song in die Queue";
    }
  });

  queueList?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action='vote']");
    if (!button) return;
    const card = button.closest("[data-song-id]");
    if (!card) return;
    const songId = Number(card.dataset.songId);
    button.disabled = true;
    try {
      await apiFetch(`/api/songs/${songId}/vote`, {
        method: "POST",
        body: JSON.stringify({ deviceId: getDeviceId() }),
      });
      rememberVote(songId);
      toast("Vote registriert.", "success");
    } catch (error) {
      button.disabled = false;
      toast(error.message, "error");
    }
  });

  document.getElementById("copy-join-link")?.addEventListener("click", () => {
    copyText(appConfig.joinUrl, "Party-Link kopiert.");
  });

  connectLive(renderState);
  apiFetch("/api/state").then(renderState).catch((error) => toast(error.message, "error"));
})();
