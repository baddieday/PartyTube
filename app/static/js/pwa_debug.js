(function () {
  const manifestUrlEl = document.getElementById("pwa-debug-manifest-url");
  const manifestTypeEl = document.getElementById("pwa-debug-manifest-type");
  const manifestDisplayEl = document.getElementById("pwa-debug-manifest-display");
  const manifestShareEl = document.getElementById("pwa-debug-manifest-share");
  const manifestIconsEl = document.getElementById("pwa-debug-manifest-icons");
  const secureEl = document.getElementById("pwa-debug-secure");
  const originEl = document.getElementById("pwa-debug-origin");
  const installEl = document.getElementById("pwa-debug-install");
  const installNoteEl = document.getElementById("pwa-debug-install-note");
  const swEl = document.getElementById("pwa-debug-sw");
  const swNoteEl = document.getElementById("pwa-debug-sw-note");
  const displayEl = document.getElementById("pwa-debug-display");
  const displayNoteEl = document.getElementById("pwa-debug-display-note");
  const uaEl = document.getElementById("pwa-debug-ua");
  const standaloneEl = document.getElementById("pwa-debug-standalone");
  const referrerEl = document.getElementById("pwa-debug-referrer");
  const canShareEl = document.getElementById("pwa-debug-canshare");
  const refreshButton = document.getElementById("pwa-debug-refresh");

  let installPromptCaptured = false;

  function setText(element, value) {
    if (element) {
      element.textContent = value;
    }
  }

  function activeDisplayMode() {
    if (window.matchMedia("(display-mode: standalone)").matches) {
      return "standalone";
    }
    if (window.matchMedia("(display-mode: fullscreen)").matches) {
      return "fullscreen";
    }
    if (window.matchMedia("(display-mode: minimal-ui)").matches) {
      return "minimal-ui";
    }
    return "browser";
  }

  async function loadManifest() {
    const manifestLink = document.querySelector("link[rel='manifest']");
    if (!manifestLink) {
      setText(manifestUrlEl, "Kein Link-Tag gefunden");
      return;
    }
    const manifestUrl = new URL(manifestLink.getAttribute("href"), window.location.href).toString();
    setText(manifestUrlEl, manifestUrl);

    try {
      const response = await fetch(manifestUrl, { cache: "no-store" });
      setText(manifestTypeEl, response.headers.get("content-type") || "Unbekannt");
      const manifest = await response.json();
      setText(manifestDisplayEl, manifest.display || "Fehlt");
      setText(
        manifestShareEl,
        manifest.share_target?.action
          ? `${manifest.share_target.method || "GET"} ${manifest.share_target.action}`
          : "Fehlt",
      );
      setText(
        manifestIconsEl,
        Array.isArray(manifest.icons) && manifest.icons.length
          ? manifest.icons.map((icon) => icon.sizes || icon.src).join(", ")
          : "Keine Icons",
      );
    } catch (error) {
      setText(manifestTypeEl, `Fehler: ${error.message}`);
    }
  }

  async function loadServiceWorkerState() {
    if (!("serviceWorker" in navigator)) {
      setText(swEl, "Nicht unterstuetzt");
      setText(swNoteEl, "Dieser Browser bietet keine Service Worker.");
      return;
    }

    try {
      let registration = await navigator.serviceWorker.getRegistration("/");
      if (!registration) {
        try {
          registration = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
        } catch (error) {
          setText(swEl, "Registrierung fehlgeschlagen");
          setText(swNoteEl, error.message || String(error));
          return;
        }
      }

      try {
        await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((resolve) => window.setTimeout(resolve, 1500)),
        ]);
      } catch (_error) {
        // ignore and continue with the latest visible state
      }

      if (!registration) {
        setText(swEl, "Nicht registriert");
        setText(swNoteEl, "Die App wurde noch nicht als PWA gebunden.");
        return;
      }

      const active = registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL;
      setText(swEl, "Registriert");
      setText(swNoteEl, `${registration.scope} · ${active || "ohne aktiven Worker"}`);
    } catch (error) {
      setText(swEl, "Fehler");
      setText(swNoteEl, error.message);
    }
  }

  function loadStaticSignals() {
    setText(secureEl, window.isSecureContext ? "Ja" : "Nein");
    setText(originEl, `${window.location.origin} · ${window.location.protocol}`);
    setText(displayEl, activeDisplayMode());
    setText(displayNoteEl, window.document.visibilityState);
    setText(uaEl, navigator.userAgent);
    setText(
      standaloneEl,
      window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone
        ? "Ja"
        : "Nein",
    );
    setText(referrerEl, document.referrer || "Leer");
    setText(canShareEl, typeof navigator.canShare === "function" ? "Vorhanden" : "Nicht vorhanden");

    if (!installPromptCaptured) {
      setText(installEl, "Noch nicht ausgeloest");
      setText(installNoteEl, "Chrome feuert dieses Signal nur, wenn die App wirklich installierbar ist.");
    }
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPromptCaptured = true;
    setText(installEl, "beforeinstallprompt erkannt");
    setText(installNoteEl, "Dieses Geraet sieht PartyTube als installierbar.");
  });

  window.addEventListener("appinstalled", () => {
    setText(installEl, "Installiert");
    setText(installNoteEl, "PartyTube wurde auf diesem Geraet als App installiert.");
  });

  async function refreshDebug() {
    loadStaticSignals();
    await Promise.all([loadManifest(), loadServiceWorkerState()]);
  }

  refreshButton?.addEventListener("click", () => {
    refreshDebug().catch((error) => {
      setText(installEl, `Fehler: ${error.message}`);
    });
  });

  refreshDebug().catch((error) => {
    setText(installEl, `Fehler: ${error.message}`);
  });
})();
