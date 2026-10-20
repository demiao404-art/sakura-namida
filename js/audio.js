/* =========================================================
   音樂與音效
   沒有檔案時會安靜地略過，不會出錯
   ========================================================= */
(function () {
  "use strict";

  const cfg = window.GAME_CONFIG || {};
  let current = null;      // { name, el }
  let unlocked = false;
  let pendingName = null;

  function vol(kind) {
    const s = (window.Store && Store.meta && Store.meta.settings) || {};
    return Math.max(0, Math.min(1, (kind === "bgm" ? s.bgmVolume ?? 70 : s.seVolume ?? 80) / 100));
  }

  function fade(el, to, ms, done) {
    const from = el.volume;
    const t0 = performance.now();
    function step(t) {
      const k = Math.min(1, (t - t0) / ms);
      el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k < 1) requestAnimationFrame(step); else if (done) done();
    }
    requestAnimationFrame(step);
  }

  function bgm(name) {
    pendingName = name;
    if (!unlocked) return;
    if (current && current.name === name) return;
    if (current) {
      const old = current.el;
      fade(old, 0, 900, () => { old.pause(); old.src = ""; });
      current = null;
    }
    const src = name && (cfg.音樂 || {})[name];
    if (!src) return;
    const el = new Audio(src);
    el.loop = true;
    el.volume = 0;
    el.play().then(() => fade(el, vol("bgm"), 1200)).catch(() => {});
    current = { name, el };
  }

  function se(name) {
    if (!unlocked) return;
    const src = name && (cfg.音效 || {})[name];
    if (!src) return;
    const el = new Audio(src);
    el.volume = vol("se");
    el.play().catch(() => {});
  }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    if (pendingName) bgm(pendingName);
  }

  function applyVolume() {
    if (current) current.el.volume = vol("bgm");
  }

  window.AudioMgr = { bgm, se, unlock, applyVolume };
})();
