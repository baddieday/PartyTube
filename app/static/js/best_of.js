(function () {
  const { songCard, emptyState, apiFetch, toast, escapeHtml } = window.PartyTube;

  const list = document.getElementById("best-of-list");

  function scoreLine(song) {
    const breakdown = song.bestScoreBreakdown || {};
    return [
      `${breakdown.votes ?? song.votes ?? 0} Votes`,
      `+${breakdown.playedBonus || 0} gespielt`,
      `+${breakdown.readdBonus || 0} Re-Add`,
      `-${breakdown.skippedPenalty || 0} Skip`,
      `-${breakdown.removedPenalty || 0} entfernt`,
    ].join(" · ");
  }

  function render(bestOf) {
    if (!bestOf.length) {
      list.innerHTML = emptyState("Noch keine abgeschlossenen Songs für ein Best-of.");
      return;
    }
    list.innerHTML = bestOf
      .map(
        (song, index) => `
          <article class="best-of-card ${index < 3 ? "best-podium" : ""}">
            <div class="rank-pill">#${index + 1}</div>
            <div class="best-card-body">
              ${songCard(song, { historyMode: false, playerMode: true })}
              <p class="song-subline"><strong>${escapeHtml(song.bestScore)}</strong> Punkte · ${escapeHtml(scoreLine(song))}</p>
            </div>
          </article>
        `,
      )
      .join("");
  }

  apiFetch("/api/admin/best-of")
    .then((payload) => render(payload.bestOf || []))
    .catch((error) => toast(error.message, "error"));
})();
