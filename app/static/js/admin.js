(function () {
  const {
    appConfig,
    stateStore,
    updateAppConfig,
    getDeviceId,
    songCard,
    messageCard,
    emptyState,
    connectLive,
    apiFetch,
    toast,
    clearRememberedVotes,
    formatDuration,
    escapeHtml,
  } = window.PartyTube;

  const loginPanel = document.getElementById("admin-login-panel");
  const consolePanel = document.getElementById("admin-console-panel");
  const authPill = document.getElementById("admin-auth-pill");
  const loginForm = document.getElementById("admin-login-form");
  const queueList = document.getElementById("admin-queue-list");
  const historyList = document.getElementById("admin-history-list");
  const currentCard = document.getElementById("admin-current-song");
  const settingsPanel = document.getElementById("admin-settings-panel");
  const settingsForm = document.getElementById("admin-settings-form");
  const joinPreview = document.getElementById("settings-join-preview");
  const warningList = document.getElementById("admin-warning-list");
  const mutedDevices = document.getElementById("admin-muted-devices");
  const messageList = document.getElementById("admin-message-list");
  const chatCount = document.getElementById("admin-chat-count");
  const nextSongHint = document.getElementById("admin-next-song");
  const queueDuration = document.getElementById("admin-queue-duration");
  const displayAddress = document.getElementById("admin-display-address");
  const joinUrlLink = document.getElementById("admin-join-url");
  const playerUrlLink = document.getElementById("admin-player-url");
  const audioUrlLink = document.getElementById("admin-audio-url");
  const openPlayerLink = document.getElementById("admin-open-player");
  const openAudioLink = document.getElementById("admin-open-audio");
  const openPartyScreenLink = document.getElementById("admin-open-party-screen");
  const skipStatus = document.getElementById("admin-skip-status");
  const bestOfList = document.getElementById("admin-best-of-list");
  const statGuests = document.getElementById("admin-stat-guests");
  const statQueue = document.getElementById("admin-stat-queue");
  const statVotes = document.getElementById("admin-stat-votes");
  const statSkip = document.getElementById("admin-stat-skip");

  let adminAuthenticated = Boolean(appConfig.adminAuthenticated);

  function retryHint(error) {
    return error?.retryAfterSeconds ? ` Bitte in ca. ${error.retryAfterSeconds}s erneut versuchen.` : "";
  }

  function selectedSong(songId) {
    if (stateStore.current?.id === songId) {
      return stateStore.current;
    }
    return stateStore.queue.find((song) => song.id === songId) || null;
  }

  function setAuthState(authenticated) {
    adminAuthenticated = authenticated;
    loginPanel.classList.toggle("hidden", authenticated);
    consolePanel.classList.toggle("hidden", !authenticated);
    settingsPanel?.classList.toggle("hidden", !authenticated);
    authPill.textContent = authenticated ? "Eingeloggt" : "Nicht eingeloggt";
    authPill.classList.toggle("live-ok", authenticated);
  }

  function applyAdminStatus(payload) {
    updateAppConfig({
      adminAuthenticated: Boolean(payload.authenticated),
      csrfToken: payload.csrfToken || "",
      playerUrl: payload.playerUrl || "/player",
      audioUrl: payload.audioUrl || "/audio",
      securePlayerUrl: payload.playerUrl || "/player",
      secureAudioUrl: payload.audioUrl || "/audio",
      warnings: payload.warnings || [],
    });

    const playerText = payload.authenticated ? payload.playerUrl : "Wird nach Login abgesichert";
    const audioText = payload.authenticated ? payload.audioUrl : "Wird nach Login abgesichert";
    playerUrlLink.textContent = playerText;
    audioUrlLink.textContent = audioText;
    playerUrlLink.href = payload.playerUrl || "/player";
    audioUrlLink.href = payload.audioUrl || "/audio";
    openPlayerLink.href = payload.playerUrl || "/player";
    openAudioLink.href = payload.audioUrl || "/audio";
    if (openPartyScreenLink) {
      openPartyScreenLink.href = "/party-screen";
    }
    renderWarnings(payload.warnings || []);
    setAuthState(Boolean(payload.authenticated));
  }

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

  function renderQueueMeta(queueMeta) {
    nextSongHint.textContent = queueMeta?.nextSong?.title || "Kein Song";
    queueDuration.textContent = Number.isFinite(queueMeta?.totalDurationSeconds)
      ? formatDuration(queueMeta.totalDurationSeconds)
      : "Teilweise unbekannt";
  }

  function renderMutedDevices(devices) {
    mutedDevices.innerHTML = devices.length
      ? devices
          .map(
            (device) => `
              <article class="muted-card" data-device-id="${device.deviceId}">
                <div class="chat-line">
                  <strong>${device.guestName || "Unbekanntes Gerät"}</strong>
                  <span>Gerät ${device.deviceLabel}</span>
                </div>
                <p>${device.reason || "Temporär gesperrt"}</p>
                <p class="song-subline">${device.expiresAt ? `bis ${new Date(device.expiresAt).toLocaleString("de-DE")}` : "ohne Ablauf"}</p>
                <div class="chat-actions">
                  <button class="chip-button" data-action="unmute-device">Freigeben</button>
                </div>
              </article>
            `,
          )
          .join("")
      : emptyState("Aktuell keine Geräte gesperrt.");
  }

  function renderSettings(payload) {
    if (!settingsForm || !payload) return;
    document.getElementById("settings-party-name").value = payload.partyName || "";
    document.getElementById("settings-party-code").value = payload.partyCode || "";
    document.getElementById("settings-base-url").value = payload.baseUrl || "";
    document.getElementById("settings-wifi-ssid").value = payload.wifiSsid || "";
    document.getElementById("settings-wifi-password").value = payload.wifiPassword || "";
    document.getElementById("settings-wifi-security").value = payload.wifiSecurity || "WPA";
    document.getElementById("settings-wifi-hidden").checked = Boolean(payload.wifiHidden);
    document.getElementById("settings-autoplay-enabled").checked = Boolean(payload.autoplayEnabled);
    document.getElementById("settings-crossfade-seconds").value = String(payload.crossfadeSeconds || 0);
    document.getElementById("settings-chat-enabled").checked = Boolean(payload.chatEnabled);
    document.getElementById("settings-voting-enabled").checked = Boolean(payload.votingEnabled);
    document.getElementById("settings-invite-only").checked = Boolean(payload.inviteOnlyMode);
    document.getElementById("settings-skip-voting-enabled").checked = Boolean(payload.skipVotingEnabled);
    document.getElementById("settings-skip-threshold").value = payload.skipVoteThresholdPercent || 40;
    document.getElementById("settings-history-public").checked = Boolean(payload.historyPublic);
    document.getElementById("settings-readd-enabled").checked = Boolean(payload.readdEnabled);
    document.getElementById("settings-party-screen-enabled").checked = Boolean(payload.partyScreenEnabled);
    document.getElementById("settings-wifi-qr-enabled").checked = Boolean(payload.wifiQrEnabled);
    document.getElementById("settings-show-wifi-password").checked = Boolean(payload.showWifiPasswordOnScreen);
    document.getElementById("settings-screen-active-guests").checked = Boolean(payload.partyScreenShowActiveGuests);
    document.getElementById("settings-screen-skip-status").checked = Boolean(payload.partyScreenShowSkipStatus);
    document.getElementById("settings-max-songs-per-device").value = payload.maxSongsPerDevice || 1;
    document.getElementById("settings-max-queue-items").value = payload.maxQueueItems || 1;
    joinPreview.textContent = payload.resolvedJoinUrl || "-";
    displayAddress.textContent = payload.resolvedBaseUrl || payload.displayAddress || appConfig.baseUrl;
    joinUrlLink.href = payload.resolvedJoinUrl || appConfig.joinUrl;
    joinUrlLink.textContent = payload.resolvedJoinUrl || appConfig.joinUrl;
    renderMutedDevices(payload.mutedDevices || []);
    renderWarnings(payload.warnings || []);
  }

  function renderMessages(messages) {
    chatCount.textContent = `${messages.length} live`;
    messageList.innerHTML = messages.length
      ? messages.map((message) => messageCard(message, { adminMode: true })).join("")
      : emptyState("Noch keine Chat-Nachrichten.");
  }

  function renderSkipStatus(skip) {
    if (!skipStatus) return;
    if (!skip?.currentSongId) {
      skipStatus.innerHTML = emptyState("Kein aktueller Song für Skip-Voting.");
      return;
    }
    skipStatus.innerHTML = `
      <div class="skip-admin-grid">
        <div class="meta-card">
          <span class="eyebrow">Skip-Votes</span>
          <strong>${skip.currentSkipVoteCount || 0}/${skip.skipVotesNeeded || "-"}</strong>
        </div>
        <div class="meta-card">
          <span class="eyebrow">Aktive Gäste</span>
          <strong>${skip.activeGuestCount || 0}</strong>
        </div>
        <div class="meta-card">
          <span class="eyebrow">Aktuell</span>
          <strong>${skip.currentSkipVotePercent || 0}% / ${skip.skipThresholdPercent || 40}%</strong>
        </div>
      </div>
    `;
  }

  function renderDashboardStats(payload) {
    const skip = payload.skipVoting || stateStore.skipVoting || {};
    if (statGuests) statGuests.textContent = String(skip.activeGuestCount || stateStore.stats?.activeCount || 0);
    if (statQueue) statQueue.textContent = String(payload.queue?.length || 0);
    if (statVotes) statVotes.textContent = String(payload.current?.votes || 0);
    if (statSkip) statSkip.textContent = `${skip.currentSkipVotePercent || 0}%`;
  }

  function renderBestOfPreview(history) {
    if (!bestOfList) return;
    const ranked = [...history]
      .map((song) => ({
        ...song,
        bestScore:
          (song.votes || 0) +
          (song.status === "played" ? 2 : 0) +
          (song.readdCount || 0) -
          (["skipped", "skipped_by_vote"].includes(song.status) ? 2 : 0) -
          (song.status === "removed" ? 5 : 0),
      }))
      .sort((left, right) => (right.bestScore || 0) - (left.bestScore || 0))
      .slice(0, 5);
    bestOfList.innerHTML = ranked.length
      ? ranked
          .map(
            (song, index) => `
              <article class="best-mini-card">
                <span class="rank-pill">#${index + 1}</span>
                <strong>${escapeHtml(song.title)}</strong>
                <span>${song.bestScore} Punkte · ${song.votes || 0} Votes</span>
              </article>
            `,
          )
          .join("")
      : emptyState("Noch keine abgeschlossenen Songs für Best-of.");
  }

  function renderState(payload) {
    stateStore.current = payload.current;
    stateStore.queue = payload.queue;
    stateStore.history = payload.history;
    stateStore.messages = payload.messages || [];
    stateStore.queueMeta = payload.queueMeta || {};
    stateStore.stats = payload.stats || stateStore.stats;
    if (payload.skipVoting) {
      Object.assign(stateStore.skipVoting, payload.skipVoting);
    }
    if (payload.runtime) {
      updateAppConfig({ runtime: payload.runtime });
    }

    window.PartyTube.ambientAudio.sync(payload.current);

    currentCard.innerHTML = payload.current
      ? songCard(payload.current, { adminMode: true, highlight: true })
      : emptyState("Kein aktueller Song.");
    queueList.innerHTML = payload.queue.length
      ? payload.queue.map((song) => songCard(song, { adminMode: true })).join("")
      : emptyState("Die Warteschlange ist leer.");
    historyList.innerHTML = payload.history.length
      ? payload.history.map((song) => songCard(song, { historyMode: true })).join("")
      : emptyState("Noch kein Verlauf.");
    renderDashboardStats(payload);
    renderQueueMeta(payload.queueMeta || {});
    renderMessages(payload.messages || []);
    renderSkipStatus(payload.skipVoting || stateStore.skipVoting);
    renderBestOfPreview(payload.history || []);
  }

  async function loadAdminSettings() {
    if (!adminAuthenticated) {
      renderMutedDevices([]);
      return null;
    }
    const payload = await apiFetch("/api/admin/settings");
    renderSettings(payload);
    return payload;
  }

  async function loadAdminStatus() {
    const payload = await apiFetch("/api/admin/status");
    applyAdminStatus(payload);
    return payload;
  }

  async function refreshAdminContext() {
    const status = await loadAdminStatus();
    const statePromise = apiFetch("/api/state").then(renderState);
    const settingsPromise = status.authenticated ? loadAdminSettings() : Promise.resolve(null);
    await Promise.all([statePromise, settingsPromise]);
  }

  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const pin = document.getElementById("admin-pin");
    try {
      const payload = await apiFetch("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ pin: pin.value }),
      });
      pin.value = "";
      applyAdminStatus({
        authenticated: true,
        csrfToken: payload.csrfToken || "",
        warnings: payload.warnings || [],
        playerUrl: appConfig.playerUrl,
        audioUrl: appConfig.audioUrl,
      });
      await refreshAdminContext();
      toast("Host-Login aktiv.", "success");
    } catch (error) {
      toast(error.message, "error");
    }
  });

  document.getElementById("logout-button")?.addEventListener("click", async () => {
    try {
      await apiFetch("/api/admin/logout", { method: "POST", body: JSON.stringify({}) });
      updateAppConfig({
        csrfToken: "",
        playerUrl: "/player",
        audioUrl: "/audio",
        securePlayerUrl: "/player",
        secureAudioUrl: "/audio",
      });
      setAuthState(false);
      playerUrlLink.textContent = "Wird nach Login abgesichert";
      audioUrlLink.textContent = "Wird nach Login abgesichert";
      playerUrlLink.href = "/player";
      audioUrlLink.href = "/audio";
      openPlayerLink.href = "/player";
      openAudioLink.href = "/audio";
      renderMutedDevices([]);
      toast("Host-Session beendet.", "success");
    } catch (error) {
      toast(error.message, "error");
    }
  });

  async function handleSongAction(action, songId) {
    const song = selectedSong(songId);
    if (!song && action !== "remove") {
      toast("Song wurde nicht gefunden.", "error");
      return;
    }

    if (action === "remove") {
      await apiFetch(`/api/admin/songs/${songId}`, { method: "DELETE" });
      toast("Song entfernt.", "success");
      return;
    }
    if (action === "pin") {
      await apiFetch(`/api/admin/songs/${songId}/pin`, {
        method: "POST",
        body: JSON.stringify({ pinned: !song.pinned }),
      });
      toast(song.pinned ? "Priorisierung entfernt." : "Song priorisiert.", "success");
      return;
    }
    if (action === "clear-device") {
      const payload = await apiFetch(`/api/admin/songs/${songId}/clear-device`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast(`${payload.removedSongs || 0} Song(s) des Geräts entfernt.`, "success");
      await loadAdminSettings();
      return;
    }
    if (action === "mute-device") {
      const payload = await apiFetch(`/api/admin/mute/song/${songId}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast(`Gerät gesperrt, ${payload.removedSongs || 0} Song(s) entfernt.`, "success");
      await loadAdminSettings();
    }
  }

  function bindSongActions(root) {
    root?.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      const action = button.dataset.action;
      if (!["remove", "pin", "clear-device", "mute-device"].includes(action)) return;
      const card = button.closest("[data-song-id]");
      if (!card) return;
      try {
        await handleSongAction(action, Number(card.dataset.songId));
      } catch (error) {
        if (error.status === 429) {
          toast(`${error.message}${retryHint(error)}`, "error");
        } else if (error.status === 401) {
          setAuthState(false);
          toast("Bitte erneut als Host einloggen.", "error");
        } else {
          toast(error.message, "error");
        }
      }
    });
  }

  bindSongActions(queueList);
  bindSongActions(currentCard);

  historyList?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action='readd-history']");
    if (!button) return;
    const card = button.closest("[data-song-id]");
    if (!card) return;
    button.disabled = true;
    try {
      const response = await apiFetch(`/api/history/${Number(card.dataset.songId)}/readd`, {
        method: "POST",
        body: JSON.stringify({ deviceId: getDeviceId(), guestName: "Host" }),
      });
      toast(`Wieder in der Queue: ${response.song?.title || "Song"}`, "success");
    } catch (error) {
      button.disabled = false;
      toast(error.message, "error");
    }
  });

  document.getElementById("skip-current")?.addEventListener("click", async () => {
    try {
      await apiFetch("/api/admin/skip", { method: "POST", body: JSON.stringify({}) });
      toast("Song übersprungen.", "success");
    } catch (error) {
      toast(error.message, "error");
    }
  });

  document.getElementById("mark-played")?.addEventListener("click", async () => {
    try {
      await apiFetch("/api/admin/mark-played", { method: "POST", body: JSON.stringify({}) });
      toast("Als gespielt markiert.", "success");
    } catch (error) {
      toast(error.message, "error");
    }
  });

  document.getElementById("clear-queue")?.addEventListener("click", async () => {
    try {
      await apiFetch("/api/admin/clear", { method: "POST", body: JSON.stringify({}) });
      clearRememberedVotes();
      toast("Aktive Queue geleert.", "success");
    } catch (error) {
      toast(error.message, "error");
    }
  });

  document.getElementById("reset-skip-votes")?.addEventListener("click", async () => {
    try {
      await apiFetch("/api/admin/current/reset-skip-votes", { method: "POST", body: JSON.stringify({}) });
      toast("Skip-Votes für den aktuellen Song zurückgesetzt.", "success");
    } catch (error) {
      toast(error.message, "error");
    }
  });

  document.getElementById("reset-party")?.addEventListener("click", async () => {
    const confirmed = window.confirm("Wirklich alles für einen neuen Abend zurücksetzen?");
    if (!confirmed) return;
    try {
      await apiFetch("/api/admin/reset", { method: "POST", body: JSON.stringify({}) });
      clearRememberedVotes();
      await loadAdminSettings();
      toast("Party wurde komplett zurückgesetzt.", "success");
    } catch (error) {
      toast(error.message, "error");
    }
  });

  settingsForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const payload = await apiFetch("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify({
          partyName: document.getElementById("settings-party-name").value,
          partyCode: document.getElementById("settings-party-code").value,
          baseUrl: document.getElementById("settings-base-url").value,
          wifiSsid: document.getElementById("settings-wifi-ssid").value,
          wifiPassword: document.getElementById("settings-wifi-password").value,
          wifiSecurity: document.getElementById("settings-wifi-security").value,
          wifiHidden: document.getElementById("settings-wifi-hidden").checked,
          autoplayEnabled: document.getElementById("settings-autoplay-enabled").checked,
          crossfadeSeconds: Number(document.getElementById("settings-crossfade-seconds").value || 0),
          chatEnabled: document.getElementById("settings-chat-enabled").checked,
          votingEnabled: document.getElementById("settings-voting-enabled").checked,
          inviteOnlyMode: document.getElementById("settings-invite-only").checked,
          skipVotingEnabled: document.getElementById("settings-skip-voting-enabled").checked,
          skipVoteThresholdPercent: Number(document.getElementById("settings-skip-threshold").value || 40),
          historyPublic: document.getElementById("settings-history-public").checked,
          readdEnabled: document.getElementById("settings-readd-enabled").checked,
          partyScreenEnabled: document.getElementById("settings-party-screen-enabled").checked,
          wifiQrEnabled: document.getElementById("settings-wifi-qr-enabled").checked,
          showWifiPasswordOnScreen: document.getElementById("settings-show-wifi-password").checked,
          partyScreenShowActiveGuests: document.getElementById("settings-screen-active-guests").checked,
          partyScreenShowSkipStatus: document.getElementById("settings-screen-skip-status").checked,
          maxSongsPerDevice: Number(document.getElementById("settings-max-songs-per-device").value || 1),
          maxQueueItems: Number(document.getElementById("settings-max-queue-items").value || 1),
        }),
      });
      renderSettings(payload);
      toast("Party- und Netzwerkdaten gespeichert.", "success");
    } catch (error) {
      toast(error.message, "error");
    }
  });

  messageList?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const card = button.closest("[data-message-id]");
    if (!card) return;
    const messageId = Number(card.dataset.messageId);
    try {
      if (button.dataset.action === "delete-message") {
        await apiFetch(`/api/admin/messages/${messageId}`, { method: "DELETE" });
        toast("Nachricht gelöscht.", "success");
        return;
      }
      if (button.dataset.action === "mute-message-device") {
        await apiFetch(`/api/admin/mute/message/${messageId}`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        await loadAdminSettings();
        toast("Gerät des Chat-Users gesperrt.", "success");
      }
    } catch (error) {
      toast(error.message, "error");
    }
  });

  mutedDevices?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action='unmute-device']");
    if (!button) return;
    const card = button.closest("[data-device-id]");
    if (!card) return;
    try {
      await apiFetch(`/api/admin/unmute/${encodeURIComponent(card.dataset.deviceId)}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await loadAdminSettings();
      toast("Gerät wieder freigegeben.", "success");
    } catch (error) {
      toast(error.message, "error");
    }
  });

  connectLive(renderState);
  refreshAdminContext().catch((error) => toast(error.message, "error"));
})();
