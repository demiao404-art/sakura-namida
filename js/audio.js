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

  // ---------- 環境音（例如雨聲）：用 Web Audio 無縫循環 ----------
  let actx = null;
  const ambient = { name: null, gain: 0, node: null, src: null, buffers: {} };
  let ambientWant = { name: null, gain: 0 };

  function ctx() {
    if (!actx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      actx = new C();
    }
    if (actx.state === "suspended") actx.resume().catch(() => {});
    return actx;
  }

  async function loadBuffer(name) {
    if (ambient.buffers[name]) return ambient.buffers[name];
    const src = (cfg.音效 || {})[name];
    if (!src) return null;
    const res = await fetch(src);
    const buf = await ctx().decodeAudioData(await res.arrayBuffer());
    ambient.buffers[name] = buf;
    return buf;
  }

  // name：音效名稱（null 代表停止）；gain：0～1，會再乘上音效音量
  async function setAmbient(name, gain) {
    ambientWant = { name: name || null, gain: name ? gain : 0 };
    if (!unlocked) return;
    const c = ctx(); if (!c) return;
    const target = ambientWant.gain * vol("se");
    if (ambient.name === ambientWant.name && ambient.node) {
      ambient.node.gain.setTargetAtTime(target, c.currentTime, 0.4);
      return;
    }
    if (ambient.node) {
      const old = ambient;
      old.node.gain.setTargetAtTime(0, c.currentTime, 0.5);
      const s = old.src; setTimeout(() => { try { s.stop(); } catch (e) {} }, 2500);
      ambient.node = null; ambient.src = null; ambient.name = null;
    }
    if (!ambientWant.name) return;
    try {
      const want = ambientWant.name;
      const buf = await loadBuffer(want);
      if (!buf || ambientWant.name !== want || ambient.node) return;
      const g = c.createGain(); g.gain.value = 0; g.connect(c.destination);
      const s = c.createBufferSource(); s.buffer = buf; s.loop = true;
      // 去掉 mp3 頭尾的空白，循環的時候才不會有停頓
      s.loopStart = Math.min(0.06, buf.duration / 4); s.loopEnd = Math.max(s.loopStart + 0.1, buf.duration - 0.06);
      s.connect(g); s.start(0, s.loopStart);
      g.gain.setTargetAtTime(ambientWant.gain * vol("se"), c.currentTime, 0.6);
      Object.assign(ambient, { name: want, node: g, src: s });
    } catch (e) { /* 沒有檔案或不支援時安靜地略過 */ }
  }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    if (pendingName) bgm(pendingName);
    if (ambientWant.name) setAmbient(ambientWant.name, ambientWant.gain);
  }

  function applyVolume() {
    if (current) current.el.volume = vol("bgm");
    if (ambient.node && actx) ambient.node.gain.setTargetAtTime(ambientWant.gain * vol("se"), actx.currentTime, 0.2);
  }

  window.AudioMgr = { bgm, se, unlock, applyVolume, setAmbient };
})();
