(function () {
  const {
    stateStore,
    updateAppConfig,
    getDeviceId,
    songCard,
    emptyState,
    acceptStateRevision,
    connectLive,
    apiFetch,
    toast,
  } = window.PartyTube;

  const list = document.getElementById("history-page-list");
  const count = document.getElementById("history-count");
  const form = document.getElementById("history-filter-form");
  const statusFilter = document.getElementById("history-status-filter");
  const searchInput = document.getElementById("history-search");

  function renderHistory(history) {
    count.textContent = `${history.length} Song${history.length === 1 ? "" : "s"}`;
    list.innerHTML = history.length
      ? history.map((song) => songCard(song, { historyMode: true })).join("")
      : emptyState("Noch kein Verlauf für diesen Abend.");
  }

  function renderState(payload) {
    if (!acceptStateRevision(payload)) return;
    if (payload.runtime) {
      updateAppConfig({ runtime: payload.runtime });
    }
    if (payload.skipVoting) {
      Object.assign(stateStore.skipVoting, payload.skipVoting);
    }
    stateStore.history = payload.history || stateStore.history;
    renderHistory(stateStore.history);
  }

  async function loadFilteredHistory() {
    const params = new URLSearchParams({
      status: statusFilter.value || "all",
      q: searchInput.value || "",
    });
    const payload = await apiFetch(`/api/history?${params.toString()}`);
    stateStore.history = payload.history || [];
    renderHistory(stateStore.history);
  }

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    loadFilteredHistory().catch((error) => toast(error.message, "error"));
  });

  list?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action='readd-history']");
    if (!button) return;
    const card = button.closest("[data-song-id]");
    if (!card) return;
    button.disabled = true;
    try {
      const response = await apiFetch(`/api/history/${Number(card.dataset.songId)}/readd`, {
        method: "POST",
        body: JSON.stringify({ deviceId: getDeviceId(), guestName: document.getElementById("guest-name")?.value || "" }),
      });
      toast(`Wieder in der Queue: ${response.song?.title || "Song"}`, "success");
    } catch (error) {
      button.disabled = false;
      if (error.status === 409 && error.payload?.duplicate) {
        toast(`Song ist bereits in der Warteschlange: ${error.payload.duplicate.title || ""}`, "error");
      } else {
        toast(error.message, "error");
      }
    }
  });

  connectLive(renderState);
  loadFilteredHistory().catch((error) => toast(error.message, "error"));
})();
