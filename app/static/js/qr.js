(function () {
  const { appConfig, copyText, acceptStateRevision, connectLive, apiFetch, toast } = window.PartyTube;

  function renderState(payload) {
    if (!acceptStateRevision(payload)) return;
    window.PartyTube.ambientAudio.sync(payload.current);
  }

  document.getElementById("copy-link-qr-page")?.addEventListener("click", () => {
    copyText(appConfig.joinUrl, "Party-Link kopiert.");
  });

  document.getElementById("print-poster")?.addEventListener("click", () => {
    window.print();
  });

  window.addEventListener("load", () => {
    toast("QR-Seite ist druckbereit.", "success");
  });

  connectLive(renderState);
  apiFetch("/api/state").then(renderState).catch(() => null);
})();
