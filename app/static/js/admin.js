(function () {
  const {
    appConfig,
    stateStore,
    songCard,
    emptyState,
    connectLive,
    apiFetch,
    toast,
    clearRememberedVotes,
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

  function setAuthState(authenticated) {
    loginPanel.classList.toggle("hidden", authenticated);
    consolePanel.classList.toggle("hidden", !authenticated);
    settingsPanel?.classList.toggle("hidden", !authenticated);
    authPill.textContent = authenticated ? "Eingeloggt" : "Nicht eingeloggt";
    authPill.classList.toggle("live-ok", authenticated);
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
    joinPreview.textContent = payload.resolvedJoinUrl || "-";
  }

  function renderState(payload) {
    stateStore.current = payload.current;
    stateStore.queue = payload.queue;
    stateStore.history = payload.history;
    window.PartyTube.ambientAudio.sync(payload.current);

    currentCard.innerHTML = payload.current
      ? songCard(payload.current, { adminMode: true, highlight: true })
      : emptyState("Kein aktueller Song.");
    queueList.innerHTML = payload.queue.length
      ? payload.queue.map((song) => songCard(song, { adminMode: true })).join("")
      : emptyState("Die Warteschlange ist leer.");
    historyList.innerHTML = payload.history.length
      ? payload.history.map((song) => songCard(song, { playerMode: true })).join("")
      : emptyState("Noch kein Verlauf.");
  }

  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const pin = document.getElementById("admin-pin");
    try {
      await apiFetch("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ pin: pin.value }),
      });
      pin.value = "";
      setAuthState(true);
      toast("Host-Login aktiv.", "success");
      renderSettings(await apiFetch("/api/admin/settings"));
      renderState(await apiFetch("/api/state"));
    } catch (error) {
      toast(error.message, "error");
    }
  });

  document.getElementById("logout-button")?.addEventListener("click", async () => {
    await apiFetch("/api/admin/logout", { method: "POST", body: JSON.stringify({}) });
    setAuthState(false);
  });

  queueList?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action='remove']");
    if (!button) return;
    const card = button.closest("[data-song-id]");
    if (!card) return;
    const songId = Number(card.dataset.songId);
    try {
      await apiFetch(`/api/admin/songs/${songId}`, { method: "DELETE" });
      toast("Song entfernt.", "success");
    } catch (error) {
      toast(error.message, "error");
    }
  });

  currentCard?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action='remove']");
    if (!button) return;
    const card = button.closest("[data-song-id]");
    if (!card) return;
    try {
      await apiFetch(`/api/admin/songs/${Number(card.dataset.songId)}`, { method: "DELETE" });
      toast("Aktueller Song entfernt.", "success");
    } catch (error) {
      toast(error.message, "error");
    }
  });

  document.getElementById("skip-current")?.addEventListener("click", async () => {
    try {
      await apiFetch("/api/admin/skip", { method: "POST", body: JSON.stringify({}) });
      toast("Song uebersprungen.", "success");
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

  document.getElementById("reset-party")?.addEventListener("click", async () => {
    const confirmed = window.confirm("Wirklich alles fuer einen neuen Abend zuruecksetzen?");
    if (!confirmed) return;
    try {
      await apiFetch("/api/admin/reset", { method: "POST", body: JSON.stringify({}) });
      clearRememberedVotes();
      toast("Party wurde komplett zurueckgesetzt.", "success");
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
        }),
      });
      renderSettings(payload);
      toast("Party- und Netzwerkdaten gespeichert.", "success");
    } catch (error) {
      toast(error.message, "error");
    }
  });

  connectLive(renderState);
  apiFetch("/api/admin/status")
    .then((payload) => {
      setAuthState(payload.authenticated || appConfig.adminAuthenticated);
      return Promise.all([
        apiFetch("/api/state"),
        payload.authenticated || appConfig.adminAuthenticated ? apiFetch("/api/admin/settings") : Promise.resolve(null),
      ]);
    })
    .then(([statePayload, settingsPayload]) => {
      if (settingsPayload) {
        renderSettings(settingsPayload);
      }
      renderState(statePayload);
    })
    .catch((error) => toast(error.message, "error"));
})();
