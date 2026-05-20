(function () {
  const {
    appConfig,
    stateStore,
    updateAppConfig,
    getDeviceId,
    rememberVote,
    songCard,
    messageCard,
    emptyState,
    connectLive,
    apiFetch,
    toast,
    copyText,
    formatDuration,
  } = window.PartyTube;

  const form = document.getElementById("add-song-form");
  const urlInput = document.getElementById("song-url");
  const nameInput = document.getElementById("guest-name");
  const queueList = document.getElementById("queue-list");
  const currentSong = document.getElementById("current-song");
  const historyList = document.getElementById("history-list");
  const queueCount = document.getElementById("queue-count");
  const queueDuration = document.getElementById("queue-duration");
  const nextSongHint = document.getElementById("next-song-hint");
  const runtimeAlerts = document.getElementById("guest-runtime-alerts");
  const messageForm = document.getElementById("message-form");
  const messageInput = document.getElementById("chat-message");
  const messageList = document.getElementById("chat-list");
  const chatCount = document.getElementById("chat-count");
  const chatStatusNote = document.getElementById("chat-status-note");
  const chatPanel = document.getElementById("chat-panel");

  function retryHint(error) {
    if (!error?.retryAfterSeconds) {
      return "";
    }
    return ` Bitte in ca. ${error.retryAfterSeconds}s erneut versuchen.`;
  }

  function renderAlerts(runtime) {
    const alerts = [];
    if (runtime.inviteOnlyMode) {
      alerts.push({
        level: "info",
        title: "Invite-only aktiv",
        detail: "Der Party-Code ist der Einladungslink fuer diese Session. Teile am besten den QR-Code oder `/join/{code}`.",
      });
    }
    if (!runtime.votingEnabled) {
      alerts.push({
        level: "warning",
        title: "Voting pausiert",
        detail: "Der Host hat Voting aktuell deaktiviert. Songs koennen weiterhin in die Queue gelegt werden.",
      });
    }
    if (!runtime.chatEnabled) {
      alerts.push({
        level: "info",
        title: "Chat pausiert",
        detail: "Der Chat ist aktuell ausgeschaltet. Queue und Live-Updates laufen weiter.",
      });
    }
    if (stateStore.skipVoting?.lastTriggered) {
      alerts.push({
        level: "info",
        title: "Demokratisch uebersprungen",
        detail: "Der aktuelle Song wurde per Skip-Voting beendet. Der naechste Track laeuft an.",
      });
      stateStore.skipVoting.lastTriggered = false;
    }

    runtimeAlerts.innerHTML = alerts.length
      ? alerts
          .map(
            (alert) => `
              <article class="alert-card alert-${alert.level}">
                <strong>${alert.title}</strong>
                <p>${alert.detail}</p>
              </article>
            `,
          )
          .join("")
      : "";
  }

  function renderCurrent(song) {
    if (!song) {
      currentSong.innerHTML = emptyState("Noch nichts aktiv. Der naechste Song startet automatisch.");
      return;
    }
    const skip = stateStore.skipVoting || {};
    const neededText = skip.skipVotesNeeded
      ? `${skip.currentSkipVoteCount || 0}/${skip.skipVotesNeeded} Stimmen`
      : `${skip.currentSkipVoteCount || 0} Stimmen`;
    const skipPanel =
      stateStore.runtime.skipVotingEnabled
        ? `
          <div class="skip-vote-panel" aria-live="polite">
            <div>
              <strong>Song-Veto</strong>
              <p>${neededText} · ${skip.activeGuestCount || 0} aktive Gaeste · Schwelle ${skip.skipThresholdPercent || stateStore.runtime.skipThresholdPercent}%</p>
            </div>
            <button class="primary-button" id="skip-vote-button" type="button" ${skip.hasCurrentDeviceSkipVoted ? "disabled" : ""}>
              ${skip.hasCurrentDeviceSkipVoted ? "Skip-Vote abgegeben" : "Song ueberspringen"}
            </button>
          </div>
        `
        : `<div class="skip-vote-panel muted"><p>Skip-Voting ist vom Host deaktiviert.</p></div>`;
    currentSong.innerHTML = `${songCard(song, { highlight: true, playerMode: true })}${skipPanel}`;
  }

  function renderQueue(queue) {
    queueCount.textContent = `${queue.length} offen`;
    queueList.innerHTML = queue.length
      ? queue.map((song) => songCard(song)).join("")
      : emptyState("Noch keine Songs in der Warteschlange.");
  }

  function renderQueueMeta(queueMeta) {
    const nextSong = queueMeta?.nextSong;
    nextSongHint.textContent = nextSong ? nextSong.title : "Noch kein naechster Song";
    if (Number.isFinite(queueMeta?.totalDurationSeconds)) {
      queueDuration.textContent = formatDuration(queueMeta.totalDurationSeconds);
      return;
    }
    queueDuration.textContent = "Teilweise unbekannt";
  }

  function renderHistory(history) {
    historyList.innerHTML = history.length
      ? history.map((song) => songCard(song, { historyMode: true })).join("")
      : emptyState("Noch kein Verlauf fuer diesen Abend.");
  }

  function renderMessages(messages, runtime) {
    chatPanel?.classList.toggle("chat-disabled", !runtime.chatEnabled);
    if (messageForm) {
      messageForm.classList.toggle("hidden", !runtime.chatEnabled);
    }
    if (chatStatusNote) {
      chatStatusNote.textContent = runtime.chatEnabled
        ? "Kurze Messages laufen live auf allen Geraeten mit."
        : "Der Host hat den Chat fuer diese Party aktuell deaktiviert.";
    }
    chatCount.textContent = `${messages.length} live`;
    messageList.innerHTML = messages.length
      ? messages.map((message) => messageCard(message)).join("")
      : emptyState(runtime.chatEnabled ? "Noch keine Chat-Nachrichten." : "Chat ist aktuell deaktiviert.");
  }

  function renderState(payload) {
    stateStore.current = payload.current;
    stateStore.queue = payload.queue;
    stateStore.history = payload.history;
    stateStore.messages = payload.messages || [];
    stateStore.queueMeta = payload.queueMeta || {};
    stateStore.stats = payload.stats || stateStore.stats;
    if (payload.skipVoting) {
      const previousSongId = stateStore.skipVoting?.currentSongId;
      const previousVotes = stateStore.skipVoting?.currentSkipVoteCount || 0;
      Object.assign(stateStore.skipVoting, payload.skipVoting);
      if (previousSongId && payload.current?.id !== previousSongId && previousVotes > 0) {
        stateStore.skipVoting.lastTriggered = true;
      }
    }
    if (payload.runtime) {
      updateAppConfig({ runtime: payload.runtime });
    }

    window.PartyTube.ambientAudio.sync(payload.current);
    renderAlerts(stateStore.runtime);
    renderCurrent(payload.current);
    renderQueue(payload.queue);
    renderQueueMeta(payload.queueMeta || {});
    renderHistory(payload.history);
    renderMessages(payload.messages || [], stateStore.runtime);
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
      urlInput.value = "";
      toast(`Song ist live in der Queue: ${response.song.title}`, "success");
    } catch (error) {
      if (error.status === 409 && error.payload?.duplicate) {
        const duplicate = error.payload.duplicate;
        toast(`Schon in der Queue: ${duplicate.title}`, "error");
      } else if (error.status === 429) {
        toast(`${error.message}${retryHint(error)}`, "error");
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
    if (!stateStore.runtime.votingEnabled) {
      toast("Voting ist fuer diese Party aktuell deaktiviert.", "error");
      return;
    }
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
      if (error.status === 429) {
        toast(`${error.message}${retryHint(error)}`, "error");
      } else {
        toast(error.message, "error");
      }
    }
  });

  currentSong?.addEventListener("click", async (event) => {
    const button = event.target.closest("#skip-vote-button");
    if (!button) return;
    button.disabled = true;
    try {
      const response = await apiFetch("/api/songs/current/skip-vote", {
        method: "POST",
        body: JSON.stringify({ deviceId: getDeviceId(), guestName: nameInput?.value || "" }),
      });
      if (response.triggered) {
        toast("Song wurde demokratisch uebersprungen.", "success");
      } else {
        toast("Skip-Vote registriert.", "success");
      }
    } catch (error) {
      button.disabled = false;
      if (error.status === 429) {
        toast(`${error.message}${retryHint(error)}`, "error");
      } else {
        toast(error.message, "error");
      }
    }
  });

  historyList?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action='readd-history']");
    if (!button) return;
    const card = button.closest("[data-song-id]");
    if (!card) return;
    button.disabled = true;
    try {
      const response = await apiFetch(`/api/history/${Number(card.dataset.songId)}/readd`, {
        method: "POST",
        body: JSON.stringify({ deviceId: getDeviceId(), guestName: nameInput?.value || "" }),
      });
      toast(`Wieder in der Queue: ${response.song?.title || "Song"}`, "success");
    } catch (error) {
      button.disabled = false;
      if (error.status === 409 && error.payload?.duplicate) {
        toast(`Song ist bereits in der Warteschlange: ${error.payload.duplicate.title || ""}`, "error");
      } else if (error.status === 429) {
        toast(`${error.message}${retryHint(error)}`, "error");
      } else {
        toast(error.message, "error");
      }
    }
  });

  messageForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!stateStore.runtime.chatEnabled) {
      toast("Der Chat ist fuer diese Party aktuell deaktiviert.", "error");
      return;
    }
    const submit = document.getElementById("submit-message");
    submit.disabled = true;
    submit.textContent = "Wird gesendet...";
    try {
      await apiFetch("/api/messages", {
        method: "POST",
        body: JSON.stringify({
          guestName: nameInput?.value || "",
          message: messageInput.value,
          deviceId: getDeviceId(),
        }),
      });
      messageInput.value = "";
      toast("Nachricht live gesendet.", "success");
    } catch (error) {
      if (error.status === 429) {
        toast(`${error.message}${retryHint(error)}`, "error");
      } else {
        toast(error.message, "error");
      }
    } finally {
      submit.disabled = false;
      submit.textContent = "Nachricht senden";
    }
  });

  document.getElementById("copy-join-link")?.addEventListener("click", () => {
    copyText(appConfig.joinUrl, "Party-Link kopiert.");
  });

  connectLive(renderState);
  apiFetch(`/api/state?deviceId=${encodeURIComponent(getDeviceId())}&role=guest`)
    .then(renderState)
    .catch((error) => toast(error.message, "error"));
})();
