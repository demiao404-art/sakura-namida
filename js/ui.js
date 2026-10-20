/* =========================================================
   遊戲畫面：背景、立繪、對話框、選項、換日、效果、結局演出
   ========================================================= */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const CANCEL = { cancelled: true };

  const UI = {
    backlog: [],
    auto: false,
    skip: false,
    ctrlHeld: false,
    waiter: null,       // 目前等待玩家的東西
    line: null,         // 正在顯示的台詞
    playing: false,     // 是否在遊戲畫面
    screenStack: [],    // 開著的選單
    hiddenUI: false,

    init(config) {
      this.cfg = config;
      this.stage = $("stage");
      this.bgLayer = $("bg-layer");
      this.charLayer = $("char-layer");
      this.fxLayer = $("fx-layer");
      this.textbox = $("textbox");
      this.tbName = $("tb-name");
      this.tbText = $("tb-text");
      this.choiceLayer = $("choice-layer");
      this.dayEl = $("daycard");
      this.quick = $("quickmenu");
      this.badge = $("mode-badge");

      this.petals = new PetalField($("petal-canvas"), { perLevel: 18 });
      this.rain = new RainField($("rain-canvas"));
      this.endingPetals = new PetalField($("ending-canvas"), { perLevel: 20, size: [14, 30] });

      // 兩層背景輪流淡入淡出
      this.bgA = document.createElement("div"); this.bgA.className = "bg";
      this.bgB = document.createElement("div"); this.bgB.className = "bg";
      this.bgLayer.append(this.bgA, this.bgB);
      this.bgFront = this.bgA;
      this.currentBg = null;

      this.veil = document.createElement("div"); this.veil.className = "fx-veil"; this.veil.style.background = "#000";
      this.flash = document.createElement("div"); this.flash.className = "fx-veil"; this.flash.style.background = "#fff";
      this.fxLayer.append(this.veil, this.flash);

      this.preload();
      this.fit();
      window.addEventListener("resize", () => this.fit());
      window.addEventListener("orientationchange", () => setTimeout(() => this.fit(), 200));
      this.bindInput();
      this.applySettings();
    },

    preload() {
      const urls = [];
      for (const ch of Object.values(this.cfg.角色 || {})) for (const u of Object.values(ch.立繪 || {})) urls.push(u);
      for (const v of Object.values(this.cfg.背景 || {})) if (!String(v).startsWith("#")) urls.push(v);
      this._imgs = urls.map((u) => { const i = new Image(); i.decoding = "async"; i.src = u; return i; });
    },

    fit() {
      const w = window.innerWidth, h = window.innerHeight;
      const s = Math.min(w / 1600, h / 900);
      this.scale = s;
      this.stage.style.transformOrigin = "50% 50%";
      this.stage.style.transform = `translate(-50%, -50%) scale(${s})`;
    },

    applySettings() {
      const s = Store.meta.settings;
      this.stage.style.setProperty("--box-opacity", (s.boxOpacity / 100).toFixed(2));
      if (!s.ambientPetals && this.petals.level > 0) this.petals.setLevel(0);
      else if (s.ambientPetals && this._petalLevel) this.petals.setLevel(this._petalLevel);
      AudioMgr.applyVolume();
      this.renderStats();
    },

    // ---------- 右上角的「生存可能」 ----------
    // 一般輪：？？？？：0%　→ 集滿所有結局時，用雜訊特效變成「生存可能：0%」
    // 絕望輪、希望輪：生存可能：0%　→ 走到完美結局時，變成「生存可能：？%」
    survivalText(phase) {
      const m = Store.meta;
      if (m.perfect) return ["生存可能", "？"];
      if (phase === "絕望" || phase === "希望") return ["生存可能", "0"];
      const need = window.__engine ? window.__engine.endingsNeeded : 99;
      return (m.endings || []).length >= need ? ["生存可能", "0"] : ["？？？？", "0"];
    },
    setSurvival(label, val) {
      const box = $("survival"); if (!box) return;
      box.querySelector(".sv-label").textContent = label;
      box.querySelector(".sv-val").textContent = val;
    },
    updateSurvival(phase) {
      if (phase) this._svPhase = phase;
      const box = $("survival"); if (!box) return;
      if (!box.classList.contains("reveal")) {
        const [l, v] = this.survivalText(this._svPhase);
        this.setSurvival(l, v);
      }
      box.hidden = !(this.playing || box.classList.contains("reveal"));
    },
    // 雜訊特效：從 from 變成 to（例如 ["？？？？","0"] → ["生存可能","0"]）
    async survivalReveal(from, to) {
      const box = $("survival"); if (!box) return;
      const noise = "？＃％＊※▒░▓ΔΣ∅生存可能０１２３４５６７８９";
      const scramble = (n) => Array.from({ length: n }, () => noise[Math.floor(Math.random() * noise.length)]).join("");
      box.classList.add("reveal");
      box.hidden = false;
      this.setSurvival(from[0], from[1]);
      await sleep(1600);
      box.classList.add("glitching");
      const t0 = performance.now();
      while (performance.now() - t0 < 2600) {
        const k = (performance.now() - t0) / 2600;
        const lab = to[0].split("").map((c, i) => (Math.random() < k * 1.1 ? c : scramble(1))).join("");
        const val = Math.random() < k ? to[1] : scramble(1);
        this.setSurvival(Math.random() < 0.15 ? scramble(Math.max(from[0].length, to[0].length)) : lab, val);
        await sleep(70 + Math.random() * 60);
      }
      this.setSurvival(to[0], to[1]);
      box.classList.remove("glitching");
      await sleep(2200);
      box.classList.remove("reveal");
      box.hidden = !this.playing;
    },

    // ---------- 左上角的感情值 ----------
    updateStats(vars) { this._statVars = vars; this.renderStats(); },
    renderStats() {
      const hud = $("stats-hud");
      if (!hud) return;
      const E = Object.fromEntries(Object.entries((this.cfg.感情值 || {}).項目 || {}).filter(([, d]) => !d.不顯示));
      const show = !!(this.playing && this._statVars && Store.meta.settings.showStats !== false);
      hud.hidden = !show;
      if (!show) return;
      const min = (this.cfg.感情值 || {}).最小 ?? 0, max = (this.cfg.感情值 || {}).最大 ?? 100;
      if (hud.childElementCount !== Object.keys(E).length) {
        hud.textContent = "";
        for (const [name, def] of Object.entries(E)) {
          const row = document.createElement("div");
          row.className = "st-row";
          row.dataset.name = name;
          row.style.setProperty("--c", def.顏色 || "var(--sakura)");
          row.innerHTML = '<span class="st-name"></span><span class="st-bar"><i></i></span><span class="st-val"></span>';
          row.querySelector(".st-name").textContent = name;
          hud.append(row);
        }
      }
      for (const row of hud.children) {
        const v = Math.round(Number(this._statVars[row.dataset.name]) || 0);
        const valEl = row.querySelector(".st-val");
        if (valEl.textContent !== String(v)) {
          if (valEl.textContent !== "") { row.classList.remove("bump"); void row.offsetWidth; row.classList.add("bump"); }
          valEl.textContent = v;
        }
        row.querySelector(".st-bar i").style.width = Math.max(0, Math.min(100, (v - min) / (max - min) * 100)) + "%";
      }
    },

    // ---------- 速度 ----------
    cps() {
      const v = Store.meta.settings.textSpeed;
      return v >= 100 ? Infinity : 12 + v * 1.25;
    },
    autoWait(len) {
      const v = Store.meta.settings.autoDelay;
      const f = 2.1 - v / 60;
      return (900 + len * 70) * Math.max(0.35, f);
    },
    get skipping() { return this.skip || this.ctrlHeld; },

    // ---------- 輸入 ----------
    bindInput() {
      const stage = this.stage;
      stage.addEventListener("click", (e) => {
        AudioMgr.unlock();
        if (!this.playing || this.screenStack.length || this.modalOpen) return;
        if (e.target.closest("#quickmenu, #choice-layer .choice")) return;
        if (this.hiddenUI) { this.toggleHide(false); return; }
        this.advance();
      });
      stage.addEventListener("contextmenu", (e) => {
        if (!this.playing) return;
        e.preventDefault();
        if (this.screenStack.length) { Screens.closeTop(); return; }
        this.toggleHide();
      });
      stage.addEventListener("wheel", (e) => {
        if (!this.playing || this.screenStack.length || this.modalOpen) return;
        if (e.deltaY < -10 && this.backlog.length) Screens.open("log");
        else if (e.deltaY > 10 && this.waiter && this.waiter.kind === "say") this.advance();
      }, { passive: true });

      this.heart = $("tb-heart");
      this.heart.addEventListener("click", (e) => { e.stopPropagation(); this.openInner(); });

      this.quick.addEventListener("click", (e) => {
        const b = e.target.closest(".qm");
        if (!b) return;
        e.stopPropagation();
        AudioMgr.unlock();
        const act = b.dataset.act;
        if (act === "menu") Screens.open("menu");
        if (act === "auto") this.setAuto(!this.auto);
        if (act === "skip") this.setSkip(!this.skip);
        if (act === "log") Screens.open("log");
        if (act === "qsave") Screens.quickSave();
        if (act === "qload") Screens.quickLoad();
      });

      window.addEventListener("keydown", (e) => {
        AudioMgr.unlock();
        if (e.key === "Control") { if (this.playing && !this.screenStack.length) { this.ctrlHeld = true; this.updateBadge(); this.kick(); } return; }
        if (this.modalOpen) { if (e.key === "Escape") Screens.closeModal(); return; }
        if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
        if (e.key === "F2" && this.cfg.開發模式) { e.preventDefault(); Screens.open("dev"); return; }
        if (this.screenStack.length) { if (e.key === "Escape") Screens.closeTop(); return; }
        if (!this.playing) return;
        if (this.waiter && this.waiter.kind === "choice") {
          const n = parseInt(e.key, 10);
          if (n >= 1 && n <= 9) { const b = this.choiceLayer.querySelectorAll(".choice")[n - 1]; if (b && !b.disabled) b.click(); }
          return;
        }
        switch (e.key) {
          case "Enter": case " ": e.preventDefault(); if (this.hiddenUI) this.toggleHide(false); else this.advance(); break;
          case "Escape": Screens.open("menu"); break;
          case "a": case "A": this.setAuto(!this.auto); break;
          case "s": case "S": this.setSkip(!this.skip); break;
          case "l": case "L": Screens.open("log"); break;
          case "h": case "H": this.toggleHide(); break;
          case "ArrowUp": if (this.backlog.length) Screens.open("log"); break;
        }
      });
      window.addEventListener("keyup", (e) => { if (e.key === "Control") { this.ctrlHeld = false; this.updateBadge(); } });
      window.addEventListener("blur", () => { this.ctrlHeld = false; this.updateBadge(); });
    },

    toggleHide(force) {
      this.hiddenUI = force === undefined ? !this.hiddenUI : force;
      this.stage.classList.toggle("ui-hidden", this.hiddenUI);
    },

    setAuto(on) {
      this.auto = on;
      if (on) this.skip = false;
      this.updateBadge();
      this.kick();
    },
    setSkip(on) {
      this.skip = on;
      if (on) this.auto = false;
      this.updateBadge();
      this.kick();
    },
    stopModes() { this.auto = false; this.skip = false; this.updateBadge(); },
    updateBadge() {
      this.quick.querySelector('[data-act="auto"]').classList.toggle("active", this.auto);
      this.quick.querySelector('[data-act="skip"]').classList.toggle("active", this.skipping);
      const t = this.skipping ? "Skip" : this.auto ? "Auto" : "";
      this.badge.textContent = t;
      this.badge.classList.toggle("on", !!t);
    },

    // 模式改變時，讓正在等待的台詞重新判斷要不要自動前進
    kick() {
      const l = this.line;
      if (!l || !this.waiter || this.waiter.kind !== "say") return;
      if (this.screenStack.length || this.modalOpen) return;
      if (l.typing) { if (this.skipping && this.canSkip(l)) this.finishTyping(); return; }
      this.scheduleNext();
    },

    canSkip(l) { return Store.meta.settings.skipMode === "all" || l.read; },

    setPlaying(on) {
      this.playing = on;
      this.quick.hidden = !on;
      this.stage.classList.toggle("playing", on);
      if (!on) { this.stopModes(); this.ctrlHeld = false; this.toggleHide(false); }
      this.renderStats();
      this.updateSurvival();
    },

    // ---------- 背景 ----------
    bgValue(name) { return name ? (this.cfg.背景 || {})[name] : null; },
    paintBg(el, name) {
      const v = this.bgValue(name);
      if (!v) { el.style.backgroundImage = ""; el.style.backgroundColor = "#000"; return; }
      if (String(v).startsWith("#")) { el.style.backgroundImage = ""; el.style.backgroundColor = v; }
      else { el.style.backgroundColor = "#000"; el.style.backgroundImage = `url("${v}")`; }
    },
    // 下雨只顯示在室外的背景
    updateRainPlace(name) {
      const outdoor = this.cfg.室外背景;
      const indoor = Array.isArray(outdoor) && name && !outdoor.includes(name);
      this.rain.canvas.classList.toggle("indoor", !!indoor);
      this.bgLayer.classList.toggle("indoor", !!indoor);
      this._rainIndoor = !!indoor;
      this.updateRainSound();
    },

    // 雨聲：室外比較大聲，室內變成隔著窗戶的小聲
    updateRainSound() {
      const lv = this._rainLevel || 0;
      if (!window.AudioMgr || !AudioMgr.setAmbient) return;
      if (lv <= 0) { AudioMgr.setAmbient(null); return; }
      const g = Math.min(1, 0.45 + 0.25 * lv) * (this._rainIndoor ? 0.35 : 1);
      AudioMgr.setAmbient("雨", g);
    },

    async setBg(name, fadeSec) {
      if (name === this.currentBg) return;
      this.currentBg = name;
      this.updateRainPlace(name);
      const ms = this.skipping ? 120 : Math.max(0, (fadeSec === null || fadeSec === undefined ? 0.9 : fadeSec) * 1000);
      const next = this.bgFront === this.bgA ? this.bgB : this.bgA;
      this.paintBg(next, name);
      next.style.setProperty("--fade", ms + "ms");
      this.bgFront.style.setProperty("--fade", ms + "ms");
      next.style.zIndex = 2; this.bgFront.style.zIndex = 1;
      void next.offsetWidth;
      next.classList.add("on");
      const old = this.bgFront;
      this.bgFront = next;
      await sleep(ms);
      if (this.bgFront === next) old.classList.remove("on");
    },
    setBgInstant(name) {
      this.currentBg = name;
      this.updateRainPlace(name);
      for (const el of [this.bgA, this.bgB]) { el.style.setProperty("--fade", "0ms"); el.classList.remove("on"); }
      this.paintBg(this.bgA, name);
      this.bgA.style.zIndex = 2; this.bgB.style.zIndex = 1;
      void this.bgA.offsetWidth;
      this.bgA.classList.add("on");
      this.bgFront = this.bgA;
    },

    // ---------- 立繪 ----------
    charEl(who) { return this.charLayer.querySelector(`.char[data-who="${CSS.escape(who)}"]`); },
    showChar(who, expr, pos, instant) {
      const src = ((this.cfg.角色[who] || {}).立繪 || {})[expr];
      if (!src) return;
      let el = this.charEl(who);
      if (!el) {
        el = document.createElement("div");
        el.className = "char" + (instant ? " on" : " enter");
        el.dataset.who = who;
        el.dataset.pos = pos;
        const img = document.createElement("img");
        img.alt = who;
        img.src = src;
        img.dataset.expr = expr;
        img.draggable = false;
        el.append(img);
        this.charLayer.append(el);
        if (!instant) requestAnimationFrame(() => requestAnimationFrame(() => { el.classList.add("on"); el.classList.remove("enter"); }));
        return;
      }
      el.classList.add("on");
      el.dataset.pos = pos;
      const cur = el.querySelector("img:not(.out)");
      if (cur && cur.dataset.expr === expr) return;
      const img = document.createElement("img");
      img.alt = who; img.src = src; img.dataset.expr = expr; img.draggable = false;
      if (!instant) img.classList.add("out");
      el.append(img);
      if (cur) cur.classList.add("out");
      requestAnimationFrame(() => requestAnimationFrame(() => img.classList.remove("out")));
      setTimeout(() => { el.querySelectorAll("img.out").forEach((i) => i.remove()); }, instant ? 0 : 300);
    },
    hideChar(who, instant) {
      const els = who === "*" ? [...this.charLayer.children] : [this.charEl(who)].filter(Boolean);
      for (const el of els) {
        el.classList.remove("on");
        if (instant) el.remove(); else setTimeout(() => el.remove(), 450);
      }
    },

    setPetals(level, instant) {
      this._petalLevel = level;
      const on = Store.meta.settings.ambientPetals ? level : 0;
      const cv = this.petals.canvas;
      clearTimeout(this._petalFade);
      if (on === 0) {
        this.petals.setLevel(0);
        if (instant || this.skipping) { this.petals.clear(); cv.style.opacity = "1"; return; }
        // 停止時讓空中的花瓣淡出，不要等它們慢慢落完
        cv.style.transition = "opacity 1.2s ease";
        cv.style.opacity = "0";
        this._petalFade = setTimeout(() => {
          if (this.petals.level === 0) this.petals.clear();
          cv.style.transition = "none";
          cv.style.opacity = "1";
        }, 1250);
      } else {
        cv.style.transition = "opacity 0.6s ease";
        cv.style.opacity = "1";
        this.petals.setLevel(on);
      }
    },

    // ---------- 下雨 ----------
    setRain(level, instant) {
      this._rainLevel = level;
      this.updateRainSound();
      const cv = this.rain.canvas;
      clearTimeout(this._rainFade);
      this.bgLayer.classList.toggle("rainy", level > 0);
      if (level > 0) {
        cv.style.transition = instant ? "none" : "opacity 1.2s ease";
        cv.style.opacity = "1";
        this.rain.setLevel(level, instant || !this.rain.running);
        return;
      }
      this.rain.setLevel(0);
      if (instant || this.skipping) { this.rain.clear(); return; }
      cv.style.transition = "opacity 1.4s ease";
      cv.style.opacity = "0";
      this._rainFade = setTimeout(() => {
        if (this.rain.level === 0) this.rain.clear();
        cv.style.transition = "none";
        cv.style.opacity = "1";
      }, 1450);
    },

    // 讓「一片花瓣」這類單獨的演出不受淡出影響
    petalsSolo() {
      clearTimeout(this._petalFade);
      if (this.petals.level === 0) this.petals.ps = [];
      const cv = this.petals.canvas;
      cv.style.transition = "none";
      cv.style.opacity = "1";
    },

    setBox(show) { this.boxForcedHidden = !show; if (!show) this.textbox.classList.add("hidden"); },

    // ---------- 台詞 ----------
    say(o) {
      return new Promise((resolve) => {
        this.clearLine();
        if (!this.boxForcedHidden) this.textbox.classList.remove("hidden");
        this.tbName.textContent = o.name ? `【${o.name}】` : "";
        this.tbName.style.setProperty("--name-color", o.color || "var(--sakura)");
        this.tbText.classList.toggle("narr", !o.name);
        this.tbText.textContent = "";
        const chars = [...o.text];
        const frag = document.createDocumentFragment();
        const spans = chars.map((c) => {
          const s = document.createElement("span");
          s.className = "ch";
          s.textContent = c;
          frag.append(s);
          return s;
        });
        const next = document.createElement("span");
        next.className = "tb-next";
        frag.append(next);
        this.tbText.append(frag);
        this.backlog.push({ name: o.name, color: o.color, text: o.text });
        if (this.backlog.length > 300) this.backlog.shift();

        // 快進到沒讀過的地方就停下
        if (this.skipping && !this.canSkip(o)) { this.skip = false; this.updateBadge(); }

        this.line = { spans, idx: 0, typing: true, next, read: o.read, len: chars.length, resolve, timer: null, inner: o.inner || null };
        this.heart.hidden = !(o.inner && o.inner.length);
        this.heart.classList.remove("seen");
        this.positionHeart();
        this.waiter = { kind: "say", resolve };
        const instant = (this.skipping && this.canSkip(o)) || this.cps() === Infinity;
        if (instant) this.finishTyping();
        else this.typeLoop();
      });
    },

    typeLoop() {
      const l = this.line;
      let last = performance.now();
      const step = (now) => {
        if (this.line !== l || !l.typing) return;
        if (this.screenStack.length || this.modalOpen) { last = now; l.raf = requestAnimationFrame(step); return; }
        const dt = Math.max(0, (now - last) / 1000);
        last = Math.max(last, now);
        const target = Math.min(l.spans.length, l.idx + dt * this.cps());
        for (let i = Math.max(0, Math.floor(l.idx)); i < Math.floor(target); i++) l.spans[i].classList.add("v");
        l.idx = target;
        if (l.idx >= l.spans.length) this.finishTyping();
        else l.raf = requestAnimationFrame(step);
      };
      l.raf = requestAnimationFrame(step);
    },

    finishTyping() {
      const l = this.line;
      if (!l) return;
      cancelAnimationFrame(l.raf);
      l.spans.forEach((s) => s.classList.add("v"));
      l.typing = false;
      l.next.classList.add("on");
      this.scheduleNext();
    },

    scheduleNext() {
      const l = this.line;
      if (!l || l.typing || this.innerMode) return;
      clearTimeout(l.timer);
      if (this.skipping && this.canSkip(l)) l.timer = setTimeout(() => this.resolveLine(), 45);
      else if (this.auto) l.timer = setTimeout(() => { if (!this.screenStack.length && !this.modalOpen) this.resolveLine(); else this.scheduleNext(); }, this.autoWait(l.len));
    },

    resolveLine() {
      const l = this.line;
      if (!l) return;
      clearTimeout(l.timer);
      cancelAnimationFrame(l.raf);
      this.line = null;
      const w = this.waiter;
      this.waiter = null;
      if (w) w.resolve();
    },

    clearLine() {
      const l = this.line;
      if (l) { clearTimeout(l.timer); cancelAnimationFrame(l.raf); }
      this.line = null;
      if (this.innerMode) this.closeInner(true);
      if (this.heart) this.heart.hidden = true;
    },

    // ---------- 櫻的心聲（點名字旁的愛心） ----------
    positionHeart() {
      const nameW = this.tbName.textContent ? this.tbName.getBoundingClientRect().width / (this.scale || 1) : 0;
      this.heart.style.left = (318 + (nameW ? nameW + 14 : 0)) + "px";
    },
    openInner() {
      const l = this.line;
      if (!l || !l.inner || !l.inner.length || this.innerMode) return;
      if (l.typing) this.finishTyping();
      clearTimeout(l.timer);
      const saved = document.createDocumentFragment();
      while (this.tbText.firstChild) saved.append(this.tbText.firstChild);
      this.innerMode = {
        i: -1, lines: l.inner, saved,
        name: this.tbName.textContent, color: this.tbName.style.getPropertyValue("--name-color"),
        narr: this.tbText.classList.contains("narr"),
      };
      this.textbox.classList.add("inner");
      this.heart.hidden = true;
      this.nextInner();
    },
    nextInner() {
      const m = this.innerMode;
      if (!m) return;
      m.i++;
      if (m.i >= m.lines.length) { this.closeInner(); return; }
      const ln = m.lines[m.i];
      this.tbName.textContent = ln.name ? `【${ln.name}】` : "";
      this.tbName.style.setProperty("--name-color", ln.color || "var(--sakura)");
      this.tbText.classList.toggle("narr", !ln.name);
      this.tbText.textContent = "";
      const span = document.createElement("span");
      span.className = "inner-line";
      span.textContent = ln.text;
      const next = document.createElement("span");
      next.className = "tb-next on";
      this.tbText.append(span, next);
      this.backlog.push({ name: ln.name, color: ln.color, text: ln.text, inner: true });
    },
    closeInner(silent) {
      const m = this.innerMode;
      if (!m) return;
      this.innerMode = null;
      this.textbox.classList.remove("inner");
      if (silent) return;
      this.tbText.textContent = "";
      this.tbText.append(m.saved);
      this.tbName.textContent = m.name;
      this.tbName.style.setProperty("--name-color", m.color);
      this.tbText.classList.toggle("narr", m.narr);
      // 看過一次之後，愛心變成空心，仍然可以再點
      if (this.line) { this.heart.hidden = false; this.heart.classList.add("seen"); this.positionHeart(); this.scheduleNext(); }
    },

    advance() {
      if (this.innerMode) { this.nextInner(); return; }
      const w = this.waiter;
      if (!w) return;
      if (w.kind === "say") {
        if (this.line && this.line.typing) this.finishTyping();
        else { if (this.skip) this.setSkip(false); this.resolveLine(); }
      } else if (w.kind === "card") {
        w.resolve();
      } else if (w.kind === "wait" || w.kind === "fx") {
        if (w.skippable !== false) { this.waiter = null; w.resolve(); }
      }
    },

    // ---------- 選項 ----------
    choose(items) {
      return new Promise((resolve) => {
        this.clearLine();
        this.skip = false; this.updateBadge();
        const tbNext = this.tbText.querySelector(".tb-next");
        if (tbNext) tbNext.classList.remove("on");
        const layer = this.choiceLayer;
        layer.textContent = "";
        items.forEach((it, i) => {
          const b = document.createElement("button");
          b.className = "choice";
          b.disabled = !!it.disabled;
          b.style.transitionDelay = (i * 70) + "ms";
          b.innerHTML = `<svg class="petal-mark l"><use href="#i-petal"/></svg><span></span><svg class="petal-mark r"><use href="#i-petal"/></svg>`;
          b.querySelector("span").textContent = it.text;
          if (it.disabled) b.setAttribute("aria-disabled", "true");
          if (it.glitch && !it.disabled) {
            b.classList.add("glitch");
            const nz = document.createElement("i");
            nz.className = "noise";
            nz.setAttribute("aria-hidden", "true");
            b.append(nz);
            // 每個選項的雜訊錯開出現，不會同時閃
            const d = (-Math.random() * 4).toFixed(2) + "s";
            b.style.setProperty("--glitch-delay", d);
          }
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            if (b.disabled || this.waiter !== waiter) return;
            this.waiter = null;
            b.classList.add("picked");
            layer.querySelectorAll(".choice").forEach((x) => (x.style.transitionDelay = "0ms"));
            setTimeout(() => { layer.classList.remove("on"); }, 220);
            setTimeout(() => { layer.textContent = ""; resolve(i); }, 520);
          });
          layer.append(b);
        });
        const waiter = { kind: "choice", resolve };
        this.waiter = waiter;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          layer.classList.add("on");
          const first = layer.querySelector(".choice:not(:disabled)");
          if (first && this._keyboardUser) first.focus({ preventScroll: true });
        }));
      });
    },

    // ---------- 換日 ----------
    dayCard(n, sub) {
      return new Promise((resolve) => {
        this.clearLine();
        this.textbox.classList.add("hidden");
        $("dc-num").textContent = n;
        $("dc-sub").textContent = sub || "";
        const fast = this.skipping;
        // 快進時文字直接出現；平常會淡入，但一定會先讓玩家看到「第 N 天」才能點掉
        this.dayEl.classList.toggle("fast", fast);
        void this.dayEl.offsetWidth;
        this.dayEl.classList.add("on");
        let done = false;
        const t0 = performance.now();
        const minShow = fast ? 650 : 1100;
        const finish = (byClick) => {
          if (done) return;
          if (byClick && performance.now() - t0 < minShow) return;
          done = true;
          if (this.waiter === w) this.waiter = null;
          this.dayEl.classList.remove("on");
          setTimeout(resolve, fast ? 180 : 650);
        };
        const w = { kind: "card", resolve: () => finish(true), keep: true };
        this.waiter = w;
        setTimeout(() => finish(false), fast ? 900 : 2800);
      });
    },

    // ---------- 等待／效果 ----------
    wait(sec) {
      return new Promise((resolve) => {
        const ms = this.skipping ? 30 : sec * 1000;
        let done = false;
        const finish = () => { if (done) return; done = true; if (this.waiter === w) this.waiter = null; resolve(); };
        const w = { kind: "wait", resolve: finish };
        this.waiter = w;
        setTimeout(finish, ms);
      });
    },

    setVeil(on, instant) {
      this.veil.style.transitionDuration = instant ? "0ms" : "900ms";
      this.veil.classList.toggle("on", !!on);
    },
    setMemory(on) { this.bgLayer.classList.toggle("memory", !!on); this.charLayer.style.filter = on ? "sepia(0.3) saturate(0.75)" : ""; },

    async fx(name, args) {
      const fast = this.skipping;
      switch (name) {
        case "震動":
          this.stage.classList.remove("shake"); void this.stage.offsetWidth; this.stage.classList.add("shake");
          await sleep(fast ? 50 : 420); this.stage.classList.remove("shake"); return;
        case "閃白":
          this.flash.style.transitionDuration = "120ms"; this.flash.classList.add("on");
          await sleep(fast ? 60 : 160);
          this.flash.style.transitionDuration = fast ? "100ms" : "700ms"; this.flash.classList.remove("on");
          await sleep(fast ? 60 : 500); return;
        case "淡出": case "黑幕":
          this.textbox.classList.add("hidden");
          this.setVeil(true); await sleep(fast ? 80 : 950); return;
        case "淡入": case "黑幕結束":
          this.setVeil(false); await sleep(fast ? 80 : 950); return;
        case "回憶": this.setMemory(true); return;
        case "回憶結束": this.setMemory(false); return;
        case "一片花瓣": {
          this.textbox.classList.add("hidden");
          if (fast) return;
          this.petalsSolo();
          const p = this.petals.single({ x: 1000, y: -50, tx: 700, ty: 960, s: 38, dur: 6500 });
          await new Promise((resolve) => {
            let done = false;
            const finish = () => { if (done) return; done = true; if (this.waiter === w) this.waiter = null; resolve(); };
            const w = { kind: "fx", resolve: finish };
            this.waiter = w;
            p.then(finish);
          });
          return;
        }
      }
      if (this.cfg.開發模式) this.toast(`未知的效果：${name}`);
    },

    // ---------- 場景重設 ----------
    resetScene() {
      this.cancelAll();
      this.setBgInstant(null);
      this.hideChar("*", true);
      this.setPetals(0, true);
      this.setRain(0, true);
      this.setVeil(false, true);
      this.setMemory(false);
      this.boxForcedHidden = false;
      this.textbox.classList.add("hidden");
      this.tbName.textContent = "";
      this.tbText.textContent = "";
    },

    restoreScene(st, soft) {
      this.cancelAll();
      if (soft) {
        // 希望輪重來：先黑幕，再換回當天的場景
        this.hideChar("*", true);
      }
      this.setBgInstant(st.bg);
      this.hideChar("*", true);
      for (const [who, c] of Object.entries(st.chars || {})) this.showChar(who, c.expr, c.pos, true);
      this.setPetals(0, true);
      this.setPetals(st.petals || 0);
      this.setRain(st.rain || 0, true);
      this.setVeil(!!st.veil, true);
      this.setMemory(!!st.memory);
      this.boxForcedHidden = st.box === false;
      this.textbox.classList.add("hidden");
      this.tbName.textContent = "";
      this.tbText.textContent = "";
    },

    cancelAll() {
      this.clearLine();
      const w = this.waiter;
      this.waiter = null;
      if (w) { try { w.resolve(CANCEL); } catch (e) {} }
      this.choiceLayer.classList.remove("on");
      this.choiceLayer.textContent = "";
      this.dayEl.classList.remove("on");
    },

    // ---------- 結局演出 ----------
    async endingSequence(type, info) {
      this.clearLine();
      this.stopModes();
      const layer = $("ending-layer");
      const txt = $("ending-text");
      const pf = this.endingPetals;
      const styles = {
        death: "radial-gradient(ellipse at 50% 20%, #3b2a3f 0%, #17111b 55%, #07050a 100%)",
        hopeDeath: "radial-gradient(ellipse at 50% 30%, #2b2232 0%, #0e0a11 70%)",
        despair: "radial-gradient(ellipse at 50% 40%, #1d1520 0%, #050306 80%)",
        perfect: "linear-gradient(180deg, #fbe7ec 0%, #f6d7df 40%, #dfeadc 100%)",
      };
      layer.style.background = styles[type] || styles.death;
      txt.textContent = "";
      txt.classList.remove("on");
      txt.style.color = type === "perfect" ? "#5b3d49" : "";
      layer.classList.add("on");
      this.textbox.classList.add("hidden");

      let skipped = false;
      const skipP = new Promise((resolve) => {
        const w = { kind: "fx", resolve: () => { skipped = true; resolve(); } };
        setTimeout(() => { if (!skipped) this.waiter = w; }, 1500);
        this._endingWaiter = w;
      });
      const race = (p) => Promise.race([p, skipP]);

      await race(sleep(1400));
      if (type === "death") {
        await race(pf.single({ x: 900, y: -60, tx: 760, ty: 990, s: 46, dur: 8000, fadeOut: true }));
      } else if (type === "hopeDeath") {
        await race(pf.single({ x: 880, y: -60, tx: 760, ty: 990, s: 40, dur: 4200 }));
      } else if (type === "despair") {
        pf.setLevel(4, true);
        await race(sleep(4200));
        pf.setLevel(0);
        await race(sleep(2600));
      } else if (type === "perfect") {
        pf.setLevel(2, true);
        await race(sleep(1200));
        const cap = typeof this.cfg.完美結局字幕 === "string" ? this.cfg.完美結局字幕.trim() : "";
        if (cap) { txt.textContent = cap; txt.classList.add("on"); }
        await race(sleep(7000));
        pf.setLevel(0);
      }
      if (this.waiter === this._endingWaiter) this.waiter = null;
      layer.style.transition = "opacity 1.2s ease";
      // 轉黑
      layer.style.background = "#000";
      txt.classList.remove("on");
      await sleep(900);
      pf.clear();
      this.resetScene();
      await sleep(300);
      layer.classList.remove("on");
      layer.style.transition = "";
    },

    // ---------- 工作人員名單（慢慢往上捲，點一下可以結束） ----------
    async credits(list) {
      if (!list || !list.length) return;
      const layer = $("ending-layer");
      const roll = document.createElement("div");
      roll.className = "credits-roll";
      const inner = document.createElement("div");
      inner.className = "credits-inner";
      list.forEach((sec, i) => {
        const [role, ...names] = sec;
        const b = document.createElement("div");
        b.className = "cr-sec" + (!role && i === 0 ? " cr-title" : !role ? " cr-end" : "");
        if (role) { const r = document.createElement("div"); r.className = "cr-role"; r.textContent = role; b.append(r); }
        names.forEach((n) => { const d = document.createElement("div"); d.className = "cr-name"; d.textContent = n; b.append(d); });
        inner.append(b);
      });
      roll.append(inner);
      layer.style.transition = "opacity 1.2s ease";
      layer.style.background = "#0b080d";
      layer.append(roll);
      layer.classList.add("on");
      this.textbox.classList.add("hidden");
      await sleep(400);
      const H = inner.offsetHeight, view = 900;
      const dur = Math.max(26000, (H + view) * 24);
      inner.style.transform = `translateY(${view}px)`;
      void inner.offsetWidth;
      inner.style.transition = `transform ${dur}ms linear`;
      inner.style.transform = `translateY(${-H}px)`;
      await new Promise((r) => {
        const t = setTimeout(done, dur + 300);
        function done(e) { if (e && e.stopPropagation) e.stopPropagation(); clearTimeout(t); layer.removeEventListener("click", done); window.removeEventListener("keydown", key); r(); }
        const key = (e) => { if (e.key === "Escape" || e.key === "Enter" || e.key === " ") { e.preventDefault(); done(); } };
        setTimeout(() => { layer.addEventListener("click", done); window.addEventListener("keydown", key); }, 800);
      });
      layer.classList.remove("on");
      await sleep(1000);
      roll.remove();
      layer.style.transition = "";
    },

    // ---------- 黑底字幕（一頁一頁，點一下換頁；最後一頁可以有按鈕） ----------
    async captions(pages, opts) {
      pages = (pages || []).filter((p) => p && String(p).trim());
      const button = opts && opts.button;
      if (!pages.length) return;
      const layer = $("ending-layer");
      const txt = $("ending-text");
      const perfect = opts && opts.style === "perfect";
      layer.style.transition = "opacity 1.2s ease";
      layer.style.background = perfect ? "linear-gradient(180deg, #fbe7ec 0%, #f6d7df 40%, #dfeadc 100%)" : "#000";
      txt.style.color = perfect ? "#5b3d49" : "";
      txt.style.textShadow = perfect ? "0 1px 10px rgba(255, 255, 255, 0.7)" : "";
      txt.classList.add("caption");
      txt.classList.toggle("caption-long", pages.some((p) => String(p).length > 24));
      layer.classList.add("on");
      this.textbox.classList.add("hidden");
      await sleep(900);
      for (let i = 0; i < pages.length; i++) {
        txt.textContent = pages[i];
        void txt.offsetWidth;
        txt.classList.add("on");
        await sleep(1400);
        const last = i === pages.length - 1;
        if (last && button) {
          const b = document.createElement("button");
          b.className = "btn primary caption-btn";
          b.textContent = button;
          layer.append(b);
          requestAnimationFrame(() => b.classList.add("on"));
          b.focus();
          await new Promise((r) => b.addEventListener("click", (e) => { e.stopPropagation(); AudioMgr.unlock(); r(); }, { once: true }));
          b.classList.remove("on");
          setTimeout(() => b.remove(), 800);
        } else {
          const hint = document.createElement("div");
          hint.className = "caption-hint" + (perfect ? " dark" : "");
          hint.textContent = "▼";
          layer.append(hint);
          setTimeout(() => hint.classList.add("on"), 1500);
          await new Promise((r) => {
            const done = (e) => { if (e) e.stopPropagation(); layer.removeEventListener("click", done); window.removeEventListener("keydown", key); r(); };
            const key = (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); done(); } };
            layer.addEventListener("click", done);
            window.addEventListener("keydown", key);
          });
          hint.remove();
        }
        txt.classList.remove("on");
        await sleep(1000);
      }
      txt.classList.remove("caption", "caption-long");
      txt.style.color = "";
      txt.style.textShadow = "";
      layer.classList.remove("on");
      await sleep(900);
      layer.style.transition = "";
    },

    // ---------- 感情值提示（不顯示數字） ----------
    emotionHint(changes, big) {
      const E = this.cfg.感情值 || {};
      if (E.提示 === false || this.skipping) return;
      let box = $("emo-hint");
      if (!box) { box = document.createElement("div"); box.id = "emo-hint"; this.stage.append(box); }
      changes.forEach((c, i) => {
        const def = (E.項目 || {})[c.name] || {};
        const item = document.createElement("div");
        const dir = E.提示方向 === false ? "" : c.delta > 0 ? " up" : " down";
        item.className = "emo" + dir + (big ? " big" : "");
        item.style.setProperty("--emo", def.顏色 || "var(--sakura)");
        item.style.animationDelay = (i * 260) + "ms";
        item.innerHTML = '<svg class="emo-petal" viewBox="0 0 24 24"><use href="#i-petal"/></svg><span></span>';
        item.querySelector("span").textContent = c.name;
        box.append(item);
        setTimeout(() => item.remove(), 3200 + i * 260);
      });
    },

    // ---------- 提示 ----------
    toast(msg, ms) {
      const t = $("toast");
      t.textContent = msg;
      t.classList.add("on");
      clearTimeout(this._toastT);
      this._toastT = setTimeout(() => t.classList.remove("on"), ms || 2000);
    },

    showError(msg, list) {
      let box = $("error-box");
      if (!box) {
        box = document.createElement("div");
        box.id = "error-box";
        box.className = "scroll";
        this.stage.append(box);
      }
      box.innerHTML = "";
      const h = document.createElement("h3"); h.textContent = msg; box.append(h);
      if (list && list.length) {
        const ul = document.createElement("ul");
        list.slice(0, 40).forEach((e) => {
          const li = document.createElement("li");
          li.textContent = `${e.file} 第 ${e.line} 行：${e.msg}`;
          ul.append(li);
        });
        box.append(ul);
      }
      const b = document.createElement("button");
      b.className = "btn small"; b.textContent = "關閉";
      b.addEventListener("click", (e) => { e.stopPropagation(); box.remove(); });
      box.append(b);
    },
  };

  window.addEventListener("keydown", (e) => { if (e.key === "Tab") UI._keyboardUser = true; });
  window.addEventListener("pointerdown", () => { UI._keyboardUser = false; });

  window.UI = UI;
})();
