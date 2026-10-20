/* =========================================================
   啟動
   ========================================================= */
(function () {
  "use strict";

  const config = window.GAME_CONFIG || {};

  function loadScript(src) {
    return new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = encodeURI(src);
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.body.append(s);
    });
  }

  async function boot() {
    Store.load();
    UI.init(config);

    const missing = [];
    for (const f of config.劇本檔案 || []) {
      const ok = await loadScript(f);
      if (!ok) missing.push(f);
    }

    const script = ScriptParser.parseAll(config);
    missing.forEach((f) => script.errors.unshift({ file: f, line: 0, msg: "找不到這個劇本檔案" }));

    const engine = new Engine(script, config, UI, AudioMgr);
    engine.onExit = (opts) => Screens.goTitle(opts);
    window.__engine = engine;

    Title.init();
    Screens.init(engine, config, script);
    Cloud.init();

    if (!Store.ok) UI.toast("這個瀏覽器無法保存進度（可能是無痕模式）", 5000);

    if (Store.meta.warningAccepted) Screens.goTitle();
    else Screens.showWarning();

    if (script.errors.length && config.開發模式) {
      UI.showError(`劇本有 ${script.errors.length} 個問題（這個提示只會在開發模式出現）`, script.errors);
    }

    const loading = document.getElementById("loading");
    if (document.fonts && document.fonts.ready) {
      await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]);
    }
    loading.classList.add("done");
    setTimeout(() => loading.remove(), 700);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
