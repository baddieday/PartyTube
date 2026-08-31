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
    formatDuration,
    escapeHtml,
  } = window.PartyTube;

  const currentTitle = document.getElementById("screen-current-title");
  const current = document.getElementById("screen-current");
  const nextList = document.getElementById("screen-next-list");
  const stats = document.getElementById("screen-stats");
  const skipStep = document.querySelector(".screen-skip-step");

  function screenSong(song) {
    return songCard(song, { playerMode: true, highlight: true });
  }

  function renderStats(payload) {
    const skip = payload.skipVoting || stateStore.skipVoting;
    const queueMeta = payload.queueMeta || {};
    const chips = [];
    if (appConfig.partyScreenShowActiveGuests !== false) {
      chips.push(`<span class="tag-pill">${skip.activeGuestCount || 0} aktive Gäste</span>`);
    }
    if (appConfig.partyScreenShowSkipStatus !== false && stateStore.runtime.skipVotingEnabled) {
      chips.push(
        `<span class="tag-pill">Skip ${skip.currentSkipVoteCount || 0}/${skip.skipVotesNeeded || "-"} (${skip.currentSkipVotePercent || 0}%)</span>`,
      );
    }
    if (Number.isFinite(queueMeta.totalDurationSeconds)) {
      chips.push(`<span class="tag-pill">Queue ${formatDuration(queueMeta.totalDurationSeconds)}</span>`);
    }
    stats.innerHTML = chips.join("");
  }

  function renderState(payload) {
    if (!acceptStateRevision(payload)) return;
    if (payload.runtime) {
      updateAppConfig({ runtime: payload.runtime });
    }
    if (payload.skipVoting) {
      Object.assign(stateStore.skipVoting, payload.skipVoting);
    }
    stateStore.current = payload.current;
    stateStore.queue = payload.queue || [];
    stateStore.queueMeta = payload.queueMeta || {};

    skipStep?.classList.toggle("hidden", !stateStore.runtime.skipVotingEnabled);

    if (!payload.current) {
      currentTitle.textContent = "Wartet auf den ersten Song";
      current.innerHTML = emptyState("Scanne den QR-Code und wirf den ersten Track rein.");
    } else {
      currentTitle.textContent = payload.current.title;
      current.innerHTML = screenSong(payload.current);
    }

    nextList.innerHTML = stateStore.queue.length
      ? stateStore.queue
          .slice(0, 3)
          .map(
            (song, index) => `
              <article class="screen-next-song">
                <span class="rank-pill">${index + 1}</span>
                <img src="${escapeHtml(song.thumbnailUrl)}" alt="" loading="lazy">
                <div>
                  <strong>${escapeHtml(song.title)}</strong>
                  <p>${escapeHtml(song.guestName || "Gast")} · ${song.votes || 0} Votes</p>
                </div>
              </article>
            `,
          )
          .join("")
      : emptyState("Noch keine nächsten Songs.");
    renderStats(payload);
  }

  connectLive(renderState);
  apiFetch(`/api/state?deviceId=${encodeURIComponent(window.PartyTube.getDeviceId())}&role=screen`)
    .then(renderState)
    .catch((error) => toast(error.message, "error"));
})();
