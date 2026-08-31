(function () {
  const { toast } = window.PartyTube;
  const installButton = document.getElementById("install-app");
  const dialog = document.getElementById("install-dialog");
  const dialogTitle = document.getElementById("install-dialog-title");
  const dialogCopy = document.getElementById("install-dialog-copy");
  const dialogAction = document.getElementById("install-dialog-action");

  if (!installButton || !dialog) return;

  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone = () =>
    window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  let installPrompt = null;

  function setInstalledState() {
    const installed = isStandalone();
    installButton.classList.toggle("hidden", installed);
    installButton.disabled = installed;
    if (installed) installButton.textContent = "App installiert";
  }

  function showInstructions() {
    dialogTitle.textContent = isIos ? "Auf iPhone installieren" : "PartyTube installieren";
    if (!window.isSecureContext) {
      dialogCopy.textContent = "Installation braucht HTTPS. Öffne die sichere Party-Adresse.";
      dialogAction.classList.add("hidden");
    } else if (isIos) {
      dialogCopy.textContent = "In Safari: Teilen öffnen und „Zum Home-Bildschirm“ wählen.";
      dialogAction.classList.add("hidden");
    } else {
      dialogCopy.textContent = "Im Browser-Menü „App installieren“ oder „Zum Startbildschirm“ wählen.";
      dialogAction.classList.toggle("hidden", !installPrompt);
    }
    dialog.showModal();
  }

  async function requestInstall() {
    if (!installPrompt) {
      showInstructions();
      return;
    }
    const prompt = installPrompt;
    installPrompt = null;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "accepted") {
      toast("PartyTube wird installiert.", "success");
    }
    setInstalledState();
    dialog.close();
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    installButton.classList.remove("hidden");
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    setInstalledState();
    toast("PartyTube ist installiert.", "success");
  });

  installButton.addEventListener("click", () => {
    if (installPrompt) {
      requestInstall().catch(() => showInstructions());
      return;
    }
    showInstructions();
  });
  dialogAction?.addEventListener("click", () => requestInstall().catch(() => showInstructions()));

  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => {
        // Installation remains optional; the guest flow must stay usable without a worker.
      });
  }

  setInstalledState();
})();
