/* =========================================================
   遊戲核心：執行劇本、管理輪迴
   階段：
     一般 → 集滿所有結局 → 絕望 → 希望（選錯重來，錯誤選項變灰）→ 完美結局
   ========================================================= */
(function () {
  "use strict";

  const SPECIAL_ENDINGS = new Set(["絕望", "完美"]);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  class Engine {
    constructor(script, config, ui, audio) {
      this.script = script;
      this.cmds = script.cmds;
      this.labels = script.labels;
      this.config = config;
      this.ui = ui;
      this.audio = audio;
      this.state = null;
      this.runId = 0;
      this.running = false;
      this.lastLine = "";
      this.onExit = null; // 回到標題時呼叫
    }

    // ---------------- 輪迴階段 ----------------
    get endingsNeeded() {
      const n = Number(this.config.需要結局數) || 0;
      if (n > 0) return n;
      return Math.max(1, this.script.endingIds.filter((id) => !SPECIAL_ENDINGS.has(id)).length);
    }

    currentPhase() {
      const m = Store.meta;
      if (m.perfect) return "一般";
      if (m.despairDone) return "希望";
      if ((m.endings || []).length >= this.endingsNeeded) return "絕望";
      return "一般";
    }

    // 標題畫面用的狀態
    titleState() {
      const m = Store.meta;
      const need = this.endingsNeeded;
      let mood = "spring";
      if (m.perfect) mood = "leaves";
      else if (m.despairDone) mood = "night";
      else if (m.endings.length >= need) mood = "bare";
      return { mood, petals: m.endings.length, need, lastPetalAt: m.lastPetalAt || 0 };
    }

    // ---------------- 變數與條件 ----------------
    getVar(name) {
      name = String(name).trim();
      const m = Store.meta;
      const st = this.state || {};
      switch (name) {
        case "階段": return st.phase || this.currentPhase();
        case "已改寫": return Store.meta.perfect ? 1 : 0;   // 走過完美結局（希望線改寫了一切）之後
        case "輪迴": return (m.loops || 0) + 1;
        case "花瓣": return (m.endings || []).length;
        case "天": return st.day || 0;
        case "時段": return st.seg || 1;   // 1 = 早上，2 = 午休，3 = 放學
        case "星期": return st.day ? ((st.day - 1) % 7) + 1 : 0;   // 第 1 天是星期一，6 = 星期六，7 = 星期日
        case "假日": return st.day && ((st.day - 1) % 7) + 1 >= 6 ? 1 : 0;
        case "名字": return m.playerName || "";
        case "已通關": return m.perfect ? 1 : 0;
      }
      const em = name.match(/^結局\s*(.+)$/);
      if (em) return (m.endings || []).includes(em[1]) ? 1 : 0;
      const v = (st.vars || {})[name];
      return v === undefined ? 0 : v;
    }

    evalCond(expr) {
      const ors = String(expr).split(/\s+或\s+|\s*\|\|\s*/);
      return ors.some((part) => part.split(/\s+且\s+|\s*&&\s*/).every((t) => this.evalTerm(t)));
    }

    evalTerm(t) {
      t = t.trim();
      let neg = false;
      if (/^(不|!|！)\s*/.test(t)) { neg = true; t = t.replace(/^(不|!|！)\s*/, ""); }
      const m = t.match(/^(.+?)\s*(>=|<=|==|!=|≥|≤|≠|=|>|<)\s*(.+)$/);
      let r;
      if (!m) {
        const v = this.getVar(t);
        r = !!v && v !== "0";
      } else {
        const a = this.getVar(m[1]);
        let b = m[3].trim();
        // 右邊寫成 {變數} 時，讀出變數的值來比較
        if (b.includes("{")) b = this.interpolate(b);
        b = String(b).replace(/^["「『]|["」』]$/g, "");
        // 右邊可以寫簡單的加減，例如 {信任}+10
        const am = b.match(/^\s*(-?\d+(?:\.\d+)?)\s*([+\-])\s*(\d+(?:\.\d+)?)\s*$/);
        if (am) b = String(am[2] === "+" ? Number(am[1]) + Number(am[3]) : Number(am[1]) - Number(am[3]));
        const bn = Number(b);
        const an = Number(a);
        const numeric = b !== "" && !isNaN(bn) && !isNaN(an) && a !== "";
        const A = numeric ? an : String(a), B = numeric ? bn : b;
        switch (m[2]) {
          case ">=": case "≥": r = A >= B; break;
          case "<=": case "≤": r = A <= B; break;
          case ">": r = A > B; break;
          case "<": r = A < B; break;
          case "!=": case "≠": r = A !== B; break;
          default: r = A === B;
        }
      }
      return neg ? !r : r;
    }

    // ---------------- 感情值 ----------------
    get emo() { return (this.config.感情值 || {}); }
    // 選項旁邊要顯示的感情變化（不會真的改變數值）：只算看得到的感情值，壓力等隱藏數值不顯示
    previewEffects(opt) {
      const items = this.emo.項目 || {};
      const cap = opt.big ? Infinity : (this.emo.單次上限 || Infinity);
      const sum = {};
      for (const e of opt.effects || []) {
        const def = items[e.name];
        if (!def || def.不顯示 || (e.op !== "+" && e.op !== "-")) continue;
        let d = Number(e.value) * (e.op === "-" ? -1 : 1);
        if (isNaN(d)) continue;
        d = Math.max(-cap, Math.min(cap, d));
        sum[e.name] = (sum[e.name] || 0) + d;
      }
      return Object.keys(items).filter((k) => sum[k]).map((k) => ({ name: k, delta: sum[k], color: items[k].顏色 }));
    }

    isEmotion(name) { return !!(this.emo.項目 || {})[name]; }

    initialVars() {
      const v = {};
      for (const [k, def] of Object.entries(this.emo.項目 || {})) v[k] = Number(def.初始) || 0;
      return v;
    }

    // 回傳實際的變化量（感情值才有，給提示用）
    applySet(s, big) {
      const vars = this.state.vars;
      const cur = vars[s.name] === undefined ? 0 : vars[s.name];
      if (this.isEmotion(s.name)) {
        const lo = this.emo.最小 ?? 0, hi = this.emo.最大 ?? 100, cap = big ? Infinity : (this.emo.單次上限 || Infinity);
        let next;
        if (s.op === "=") next = Number(s.value);
        else {
          let d = Number(s.value) * (s.op === "-" ? -1 : 1);
          d = Math.max(-cap, Math.min(cap, d));
          next = Number(cur) + d;
        }
        if (isNaN(next)) return null;
        next = Math.max(lo, Math.min(hi, next));
        vars[s.name] = next;
        const delta = next - Number(cur);
        return delta ? { name: s.name, delta } : null;
      }
      let value = s.value;
      if (typeof value === "string" && value.includes("{")) {
        value = this.interpolate(value);
        if (value !== "" && !isNaN(Number(value))) value = Number(value);
      }
      if (s.op === "=") vars[s.name] = value;
      else if (s.op === "+") vars[s.name] = Number(cur) + Number(value);
      else if (s.op === "-") vars[s.name] = Number(cur) - Number(value);
      const lim = (this.config.隱藏數值 || {})[s.name];
      if (lim && typeof vars[s.name] === "number") {
        if (lim.最小 !== undefined) vars[s.name] = Math.max(lim.最小, vars[s.name]);
        if (lim.最大 !== undefined) vars[s.name] = Math.min(lim.最大, vars[s.name]);
      }
      return null;
    }

    applyEffects(list, big) {
      const changes = [];
      for (const e of list) {
        const c = this.applySet(e, big);
        if (c) {
          const prev = changes.find((x) => x.name === c.name);
          if (prev) prev.delta += c.delta; else changes.push(c);
        }
      }
      const shown = changes.filter((c) => c.delta);
      if (shown.length && this.ui.emotionHint) this.ui.emotionHint(shown, big);
      if (this.ui.updateStats) this.ui.updateStats(this.state.vars);
      return shown;
    }

    innerVoiceOn() {
      const m = Store.meta;
      return !!m.perfect && (m.settings || {}).innerVoice !== false;
    }

    // ---------------- 事件（感情值達到條件時觸發） ----------------
    checkTriggers() {
      const st = this.state;
      st.fired = st.fired || [];
      st.calls = st.calls || [];
      // [設定 暫停事件 = N]：第 N 天不觸發任何事件（例如櫻請假的那天）
      if (Number(this.getVar("暫停事件")) === st.day) return false;
      for (const t of this.script.triggers || []) {
        if (!t.repeat && st.fired.includes(t.id)) continue;
        if (t.from && st.day < t.from) continue;
        if (t.to && st.day > t.to) continue;
        if (t.phase && t.phase !== st.phase) continue;
        if (t.notPhase && t.notPhase === st.phase) continue;
        if (!this.evalCond(t.cond)) continue;
        if (!st.fired.includes(t.id)) st.fired.push(t.id);
        // 記住觸發前的畫面，[返回] 時還原
        st.calls.push({ pc: st.pc + 1, bg: st.bg, chars: clone(st.chars), petals: st.petals, rain: st.rain || 0, memory: !!st.memory, bgm: st.bgm || null });
        st.pc = this.labels[t.target];
        st.moved = true;
        return true;
      }
      return false;
    }

    interpolate(text) {
      return String(text)
        .replace(/\\n/g, "\n")
        .replace(/\{([^{}]+)\}/g, (_, k) => {
          const v = this.getVar(k);
          return v === undefined ? "" : String(v);
        });
    }

    // ---------------- 開始／讀取 ----------------
    freshState(phase) {
      return {
        pc: 0, vars: this.initialVars(), bg: null, chars: {}, petals: 0, bgm: null, box: true,
        day: 0, phase, dayMarks: {}, choices: [], fired: [], calls: [], startedAt: Date.now(),
      };
    }

    async newGame() {
      this.stop();
      const phase = this.currentPhase();
      this.state = this.freshState(phase);
      this.ui.resetScene();
      this.ui.backlog.length = 0;
      if (phase === "希望") {
        await this.hopeIntro();
        // 主角說完「我要用對櫻的思念改變一切。」之後：生存可能 0% → 5%
        this.state.survival = 5;
        this.ui.updateSurvival(phase);
        if (this.ui.survivalCount) this.ui.survivalCount(0, 5);
      }
      this.run();
    }

    // 希望輪的每一次嘗試開始前：純黑兩秒，然後是開場字幕（最後一句是主角在黑幕中說的話）
    async hopeIntro() {
      const intro = this.config.希望輪開場字幕;
      if (!Array.isArray(intro) || !intro.length) return;
      this.audio.bgm(null);
      await this.ui.captions(intro, { blackFirst: 2000 });
    }

    async loadState(st) {
      this.stop();
      this.state = clone(st);
      // 舊版存檔（還沒有「生存可能」的數值）：依照走到的天數補上
      if (this.state.phase === "希望" && typeof this.state.survival !== "number") {
        const d = this.state.day || 1;
        this.state.survival = d >= 28 ? 70 : d >= 26 ? 60 : d >= 22 ? 50 : d >= 18 ? 40 : d >= 15 ? 30 : d >= 12 ? 20 : d >= 8 ? 15 : d >= 1 ? 10 : 5;
      }
      // 希望輪選錯、回到標題之後，再試一次：先演出開場字幕
      const retry = this.state.hopeRetry;
      delete this.state.hopeRetry;
      this.state.fired = this.state.fired || [];
      this.state.calls = this.state.calls || [];
      for (const [k, v] of Object.entries(this.initialVars())) if (this.state.vars[k] === undefined) this.state.vars[k] = v;
      // 劇本修改過時，盡量回到原本的位置
      if (this.state.pc >= this.cmds.length) this.state.pc = 0;
      this.ui.backlog.length = 0;
      if (retry) {
        this.ui.resetScene();
        await this.hopeIntro();
        if (!this.state.survival) this.state.survival = 5;
      }
      this.ui.restoreScene(this.state);
      this.audio.bgm(this.state.bgm);
      this.run();
    }

    stop() {
      this.runId++;
      this.running = false;
      this.ui.cancelAll();
    }

    exitToTitle(opts) {
      this.stop();
      this.audio.bgm(null);
      if (this.onExit) this.onExit(opts || {});
    }

    snapshot() {
      const s = clone(this.state);
      s.dayMarks = {};
      return s;
    }

    makeSlot() {
      return {
        time: Date.now(),
        state: clone(this.state),
        day: this.state.day,
        bg: this.state.bg,
        text: this.lastLine,
      };
    }

    autosave() { if (this.state && this.state.preview) return; Store.setSlot("auto", this.makeSlot()); }

    // 開發者工具：預覽結局（不會記錄花瓣、輪迴次數，也不會覆蓋自動存檔）
    previewEnding(label, day, vars) {
      if (this.labels[label] === undefined) return false;
      this.stop();
      const st = this.freshState(/^(希望|完美)/.test(label) ? "希望" : /^絕望/.test(label) ? "絕望" : "一般");
      st.preview = true;
      st.day = day || 1;
      st.seg = 2;
      Object.assign(st.vars, vars || {});
      // 第二次機會「拉回來」之後的 [返回]，會回到這裡結束預覽
      st.calls.push({ pc: -1, bg: null, chars: {}, petals: 0, rain: 0, memory: false, preview: true });
      st.pc = this.labels[label];
      st.moved = true;
      this.state = st;
      this.ui.resetScene();
      this.ui.backlog.length = 0;
      this.run();
      return true;
    }

    // ---------------- 主迴圈 ----------------
    async run() {
      if (this.ui.updateStats && this.state) this.ui.updateStats(this.state.vars);
      if (this.ui.updateSurvival && this.state) this.ui.updateSurvival(this.state.phase);
      const id = ++this.runId;
      this.running = true;
      try {
        while (id === this.runId) {
          const st = this.state;
          if (st.pc >= this.cmds.length) {
            this.ui.toast("劇本已經結束（最後沒有寫 [結局]）");
            this.exitToTitle();
            return;
          }
          // 執行時 pc 停在目前這一行，存檔才會回到正在顯示的台詞或選項
          const at = st.pc;
          const c = this.cmds[at];
          st.moved = false;
          await this.exec(c, id);
          if (this.state === st && !st.moved) st.pc = at + 1;
        }
      } catch (e) {
        if (e && e.cancelled) return;
        console.error(e);
        this.ui.showError("劇本執行時發生錯誤：" + (e && e.message ? e.message : e));
      }
    }

    async exec(c, id) {
      const st = this.state;
      // 只在特定階段出現的行
      if (c.onlyPhase) {
        if (c.onlyPhase === "非希望" ? st.phase === "希望" : c.onlyPhase !== st.phase) return;
      }
      if (c.onlyIf && !this.evalCond(c.onlyIf)) return;
      // 櫻的心聲不會直接播放，而是掛在前一句台詞上，點名字旁的愛心才看得到
      if (c.inner) return;
      const ui = this.ui;
      const alive = () => { if (id !== this.runId) throw { cancelled: true }; };

      switch (c.t) {
        case "label": return;

        case "say":
        case "narr": {
          let who = null, name = null, color = null;
          let text = this.interpolate(c.text);
          if (c.t === "say") {
            who = c.who;
            if (who === "我" || who === "{名字}" || who === "主角") {
              name = Store.meta.playerName || "我";
              color = this.config.玩家名字顏色;
            } else {
              name = this.interpolate(who);
              color = ((this.config.角色 || {})[who] || {}).顏色;
            }
            if (this.config.自動加引號 && !/^[「『（(〈《]/.test(text)) text = "「" + text + "」";
          }
          this.lastLine = (name ? "【" + name + "】" : "") + text;
          let inner = null;
          if (c.innerLines && this.innerVoiceOn()) {
            inner = c.innerLines.filter((l) => {
              if (l.onlyPhase && (l.onlyPhase === "非希望" ? st.phase === "希望" : l.onlyPhase !== st.phase)) return false;
              return !l.onlyIf || this.evalCond(l.onlyIf);
            }).map((l) => {
              const isMe = l.who === "我" || l.who === "主角" || l.who === "{名字}";
              const nm = l.t === "say" ? (isMe ? (Store.meta.playerName || "我") : this.interpolate(l.who)) : null;
              const col = l.t === "say" ? (isMe ? this.config.玩家名字顏色 : ((this.config.角色 || {})[l.who] || {}).顏色) : null;
              return { name: nm, color: col, text: this.interpolate(l.text) };
            });
          }
          await ui.say({ who, name, color, text, key: c.key, read: Store.isRead(c.key), inner, big: !!c.big });
          alive();
          Store.markRead(c.key);
          return;
        }

        case "bg":
          st.bg = c.name;
          await ui.setBg(c.name, c.fade);
          alive();
          return;

        case "day": {
          st.day = c.n;
          st.seg = 1;
          // 每一天開始時，回到日常的音樂（劇本可以在 [日 N] 之後用 [音樂 名稱] 換掉）
          if (this.config.每日音樂 && st.bgm !== this.config.每日音樂) { st.bgm = this.config.每日音樂; this.audio.bgm(st.bgm); }
          const snap = this.snapshot();
          st.dayMarks[c.n] = snap;
          this.autosave();
          await ui.dayCard(c.n, this.bloomText(c.n));
          alive();
          this.checkTriggers();
          return;
        }

        case "show": {
          const prev = st.chars[c.who] || {};
          const ch = this.config.角色[c.who];
          const expr = c.expr || prev.expr || ch.預設表情 || Object.keys(ch.立繪)[0];
          const pos = c.pos || prev.pos || "center";
          st.chars[c.who] = { expr, pos };
          ui.showChar(c.who, expr, pos);
          return;
        }

        case "hide":
          if (c.who === "*") { st.chars = {}; ui.hideChar("*"); }
          else { delete st.chars[c.who]; ui.hideChar(c.who); }
          return;

        case "fx":
          if (c.name === "淡出" || c.name === "黑幕") st.veil = true;
          if (c.name === "淡入" || c.name === "黑幕結束") st.veil = false;
          if (c.name === "回憶") st.memory = true;
          if (c.name === "回憶結束") st.memory = false;
          await ui.fx(c.name, c.args);
          alive();
          return;

        case "petals":
          st.petals = c.level;
          ui.setPetals(c.level);
          return;

        case "rain":
          st.rain = c.level;
          ui.setRain(c.level);
          return;

        case "wait":
          await ui.wait(c.sec);
          alive();
          return;

        case "set":
          this.applyEffects([c.set]);
          return;

        case "return": {
          if (!st.calls || !st.calls.length) return;
          const r = st.calls.pop();
          // 回到原本的劇情時，音樂也回到觸發前的樣子（例如第二次機會被接住之後）
          if (r && typeof r === "object" && "bgm" in r && r.bgm !== st.bgm) { st.bgm = r.bgm; this.audio.bgm(st.bgm); }
          if (st.preview && (r.preview || st.calls.length === 0)) {
            this.ui.toast("預覽結束：她被拉回來了，故事會繼續");
            await this.ui.wait(1.2); alive();
            return this.exitToTitle({ from: "preview" });
          }
          if (c.to) {
            const label = this.interpolate(c.to).trim();
            if (this.labels[label] !== undefined) { st.pc = this.labels[label]; st.moved = true; return; }
            ui.showError(`[返回 到] 找不到標籤「${label}」，改為回到原本的位置`);
          }
          if (typeof r === "number") { st.pc = r; st.moved = true; return; }
          st.pc = r.pc; st.moved = true;
          ui.hideChar("*");
          if (r.bg !== st.bg) { st.bg = r.bg; await ui.setBg(r.bg); alive(); }
          st.chars = r.chars || {};
          for (const [who, ch] of Object.entries(st.chars)) ui.showChar(who, ch.expr, ch.pos);
          if (r.petals !== st.petals) { st.petals = r.petals; ui.setPetals(r.petals); }
          if ((r.rain || 0) !== (st.rain || 0)) { st.rain = r.rain || 0; ui.setRain(st.rain); }
          if (!!r.memory !== !!st.memory) { st.memory = r.memory; ui.setMemory(r.memory); }
          return;
        }

        case "checkEvents":
          st.seg = Math.min((st.seg || 1) + 1, 3);
          this.checkTriggers();
          return;

        case "if":
          if (this.evalCond(c.cond)) { st.pc = this.labels[c.target]; st.moved = true; }
          return;

        case "jump":
          st.pc = this.labels[c.target];
          st.moved = true;
          return;

        case "choice":
          return this.doChoice(c, id);

        case "ending":
          return this.doEnding(c.id, id);

        case "bgm":
          st.bgm = c.name === "停" || c.name === "停止" ? null : c.name;
          this.audio.bgm(st.bgm);
          return;

        case "survival":
          // 只有希望輪會用到（改寫之後的重玩也會經過「完美結局_之後」，那時候不動）
          if (st.phase === "希望" && st.survival !== c.v) {
            const from = st.survival || 0;
            st.survival = c.v;
            if (this.ui.survivalCount) this.ui.survivalCount(from, c.v);
          }
          return;

        case "se":
          // 快轉的時候不播音效，避免一連串的鐘聲疊在一起
          if (!(ui.skipping)) this.audio.se(c.name);
          return;

        case "box":
          st.box = c.show;
          ui.setBox(c.show);
          return;

        case "title":
          this.exitToTitle();
          throw { cancelled: true };
      }
    }

    bloomText(n) {
      for (const b of this.config.花期 || []) if (n >= b.從 && n <= b.到) return b.文字;
      return "";
    }

    async doChoice(c, id) {
      const st = this.state;
      const phase = st.phase;
      const greyed = new Set(Store.meta.greyed || []);
      const visible = c.options.filter((o) =>
        (!o.phase || o.phase === phase) &&
        (!o.notPhase || o.notPhase !== phase) &&
        (!o.cond || this.evalCond(o.cond)));
      const items = visible.map((o) => ({
        text: this.interpolate(o.text),
        disabled: phase === "希望" && greyed.has(o.oid),
        // 希望輪：錯誤的選項帶一點點雜訊（櫻記得，那條路走下去會發生什麼）
        glitch: phase === "希望" && !!o.wrong,
        // 選項旁邊的感情變化：希望輪不顯示（不能讓答案變得太明顯），設定裡可以關掉
        fx: phase !== "希望" && (Store.meta.settings || {}).choiceFx === true ? this.previewEffects(o) : [],
        opt: o,
      }));
      if (items.length && items.every((i) => i.disabled)) items.forEach((i) => (i.disabled = false));
      if (!items.length) return;

      // 希望輪：每一天都會重現，可是玩家只能在關鍵時刻選擇（絕望輪的選擇全部由玩家決定）。
      // 不是關鍵的選擇，會自動選「最溫柔」的那一個，而且不算進「選錯」的紀錄。
      const isKey = (c.key && c.key.includes(phase)) || /^(絕望|希望)_/.test(c.label || "");
      if (phase === "希望" && !isKey) {
        let best = items[0], bv = -Infinity;
        for (const it of items) { const v = this.autoScore(it.opt); if (v > bv) { bv = v; best = it; } }
        this.applyEffects(best.opt.effects, best.opt.big);
        if (best.opt.target) { st.pc = this.labels[best.opt.target]; st.moved = true; }
        return;
      }

      // 停在選項前的自動存檔
      this.autosave();

      const idx = await this.ui.choose(items);
      if (id !== this.runId) throw { cancelled: true };
      const o = items[idx].opt;
      this.ui.backlog.push({ name: null, text: "→ " + items[idx].text, choice: true });
      this.applyEffects(o.effects, o.big);
      st.choices.push({ oid: o.oid, day: st.day, wrong: !!o.wrong });
      if (o.target) { st.pc = this.labels[o.target]; st.moved = true; }
    }

    // 自動選擇的分數：讓她安心、信任、喜歡的選項優先；拉開距離、說謊、追問、增加壓力的選項最後
    autoScore(o) {
      let v = 0;
      const w = { 信任: 1, 安全感: 1, 喜愛: 1, 依賴: 0.5, 崇拜: -0.3, 焦慮: -1, 壓力: -1, 距離: -3, 謊言: -5, 追問: -3, 告訴大人: -10 };
      for (const e of o.effects || []) {
        if (!(e.name in w)) continue;
        const n = e.op === "-" ? -Number(e.value) : e.op === "+" ? Number(e.value) : (e.op === "=" && Number(e.value) ? 1 : 0);
        v += w[e.name] * n;
      }
      return v;
    }

    // 每一次櫻死亡之後的重要聲明
    async deathNotice() {
      const t = this.config.死亡後聲明;
      if (t && this.ui.captions) await this.ui.captions([t], { notice: true });
    }

    async doEnding(endId, id) {
      const st = this.state;
      const m = Store.meta;
      const phase = st.phase;
      if (st.preview) {
        await this.ui.endingSequence(endId === "完美" ? "perfect" : endId === "絕望" ? "despair" : "death", { isNew: false });
        return this.exitToTitle({ from: "preview" });
      }
      m.loops = (m.loops || 0) + 1;
      (m.endingLog = m.endingLog || []).push({ id: endId, phase, loop: m.loops, at: Date.now() });

      if (endId === "完美") {
        const first = !m.perfect;
        m.perfect = true;
        m.innerUnlockedNotice = first;
        Store.deleteSlot("auto");
        Store.save("ending");
        await this.ui.endingSequence("perfect");
        // 第一次走到完美結局時才演出「生存可能」的轉換和作者的字幕；改寫之後的重玩就不再重複
        if (first) {
          // 櫻的生存可能是 100%；螢幕前的你，是「？」。接著就是作者寫給你的字幕
          if (this.ui.survivalReveal) await this.ui.survivalReveal(["生存可能", "100"], ["生存可能", "？"]);
          const pc = this.config.完美結局字幕;
          if (Array.isArray(pc)) await this.ui.captions(pc, { style: "perfect" });
          if (this.ui.credits) await this.ui.credits(this.config.工作人員名單);
          // 謝幕之後：命運和主角的最後一段對話（溫暖的背景）
          const after = this.config.謝幕後對話;
          if (Array.isArray(after) && after.length) await this.ui.captions(after, { style: "warm" });
        }
        return this.exitToTitle({ from: "perfect", first });
      }

      // 絕望輪：只有走到結局 8（理想的道別）→「又一次？」（[結局 絕望]），才會進入希望輪。
      // 其他結局照一般的死亡演出，回到標題之後，會再來一次絕望輪。
      if (phase === "絕望" && endId === "絕望") {
        m.despairDone = true;
        Store.deleteSlot("auto");
        Store.save("ending");
        await this.ui.endingSequence("despair");
        await this.deathNotice();
        const cap = this.config.進入希望輪字幕;
        await this.ui.captions(Array.isArray(cap) ? cap : cap && cap.文字 ? [cap] : []);
        return this.exitToTitle({ from: "despair" });
      }

      if (phase === "希望") {
        // 找出要變灰的選項：最近一個標了 [錯] 的選擇，沒有的話就是最後一個選擇
        const chosen = st.choices || [];
        let target = null;
        for (let i = chosen.length - 1; i >= 0; i--) if (chosen[i].wrong) { target = chosen[i]; break; }
        if (!target) target = chosen[chosen.length - 1] || null;
        if (target && !m.greyed.includes(target.oid)) m.greyed.push(target.oid);
        Store.save("ending");
        await this.ui.endingSequence("hopeDeath");
        await this.deathNotice();
        if (id !== this.runId) throw { cancelled: true };

        const fromDay = this.config.希望輪重來 !== "開頭" && target ? target.day : 0;
        const snap = fromDay ? st.dayMarks[fromDay] : null;
        if (snap) {
          const marks = {};
          for (const k in st.dayMarks) if (Number(k) <= fromDay) marks[k] = st.dayMarks[k];
          const ns = clone(snap);
          ns.dayMarks = marks;
          ns.phase = "希望";
          this.state = ns;
        } else {
          this.state = this.freshState("希望");
        }
        // 回到標題；按「繼續」再試一次時，會先演出希望輪的開場字幕，然後從那一天重新開始（選錯的選項已經變暗）
        this.state.hopeRetry = true;
        this.autosave();
        return this.exitToTitle({ from: "hopeDeath" });
      }

      // 一般輪
      const isNew = !SPECIAL_ENDINGS.has(endId) && !m.endings.includes(endId);
      if (isNew) { m.endings.push(endId); m.lastPetalAt = Date.now(); }
      Store.deleteSlot("auto");
      Store.save("ending");
      await this.ui.endingSequence("death", { isNew });
      await this.deathNotice();
      // 集滿最後一個結局、下一輪就要進入絕望輪的時候
      if (isNew && phase === "一般" && m.endings.length >= this.endingsNeeded) {
        if (this.ui.survivalReveal) await this.ui.survivalReveal(["？？？？", "0"], ["生存可能", "0"]);
        await this.ui.captions(this.config.進入絕望輪字幕 || []);
      }
      return this.exitToTitle({ from: "death", newPetal: isNew });
    }

    // 開發者工具用
    jumpTo(label) {
      if (this.labels[label] === undefined) return false;
      if (!this.state) this.state = this.freshState(this.currentPhase());
      this.stop();
      this.state.pc = this.labels[label];
      this.state.moved = true;
      this.ui.restoreScene(this.state);
      this.run();
      return true;
    }
  }

  window.Engine = Engine;
})();
