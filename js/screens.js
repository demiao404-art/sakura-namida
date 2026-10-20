/* =========================================================
   各種畫面：內容警告、標題、取名、選單、存讀檔、設定、回顧、開發者工具
   ========================================================= */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const pad = (n) => String(n).padStart(2, "0");
  const fmtTime = (t) => { const d = new Date(t); return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

  const OVERLAYS = ["menu", "saves", "settings", "log", "cloud", "gallery", "afterword", "dev", "warning"];

  const Screens = {
    stack: [],
    base: null,

    init(engine, config, script) {
      this.engine = engine;
      this.cfg = config;
      this.script = script;

      document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); this.closeTop(); }));
      ["screen-menu", "screen-saves", "screen-settings", "screen-log", "screen-cloud", "screen-gallery", "screen-afterword", "screen-dev"].forEach((id) =>
        $(id).addEventListener("click", (e) => e.stopPropagation()));

      this.initWarning();
      this.initTitle();
      this.initName();
      this.initMenu();
      $("modal").addEventListener("click", (e) => { e.stopPropagation(); if (e.target.id === "modal") this.closeModal(); });
    },

    // ---------- 畫面切換 ----------
    showBase(name) {
      ["warning", "title", "name"].forEach((n) => {
        const s = $("screen-" + n);
        s.classList.toggle("on", n === name);
        s.style.zIndex = 20;
      });
      this.base = name;
    },

    open(name, opts) {
      if (this.stack.includes(name)) return;
      const s = $("screen-" + name);
      if (name === "saves") this.renderSaves(opts && opts.mode || "save");
      if (name === "settings") this.renderSettings();
      if (name === "log") this.renderLog();
      if (name === "cloud") this.renderCloud();
      if (name === "gallery") this.renderGallery();
      if (name === "afterword") this.renderAfterword();
      if (name === "dev") this.renderDev();
      if (name === "warning") this.renderWarning(true);
      this.stack.push(name);
      s.style.zIndex = 30 + this.stack.length;
      s.classList.add("on");
      UI.screenStack = this.stack;
      const focusable = s.querySelector("[data-close], .menu-item, button");
      if (focusable && UI._keyboardUser) focusable.focus({ preventScroll: true });
    },

    close(name) {
      const i = this.stack.indexOf(name);
      if (i < 0) return;
      this.stack.splice(i, 1);
      $("screen-" + name).classList.remove("on");
      if (name === "warning" && this.base === "warning") $("screen-warning").classList.add("on");
      UI.screenStack = this.stack;
      if (!this.stack.length) UI.kick();
    },

    closeTop() { if (this.stack.length) this.close(this.stack[this.stack.length - 1]); },
    closeAll() { [...this.stack].forEach((n) => this.close(n)); },

    // ---------- 對話視窗（取代 confirm） ----------
    confirm({ title, text, buttons }) {
      return new Promise((resolve) => {
        $("modal-title").textContent = title || "";
        $("modal-text").textContent = text || "";
        const box = $("modal-btns");
        box.textContent = "";
        (buttons || [{ label: "取消", value: false }, { label: "確定", value: true, kind: "primary" }]).forEach((b) => {
          const btn = el("button", "btn small" + (b.kind ? " " + b.kind : ""), b.label);
          btn.addEventListener("click", (e) => { e.stopPropagation(); this.closeModal(b.value); });
          box.append(btn);
        });
        this._modalResolve = resolve;
        $("modal").classList.add("on");
        UI.modalOpen = true;
        const last = box.lastElementChild;
        if (last) last.focus({ preventScroll: true });
      });
    },
    closeModal(value) {
      $("modal").classList.remove("on");
      UI.modalOpen = false;
      const r = this._modalResolve;
      this._modalResolve = null;
      if (r) r(value === undefined ? null : value);
      UI.kick();
    },

    // ---------- 內容警告 ----------
    initWarning() {
      const W = this.cfg.內容警告 || {};
      $("warn-title").textContent = W.標題 || "內容警告";
      $("warn-check-text").textContent = W.勾選文字 || "我已閱讀並理解以上內容";
      const box = $("warn-text");
      if (W.分級) {
        const head = document.querySelector(".warn-head");
        if (head && !head.querySelector(".rating-badge")) head.append(el("span", "rating-badge", W.分級.級別));
        box.append(el("p", "warn-rating", W.分級.說明 || ""));
      }
      (W.內文 || []).forEach((p) => box.append(el("p", null, p)));
      if (W.求助資訊 && W.求助資訊.length) {
        const list = el("div", "helplines");
        W.求助資訊.forEach((h) => {
          const row = el("div", "helpline");
          row.append(el("div", "hn", h.名稱), el("div", "hp", h.電話), el("div", "hd", h.說明 || ""));
          list.append(row);
        });
        box.append(list);
      }
      if (W.結語) box.append(el("p", "warn-end", W.結語));

      const check = $("warn-check");
      const wrap = $("warn-check-wrap");
      const ok = $("warn-ok");
      const reached = () => {
        if (box.scrollTop + box.clientHeight >= box.scrollHeight - 12) {
          check.disabled = false;
          wrap.classList.remove("disabled");
          $("warn-hint").textContent = "";
        }
      };
      box.addEventListener("scroll", reached, { passive: true });
      this._warnReached = reached;
      check.addEventListener("change", () => { ok.disabled = !check.checked; });
      ok.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.stack.includes("warning")) { this.close("warning"); return; }
        if (!check.checked) return;
        Store.meta.warningAccepted = true;
        Store.save("warning");
        this.goTitle();
      });
    },

    renderWarning(asOverlay) {
      const box = $("warn-text");
      const check = $("warn-check");
      const wrap = $("warn-check-wrap");
      const ok = $("warn-ok");
      box.scrollTop = 0;
      if (asOverlay) {
        wrap.hidden = true;
        $("warn-hint").textContent = "";
        ok.disabled = false;
        ok.textContent = "返回";
      } else {
        wrap.hidden = false;
        check.checked = false;
        check.disabled = true;
        wrap.classList.add("disabled");
        ok.disabled = true;
        ok.textContent = "進入遊戲";
        $("warn-hint").textContent = "請先將內容閱讀到最後";
        // 內容不需要捲動時直接開放
        requestAnimationFrame(() => this._warnReached());
      }
    },

    showWarning() {
      this.renderWarning(false);
      this.showBase("warning");
    },

    // ---------- 標題 ----------
    initTitle() {
      $("title-main").textContent = this.cfg.標題 || "櫻";
      $("title-sub").textContent = this.cfg.副標題 || "";
      document.querySelector(".title-menu").addEventListener("click", async (e) => {
        const b = e.target.closest(".tm");
        if (!b || b.disabled) return;
        e.stopPropagation();
        AudioMgr.unlock();
        const act = b.dataset.act;
        if (act === "start") this.startFlow();
        if (act === "continue") { const s = Store.getSlot("auto"); if (s) this.loadSlot(s); }
        if (act === "load") this.open("saves", { mode: "load" });
        if (act === "settings") this.open("settings");
        if (act === "cloud") this.open("cloud");
        if (act === "gallery") this.open("gallery");
        if (act === "afterword") this.open("afterword");
      });
    },

    goTitle(opts) {
      this.closeAll();
      UI.setPlaying(false);
      UI.resetScene();
      const ts = this.engine.titleState();
      Title.render(ts);
      $("title-main").textContent = (Store.meta.perfect && this.cfg.完美結局後標題) || this.cfg.標題 || "櫻";
      // 標題畫面的音樂：跟著輪迴的階段改變（設定在 game-config.js 的「標題音樂」）
      const tm = this.cfg.標題音樂 || {};
      const m = Store.meta;
      AudioMgr.bgm((m.perfect ? tm.完美結局之後 : m.despairDone ? tm.絕望輪之後 : tm.平常) || null);
      document.querySelector('.tm[data-act="continue"]').disabled = !Store.getSlot("auto");
      $("tm-cloud").hidden = !Cloud.available() && !this.cfg.開發模式;
      // 作者的話：希望結局（完美結局）達成之後，才出現在標題畫面
      $("tm-afterword").hidden = !(Store.meta.perfect && (this.cfg.作者的話 || []).length);
      $("title-foot").textContent = this.cfg.開發模式 ? "開發模式　F2 開啟開發者工具" : "";
      this.showBase("title");
      if (Store.meta.innerUnlockedNotice) {
        Store.meta.innerUnlockedNotice = false;
        Store.save("notice");
        setTimeout(() => UI.toast("從現在起，在重新走過的日子裡，點一下名字旁的愛心，就能聽見櫻的心聲。", 7000), 2200);
      }
    },

    async startFlow() {
      if (Store.getSlot("auto")) {
        const ok = await this.confirm({
          title: "重新開始",
          text: "目前還有一段沒有走完的故事。\n要從第一天重新開始嗎？",
          buttons: [{ label: "取消", value: false }, { label: "重新開始", value: true, kind: "primary" }],
        });
        if (!ok) return;
        Store.deleteSlot("auto");
      }
      if (!Store.meta.playerName) { this.askName(() => this.startGame()); return; }
      this.startGame();
    },

    startGame() {
      this.showBase(null);
      Title.stop();
      UI.setPlaying(true);
      this.engine.newGame();
    },

    loadSlot(slot) {
      this.closeAll();
      this.showBase(null);
      Title.stop();
      UI.setPlaying(true);
      this.engine.loadState(slot.state);
    },

    // ---------- 取名 ----------
    initName() {
      $("name-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const v = $("name-input").value.trim();
        const err = $("name-err");
        if (!v) { err.textContent = "請輸入名字"; return; }
        if ([...v].length > 8) { err.textContent = "名字最多 8 個字"; return; }
        if (/[{}\[\]<>]/.test(v)) { err.textContent = "名字裡不能有 { } [ ] < > 這些符號"; return; }
        err.textContent = "";
        Store.meta.playerName = v;
        Store.save("name");
        const cb = this._nameCb; this._nameCb = null;
        if (cb) cb();
      });
      $("screen-name").addEventListener("click", (e) => e.stopPropagation());
    },
    askName(cb) {
      this._nameCb = cb;
      $("name-input").value = Store.meta.playerName || "";
      $("name-err").textContent = "";
      this.showBase("name");
      setTimeout(() => $("name-input").focus(), 400);
    },

    // ---------- 遊戲選單 ----------
    initMenu() {
      $("screen-menu").addEventListener("click", async (e) => {
        const b = e.target.closest(".menu-item");
        if (!b) { if (e.target.id === "screen-menu" || e.target.classList.contains("menu-list")) this.close("menu"); return; }
        const act = b.dataset.act;
        if (act === "resume") this.close("menu");
        if (act === "save") this.open("saves", { mode: "save" });
        if (act === "load") this.open("saves", { mode: "load" });
        if (act === "log") this.open("log");
        if (act === "settings") this.open("settings");
        if (act === "title") {
          const ok = await this.confirm({ title: "回到標題", text: "沒有存檔的進度會消失。\n（每天開始和遇到選項時會自動存檔，可以從「繼續」回來。）", buttons: [{ label: "取消", value: false }, { label: "回到標題", value: true, kind: "primary" }] });
          if (ok) { this.engine.stop(); this.goTitle(); }
        }
      });
    },

    quickSave() {
      if (!this.engine.state) return;
      Store.setSlot("quick", this.engine.makeSlot());
      UI.toast("已快速存檔");
    },
    async quickLoad() {
      const s = Store.getSlot("quick");
      if (!s) { UI.toast("還沒有快速存檔"); return; }
      const ok = await this.confirm({ title: "快速讀取", text: "要讀取快速存檔嗎？\n目前沒有存檔的進度會消失。", buttons: [{ label: "取消", value: false }, { label: "讀取", value: true, kind: "primary" }] });
      if (ok) this.loadSlot(s);
    },

    // ---------- 存讀檔 ----------
    renderSaves(mode) {
      this.saveMode = mode;
      $("saves-title").textContent = mode === "save" ? "存檔" : "讀取";
      $("saves-en").textContent = mode === "save" ? "Save" : "Load";
      const tabs = $("saves-tabs");
      tabs.textContent = "";
      const list = [];
      if (mode === "load") list.push({ id: "auto", label: "自動" });
      list.push({ id: "quick", label: "快速" });
      for (let p = 1; p <= Store.SLOT_COUNT / 6; p++) list.push({ id: "p" + p, label: String(p) });
      list.push({ id: "backup", label: "存檔碼" });
      if (!this.saveTab || !list.some((t) => t.id === this.saveTab)) this.saveTab = mode === "load" && Store.getSlot("auto") ? "auto" : "p1";
      list.forEach((t) => {
        const b = el("button", "tab" + (t.id === this.saveTab ? " on" : ""), t.label);
        b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", t.id === this.saveTab);
        b.addEventListener("click", () => { this.saveTab = t.id; this.renderSaves(mode); });
        tabs.append(b);
      });
      const content = $("saves-content");
      content.textContent = "";
      if (this.saveTab === "backup") { this.renderBackup(content); return; }
      const grid = el("div", "slot-grid");
      let ids;
      if (this.saveTab === "auto") ids = ["auto"];
      else if (this.saveTab === "quick") ids = ["quick"];
      else { const p = Number(this.saveTab.slice(1)); ids = []; for (let i = (p - 1) * 6 + 1; i <= p * 6; i++) ids.push(String(i)); }
      ids.forEach((id) => grid.append(this.slotCard(id, mode)));
      content.append(grid);
      if (this.saveTab === "auto") content.append(el("p", "note", "每天開始和遇到選項時，會自動存在這裡。走到結局後，自動存檔會清空，下一次從頭開始。"));
    },

    slotCard(id, mode) {
      const data = Store.getSlot(id);
      const b = el("button", "slot");
      const label = id === "auto" ? "Auto" : id === "quick" ? "Quick" : "No." + pad(id);
      const thumb = el("div", "slot-thumb");
      const info = el("div", "slot-info");
      info.append(el("div", "slot-no", label));
      if (data) {
        const v = data.bg ? (this.cfg.背景 || {})[data.bg] : null;
        if (v && String(v).startsWith("#")) thumb.style.backgroundColor = v;
        else if (v) thumb.style.backgroundImage = `url("${v}")`;
        else thumb.textContent = "—";
        info.append(el("div", "slot-day", data.day ? `第 ${data.day} 天` : "序章"));
        info.append(el("div", "slot-text", data.text || ""));
        info.append(el("div", "slot-time", fmtTime(data.time)));
        if (id !== "auto") {
          const del = el("span", "slot-del", "刪除");
          del.setAttribute("role", "button");
          del.tabIndex = 0;
          del.addEventListener("click", async (e) => {
            e.stopPropagation();
            const ok = await this.confirm({ title: "刪除存檔", text: `要刪除 ${label} 的存檔嗎？`, buttons: [{ label: "取消", value: false }, { label: "刪除", value: true, kind: "danger" }] });
            if (ok) { Store.deleteSlot(id); this.renderSaves(mode); }
          });
          b.append(del);
        }
      } else {
        thumb.textContent = "Empty";
        info.append(el("div", "slot-empty", "空白"));
      }
      b.prepend(thumb);
      b.append(info);
      const canSave = mode === "save" && this.engine.state && UI.playing && id !== "auto";
      b.disabled = mode === "save" ? !canSave : !data;
      b.addEventListener("click", async () => {
        if (mode === "save") {
          if (data) {
            const ok = await this.confirm({ title: "覆蓋存檔", text: `要覆蓋 ${label} 的存檔嗎？`, buttons: [{ label: "取消", value: false }, { label: "覆蓋", value: true, kind: "primary" }] });
            if (!ok) return;
          }
          Store.setSlot(id, this.engine.makeSlot());
          UI.toast("已存檔");
          this.renderSaves(mode);
        } else if (data) {
          if (UI.playing) {
            const ok = await this.confirm({ title: "讀取存檔", text: `要讀取 ${label} 嗎？\n目前沒有存檔的進度會消失。`, buttons: [{ label: "取消", value: false }, { label: "讀取", value: true, kind: "primary" }] });
            if (!ok) return;
          }
          this.loadSlot(data);
        }
      });
      return b;
    },

    renderBackup(content) {
      const cols = el("div", "backup-cols");

      const exp = el("div", "backup-col");
      exp.append(el("h3", null, "匯出"));
      exp.append(el("p", null, "把目前所有進度（輪迴、花瓣、存檔、設定）變成一段文字。換裝置時貼到另一邊的「匯入」就能接著玩。請自己保管好這段文字。"));
      const out = el("textarea", "code-box"); out.readOnly = true; out.id = "backup-out"; out.placeholder = "按下「產生存檔碼」";
      const r1 = el("div", "row-btns");
      const gen = el("button", "btn small primary", "產生存檔碼");
      const copy = el("button", "btn small", "複製"); copy.disabled = true;
      const dl = el("button", "btn small", "下載成檔案"); dl.disabled = true;
      if (window.__NO_DOWNLOAD) dl.hidden = true;
      const n1 = el("div", "note");
      gen.addEventListener("click", async () => {
        out.value = await Store.exportCode();
        copy.disabled = dl.disabled = false;
        n1.className = "note"; n1.textContent = `存檔碼長度：${out.value.length.toLocaleString()} 字`;
      });
      copy.addEventListener("click", () => {
        const fallback = () => { out.focus(); out.select(); n1.className = "note"; n1.textContent = "已選取全部文字，請按 Ctrl+C（手機長按）複製。"; };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(out.value).then(() => { n1.className = "note ok"; n1.textContent = "已複製到剪貼簿。"; }, fallback);
        } else fallback();
      });
      dl.addEventListener("click", () => {
        try {
          const blob = new Blob([out.value], { type: "text/plain" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          const d = new Date();
          a.download = `櫻-存檔-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.txt`;
          document.body.append(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 2000);
          n1.className = "note"; n1.textContent = "如果沒有開始下載，請改用「複製」。";
        } catch (e) { n1.className = "note err"; n1.textContent = "這裡無法下載，請改用「複製」。"; }
      });
      r1.append(gen, copy, dl);
      exp.append(out, r1, n1);

      const imp = el("div", "backup-col");
      imp.append(el("h3", null, "匯入"));
      imp.append(el("p", null, "貼上存檔碼，或選擇下載過的存檔檔案。預設會和目前的進度合併，兩邊拿到的結局都會保留。"));
      const inp = el("textarea", "code-box"); inp.id = "backup-in"; inp.placeholder = "在這裡貼上存檔碼（SAKURA 開頭）";
      inp.addEventListener("paste", () => setTimeout(() => (n2.textContent = ""), 0));
      const r2 = el("div", "row-btns");
      const file = el("input"); file.type = "file"; file.accept = ".txt,text/plain"; file.hidden = true; file.id = "backup-file";
      const pick = el("button", "btn small", "選擇檔案");
      const go = el("button", "btn small primary", "匯入");
      const n2 = el("div", "note");
      pick.addEventListener("click", () => file.click());
      file.addEventListener("change", () => {
        const f = file.files[0]; if (!f) return;
        const rd = new FileReader();
        rd.onload = () => { inp.value = String(rd.result || ""); n2.className = "note"; n2.textContent = `已讀入「${f.name}」，請按「匯入」。`; };
        rd.readAsText(f);
      });
      go.addEventListener("click", async () => {
        let pkg;
        try { pkg = await Store.decodeCode(inp.value); }
        catch (e) { n2.className = "note err"; n2.textContent = e.message; return; }
        const mode = await this.confirm({
          title: "匯入存檔",
          text: "要怎麼處理目前的進度？\n合併：兩邊的結局、花瓣、存檔都保留（建議）。\n取代：完全改成存檔碼裡的內容。",
          buttons: [{ label: "取消", value: null }, { label: "取代", value: "replace", kind: "danger" }, { label: "合併", value: "merge", kind: "primary" }],
        });
        if (!mode) return;
        Store.applyPackage(pkg, mode);
        UI.applySettings();
        n2.className = "note ok"; n2.textContent = "匯入完成。";
        inp.value = "";
        if (!UI.playing) Title.render(this.engine.titleState());
        this.renderSaves(this.saveMode);
        this.saveTab = "backup";
      });
      r2.append(pick, go, file);
      imp.append(inp, r2, n2);

      cols.append(exp, imp);
      content.append(cols);
    },

    // ---------- 設定 ----------
    renderSettings() {
      const body = $("settings-body");
      body.textContent = "";
      const s = Store.meta.settings;
      const grid = el("div", "settings-grid");

      const slider = (key, label, fmt, after) => {
        const row = el("div", "set-row");
        const id = "set-" + key;
        const lab = el("label", null, label); lab.htmlFor = id;
        const r = el("input"); r.type = "range"; r.min = 0; r.max = 100; r.step = 1; r.value = s[key]; r.id = id;
        const val = el("span", "val", fmt(s[key]));
        const upd = () => { r.style.setProperty("--p", r.value + "%"); val.textContent = fmt(Number(r.value)); };
        upd();
        r.addEventListener("input", () => { s[key] = Number(r.value); upd(); UI.applySettings(); if (after) after(); Store.saveSoon("settings"); });
        row.append(lab, r, val);
        grid.append(row);
      };
      const seg = (key, label, opts) => {
        const row = el("div", "set-row");
        row.append(el("span", "lbl", label));
        const g = el("div", "seg");
        opts.forEach(([v, t]) => {
          const b = el("button", s[key] === v ? "on" : "", t);
          b.addEventListener("click", () => { s[key] = v; g.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); UI.applySettings(); Store.saveSoon("settings"); });
          g.append(b);
        });
        row.append(g, el("span"));
        grid.append(row);
      };

      slider("textSpeed", "文字速度", (v) => (v >= 100 ? "瞬間" : v), () => this.previewText());
      slider("autoDelay", "自動速度", (v) => v);
      slider("bgmVolume", "音樂音量", (v) => v);
      slider("seVolume", "音效音量", (v) => v);
      slider("boxOpacity", "對話框濃度", (v) => v);
      seg("skipMode", "快進", [["read", "只跳過已讀"], ["all", "全部"]]);
      seg("ambientPetals", "飄落花瓣", [[true, "開"], [false, "關"]]);
      seg("showStats", "感情值", [[true, "顯示"], [false, "隱藏"]]);
      if (Store.meta.perfect) {
        if (s.innerVoice === undefined) s.innerVoice = true;
        seg("innerVoice", "心聲的愛心", [[true, "顯示"], [false, "隱藏"]]);
      }

      const fsRow = el("div", "set-row");
      fsRow.append(el("span", "lbl", "全螢幕"));
      const fsBtn = el("button", "btn small", document.fullscreenElement ? "離開全螢幕" : "進入全螢幕");
      fsBtn.addEventListener("click", async () => {
        try {
          if (document.fullscreenElement) await document.exitFullscreen();
          else await document.documentElement.requestFullscreen();
        } catch (e) { UI.toast("這個環境不支援全螢幕"); }
        setTimeout(() => { fsBtn.textContent = document.fullscreenElement ? "離開全螢幕" : "進入全螢幕"; UI.fit(); }, 300);
      });
      const fsWrap = el("div"); fsWrap.append(fsBtn);
      fsRow.append(fsWrap, el("span"));
      grid.append(fsRow);

      const prev = el("div", "set-row wide");
      prev.append(el("span", "lbl", "預覽"));
      const pt = el("div", "preview-text"); pt.id = "speed-preview";
      prev.append(pt);
      grid.append(prev);

      const nameRow = el("div", "set-row wide");
      nameRow.append(el("label", null, "主角名字"));
      const nameWrap = el("div", "row-btns");
      const ni = el("input", "dev-input"); ni.id = "set-name"; ni.maxLength = 8; ni.value = Store.meta.playerName || ""; ni.placeholder = "尚未取名";
      const nb = el("button", "btn small", "儲存名字");
      const nn = el("span", "note");
      nb.addEventListener("click", () => {
        const v = ni.value.trim();
        if (!v || [...v].length > 8 || /[{}\[\]<>]/.test(v)) { nn.className = "note err"; nn.textContent = "名字需為 1～8 個字，且不能有 { } [ ] < >"; return; }
        Store.meta.playerName = v; Store.save("name"); nn.className = "note ok"; nn.textContent = "已儲存";
      });
      nameWrap.append(ni, nb, nn);
      nameRow.append(nameWrap);
      grid.append(nameRow);

      body.append(grid);

      const acts = el("div", "settings-actions");
      const w = el("button", "btn small", "重看內容警告");
      w.addEventListener("click", () => this.open("warning"));
      acts.append(w);
      if (Cloud.available() || this.cfg.開發模式) {
        const c = el("button", "btn small", "雲端存檔");
        c.addEventListener("click", () => this.open("cloud"));
        acts.append(c);
      }
      if (this.cfg.開發模式) {
        const d = el("button", "btn small", "開發者工具");
        d.addEventListener("click", () => this.open("dev"));
        acts.append(d);
      }
      const r = el("button", "btn small danger", "清除所有進度");
      r.addEventListener("click", async () => {
        const a = await this.confirm({ title: "清除所有進度", text: "所有輪迴紀錄、花瓣、存檔都會被刪除，無法復原。\n（設定會保留）", buttons: [{ label: "取消", value: false }, { label: "我要清除", value: true, kind: "danger" }] });
        if (!a) return;
        const b = await this.confirm({ title: "再確認一次", text: "真的要清除嗎？", buttons: [{ label: "不要", value: false }, { label: "清除", value: true, kind: "danger" }] });
        if (!b) return;
        Store.resetAll();
        try { localStorage.removeItem("sakura-vn.seenPetal"); } catch (e) {}
        UI.toast("已清除所有進度");
        this.engine.stop();
        this.goTitle();
      });
      acts.append(r);
      body.append(acts);

      const help = el("p", "note");
      help.style.marginTop = "28px";
      help.textContent = "操作：點擊或 Enter 前進　滑鼠滾輪往上或 L 開啟回顧　按住 Ctrl 快進　A 自動　S 快進　H 或右鍵 隱藏對話框　Esc 選單　數字鍵選擇選項";
      body.append(help);
      this.previewText();
    },

    previewText() {
      const pt = $("speed-preview");
      if (!pt) return;
      cancelAnimationFrame(this._prevRaf);
      const text = "風吹過校門口的櫻花樹，花瓣一片一片地落下。";
      const cps = UI.cps();
      if (cps === Infinity) { pt.textContent = text; return; }
      let i = 0, last = performance.now();
      const step = (now) => {
        i += (now - last) / 1000 * cps; last = now;
        pt.textContent = text.slice(0, Math.floor(i));
        if (i < text.length) this._prevRaf = requestAnimationFrame(step);
        else this._prevRaf = setTimeout(() => this.previewText(), 1200);
      };
      this._prevRaf = requestAnimationFrame(step);
    },

    // ---------- 回顧 ----------
    renderLog() {
      const list = $("log-list");
      list.textContent = "";
      if (!UI.backlog.length) { list.append(el("div", "log-empty", "還沒有內容")); return; }
      UI.backlog.forEach((b) => {
        const row = el("div", "log-item" + (b.choice ? " choice" : "") + (b.inner ? " inner" : ""));
        const n = el("div", "log-name", b.name ? `【${b.name}】` : "");
        if (b.color) n.style.color = b.color;
        row.append(n, el("div", "log-text", b.text));
        list.append(row);
      });
      requestAnimationFrame(() => (list.scrollTop = list.scrollHeight));
      if (!list._bound) {
        list._bound = true;
        list.addEventListener("wheel", (e) => {
          if (e.deltaY > 10 && list.scrollTop + list.clientHeight >= list.scrollHeight - 2) this.close("log");
        }, { passive: true });
      }
    },

    // ---------- 雲端 ----------
    renderCloud() { Cloud.render($("cloud-body")); },

    renderAfterword() {
      const body = $("afterword-body");
      body.textContent = "";
      const wrap = el("div", "afterword");
      (this.cfg.作者的話 || []).forEach((para) => wrap.append(el("p", null, para)));
      body.append(wrap);
    },

    // ---------- 結局圖鑑 ----------
    // 拿到的結局顯示名字和一句話；還沒拿到的只顯示提示。
    // 集滿所有結局之後，會出現「絕望線」；希望線要走到完美結局之後才會出現（之前不給任何提示）。
    renderGallery() {
      const body = $("gallery-body");
      body.textContent = "";
      const G = this.cfg.結局圖鑑 || {};
      const m = Store.meta;
      const list = G.結局 || [];
      const got = new Set(m.endings || []);
      const need = this.engine.endingsNeeded;
      const head = el("div", "gallery-head");
      head.append(el("p", "gallery-count", `花瓣　${Math.min(got.size, need)} ／ ${need}`));
      const cr = el("button", "btn small", "工作人員名單");
      cr.addEventListener("click", async (e) => { e.stopPropagation(); await UI.credits(this.cfg.工作人員名單); });
      const btns = el("div", "row-btns");
      btns.append(cr);
      head.append(btns);
      body.append(head);
      const grid = el("div", "gallery-grid");
      const card = (opts) => {
        const c = el("div", "gallery-card" + (opts.locked ? " locked" : "") + (opts.special ? " special " + opts.special : ""));
        c.append(el("div", "gc-no", opts.no || ""));
        c.append(el("div", "gc-name", opts.name));
        c.append(el("div", "gc-text", opts.text || ""));
        grid.append(c);
      };
      list.forEach((e, i) => {
        const has = got.has(String(e.id));
        card({
          no: "No." + pad(i + 1),
          name: has ? e.名稱 : "？？？",
          text: has ? e.簡介 : "提示：" + e.提示,
          locked: !has,
        });
      });
      const all = got.size >= need;
      if (all || m.despairDone || m.perfect) {
        const sp = el("div", "gallery-grid special-grid");
        const D = G.絕望線 || {}, H = G.希望線 || {}, P = G.完美結局 || {};
        const add = (o) => { const c = el("div", "gallery-card special " + o.cls); c.append(el("div", "gc-no", o.no), el("div", "gc-name", o.name), el("div", "gc-text", o.text)); sp.append(c); };
        add({ cls: "despair", no: "？", name: D.名稱 || "絕望線", text: m.despairDone ? (D.走過 || "") : (D.出現 || "") });
        // 希望線：走完之前完全不提示，走到完美結局之後才出現
        if (m.perfect) add({ cls: "hope", no: "？", name: H.名稱 || "希望線", text: H.走過 || "" });
        if (m.perfect) add({ cls: "perfect", no: "✿", name: P.名稱 || "完美結局", text: P.簡介 || "" });
        body.append(sp);   // 絕望線、希望線放在最上面，集滿的時候一眼就看得到
      }
      body.append(grid);
    },

    // ---------- 開發者工具 ----------
    renderDev() {
      const body = $("dev-body");
      body.textContent = "";
      const eng = this.engine;
      const m = Store.meta;
      const grid = el("div", "dev-grid");

      // 狀態
      const st = el("div", "dev-block");
      st.append(el("h3", null, "目前狀態"));
      const need = eng.endingsNeeded;
      const info = [
        `下一輪的階段：${eng.currentPhase()}`,
        `目前這一輪：${eng.state ? eng.state.phase : "（沒有在玩）"}`,
        `已完成輪數：${m.loops}`,
        `花瓣：${m.endings.length} ／ ${need}`,
        `已拿到的結局：${m.endings.join("、") || "無"}`,
        `絕望輪已完成：${m.despairDone ? "是" : "否"}`,
        `完美結局：${m.perfect ? "已達成" : "未達成"}`,
        `變灰的選項：${m.greyed.length} 個`,
      ];
      st.append(el("div", "dev-vars", info.join("\n")));
      grid.append(st);

      // 結局
      const eb = el("div", "dev-block");
      eb.append(el("h3", null, "已拿到的結局（花瓣）"));
      const ew = el("div", "dev-endings");
      const ids = this.script.endingIds.filter((x) => x !== "絕望" && x !== "完美");
      ids.forEach((id) => {
        const lab = el("label");
        const cb = el("input"); cb.type = "checkbox"; cb.checked = m.endings.includes(id);
        cb.addEventListener("change", () => {
          if (cb.checked && !m.endings.includes(id)) m.endings.push(id);
          if (!cb.checked) m.endings = m.endings.filter((x) => x !== id);
          Store.save("dev"); this.renderDev();
        });
        lab.append(cb, document.createTextNode("結局 " + id));
        ew.append(lab);
      });
      eb.append(ew);
      grid.append(eb);

      // 階段
      const pb = el("div", "dev-block");
      pb.append(el("h3", null, "直接設定階段"));
      const pr = el("div", "row-btns");
      const setPhase = (p) => {
        if (p === "一般") { m.endings = []; m.despairDone = false; m.perfect = false; }
        if (p === "絕望") { m.endings = [...ids]; m.despairDone = false; m.perfect = false; }
        if (p === "希望") { m.endings = [...ids]; m.despairDone = true; m.perfect = false; }
        if (p === "通關") { m.endings = [...ids]; m.despairDone = true; m.perfect = true; }
        m.lastPetalAt = 0;
        Store.deleteSlot("auto");
        Store.save("dev");
        UI.toast("下一輪：" + eng.currentPhase());
        this.renderDev();
      };
      [["一般", "一般輪（清空花瓣）"], ["絕望", "下一輪絕望輪"], ["希望", "下一輪希望輪"], ["通關", "已完美通關"]].forEach(([p, t]) => {
        const b = el("button", "btn small", t); b.addEventListener("click", () => setPhase(p)); pr.append(b);
      });
      pb.append(pr);
      const g2 = el("button", "btn small", "清除所有變灰的選項");
      g2.addEventListener("click", () => { m.greyed = []; Store.save("dev"); this.renderDev(); });
      pb.append(g2);
      grid.append(pb);

      // 結局預覽
      const vb0 = el("div", "dev-block");
      vb0.append(el("h3", null, "結局預覽"));
      vb0.append(el("p", "note", "直接播放結局或第二次機會。預覽不會增加花瓣和輪迴次數，也不會覆蓋自動存檔；播完會回到標題。"));
      const PREVIEWS = [
        ["結局1", "No.01 「我無法逃離，對不起。」", 24, {}],
        ["結局2", "No.02 「我好像不存在，對不起。」", 21, { 謊言: 3, 謊_班上: 1 }],
        ["結局3", "No.03 「我造成妳的壓力了，對不起。」", 22, { 距離: 10 }],
        ["結局4", "No.04 「我喘不過氣了，對不起。」", 12, {}],
        ["結局5", "No.05 「我只剩下妳而已了，對不起。」", 28, {}],
        ["結局6", "No.06 「我不是妳，對不起。」", 26, { 幸運筆: 1 }],
        ["結局7", "No.07 「我沒關係了，對不起。」", 22, {}],
        ["結局離開", "No.08 「我不該接近妳的，對不起。」", 20, {}],
        ["結局9", "No.09 「我們是朋友，對不起。」", 30, {}],
        ["結局8", "No.10 「我們是愛人，對不起。」", 30, {}],
        ["機會_結局3", "第二次機會：結局 3（第一次）", 22, { 距離: 10 }],
        ["機會_結局3", "第二次機會：結局 3（隔天）", 23, { 距離: 12, 錯過3: 1 }],
        ["機會_結局2", "第二次機會：結局 2", 21, { 謊言: 3, 謊_班上: 1 }],
        ["機會_結局4", "第二次機會：結局 4", 12, {}],
        ["機會_結局5", "第二次機會：結局 5", 28, {}],
        ["預兆_結局5", "預兆：結局 5", 25, {}],
        ["機會_結局7", "第二次機會：結局 7", 22, {}],
        ["預兆_結局4", "預兆：結局 4", 11, {}],
        ["預兆_結局3", "預兆：結局 3", 17, {}],
        ["預兆_結局7", "預兆：結局 7", 17, {}],
        ["預兆_結局1_通報", "預兆：結局 1（聯絡家長）", 19, { 告訴大人: 1 }],
        ["預兆_結局6", "預兆：結局 6", 23, {}],
        ["預兆_結局1", "預兆：結局 1（平日）", 22, {}],
        ["預兆_結局1", "預兆：結局 1（假日）", 21, {}],
        ["預兆_謊言", "預兆：謊言被發現", 19, { 謊言: 3, 謊_班上: 1, 謊_臉色: 1, 謊_數學: 1 }],
        ["絕望_第30天", "絕望輪的結尾", 30, {}],
        ["希望_第30天", "希望輪：第 30 天", 30, {}],
        ["希望_回憶", "希望輪：回憶 → 完美結局", 30, {}],
      ];
      const pv = el("div", "dev-preview");
      PREVIEWS.forEach(([label, name, day, vars]) => {
        if (eng.labels[label] === undefined) return;
        const b = el("button", "btn small", name);
        b.addEventListener("click", () => {
          this.closeAll();
          this.showBase(null); Title.stop(); UI.setPlaying(true);
          eng.previewEnding(label, day, vars);
        });
        pv.append(b);
      });
      vb0.append(pv);
      grid.append(vb0);

      // 跳轉
      const jb = el("div", "dev-block");
      jb.append(el("h3", null, "跳到標籤"));
      const sel = el("select", "dev-select"); sel.id = "dev-label";
      Object.keys(eng.labels).forEach((l) => { const o = el("option", null, l); o.value = l; sel.append(o); });
      const jr = el("div", "row-btns");
      const jbtn = el("button", "btn small primary", "跳過去");
      jbtn.addEventListener("click", () => {
        this.closeAll();
        if (!UI.playing) {
          this.showBase(null); Title.stop(); UI.setPlaying(true);
          if (!eng.state) eng.state = eng.freshState(eng.currentPhase());
          eng.state = eng.freshState(eng.currentPhase());
        }
        eng.jumpTo(sel.value);
      });
      jr.append(sel, jbtn);
      jb.append(jr);
      jb.append(el("p", "note", "從標題畫面跳轉時，會用「下一輪的階段」開始。"));
      grid.append(jb);

      // 變數
      if (eng.state) {
        const vb = el("div", "dev-block");
        vb.style.gridColumn = "1 / -1";
        vb.append(el("h3", null, "目前的變數"));
        const vars = Object.entries(eng.state.vars).filter(([k]) => !eng.isEmotion(k)).map(([k, v]) => `${k} = ${v}`).join("\n") || "（沒有其他變數）";
        vb.append(el("div", "dev-vars scroll", `第 ${eng.state.day} 天　階段：${eng.state.phase}\n` + vars));
        grid.append(vb);
      }

      // 感情值
      const E = this.cfg.感情值 || {};
      if (E.項目) {
        const kb = el("div", "dev-block");
        kb.append(el("h3", null, "感情值（只有開發模式看得到）"));
        if (!eng.state) kb.append(el("p", "note", "開始遊戲後才會有數值。"));
        else {
          const g = el("div", "emo-bars");
          for (const name of Object.keys(E.項目)) {
            const id = "dev-emo-" + name;
            const lab = el("label", null, name); lab.htmlFor = id;
            const r = el("input"); r.type = "range"; r.id = id; r.min = E.最小 ?? 0; r.max = E.最大 ?? 100; r.step = 1;
            r.value = eng.state.vars[name] ?? 0;
            const v = el("span", "val", String(r.value));
            const upd = () => { r.style.setProperty("--p", ((r.value - r.min) / (r.max - r.min) * 100) + "%"); v.textContent = r.value; };
            upd();
            r.addEventListener("input", () => { eng.state.vars[name] = Number(r.value); upd(); });
            g.append(lab, r, v);
          }
          kb.append(g);
        }
        grid.insertBefore(kb, grid.children[1] || null);

        const tb = el("div", "dev-block");
        tb.append(el("h3", null, "事件觸發條件"));
        const fired = (eng.state && eng.state.fired) || [];
        const lines = (this.script.triggers || []).map((t) => {
          const range = (t.from ? `第${t.from}天起` : "") + (t.to ? `${t.from ? "，" : ""}第${t.to}天前` : "");
          const done = fired.includes(t.id) ? "✓ " : "　";
          const now = eng.state ? (eng.evalCond(t.cond) ? "（現在符合）" : "") : "";
          return `${done}${t.cond} → ${t.target}${range ? "　" + range : ""}${t.phase ? "　只在" + t.phase + "輪" : ""}${now}`;
        });
        tb.append(el("div", "dev-vars scroll", lines.join("\n") || "（劇本裡沒有「事件：」區塊）"));
        grid.append(tb);
      }

      // 劇本錯誤
      const errs = this.script.errors;
      const xb = el("div", "dev-block");
      xb.style.gridColumn = "1 / -1";
      xb.append(el("h3", null, errs.length ? `劇本問題（${errs.length}）` : "劇本檢查"));
      xb.append(el("div", "dev-vars scroll", errs.length ? errs.map((e) => `${e.file} 第 ${e.line} 行：${e.msg}`).join("\n") : `沒有發現問題。共 ${this.script.cmds.length} 行指令、${Object.keys(eng.labels).length} 個標籤、結局：${this.script.endingIds.join("、")}`));
      grid.append(xb);

      body.append(grid);
    },
  };

  window.Screens = Screens;
})();
