(() => {
  "use strict";
  let installPrompt;
  const button = document.getElementById("pwa-install");
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (standalone && button) button.hidden = true;

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
    if (button) button.hidden = false;
  });

  button?.addEventListener("click", async () => {
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      return;
    }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    alert(ios ? "iPhone／iPad：點 Safari 的分享按鈕，再選「加入主畫面」。" : "手機：開啟瀏覽器選單，選「安裝應用程式」或「加到主畫面」。電腦：可用網址列右側的安裝圖示。");
  });

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
