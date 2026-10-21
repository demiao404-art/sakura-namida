/* =========================================================
   劇本解析器：把純文字劇本轉成遊戲指令
   劇本寫法請看 docs/劇本寫法.md
   ========================================================= */
(function () {
  "use strict";

  const sources = [];

  // 劇本檔案呼叫這個函式來登記內容
  window.劇本 = function (檔名, 內容) {
    if (typeof 內容 !== "string") { 內容 = 檔名; 檔名 = "劇本" + (sources.length + 1); }
    sources.push({ file: 檔名, text: 內容 });
  };

  const WS = /[\s　]+/;
  const POSITIONS = { "左": "left", "中": "center", "右": "right", "左中": "midleft", "右中": "midright" };

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }

  function parseSet(expr) {
    const m = expr.trim().match(/^(.+?)\s*(\+=|-=|\+|-|=)\s*(.+)$/);
    if (!m) return null;
    let op = m[2]; if (op === "+=") op = "+"; if (op === "-=") op = "-";
    const raw = m[3].trim();
    const num = Number(raw);
    return { name: m[1].trim(), op, value: raw !== "" && !isNaN(num) ? num : raw };
  }

  function parseAll(config) {
    const cmds = [];
    const labels = {};
    const errors = [];
    const endingIds = new Set();
    const triggers = [];
    const charNames = new Set(Object.keys(config.角色 || {}));

    for (const src of sources) {
      const lines = src.text.replace(/\r\n?/g, "\n").split("\n");
      const seen = {};
      let lastLabel = src.file;
      let choice = null;
      let trig = null;      // 事件： 區塊

      const err = (ln, msg) => errors.push({ file: src.file, line: ln, msg });
      const keyFor = (txt) => {
        const base = src.file + ":" + hash(txt);
        seen[base] = (seen[base] || 0) + 1;
        return base + ":" + seen[base];
      };

      for (let i = 0; i < lines.length; i++) {
        const ln = i + 1;
        const raw = lines[i];
        const line = raw.trim();
        const at = { file: src.file, line: ln };

        // 事件區塊
        if (trig) {
          if (line.startsWith("//")) continue;
          if (/^[-*・＊－]/.test(line)) {
            const t = parseTrigger(line.replace(/^[-*・＊－]\s*/, ""), err, ln);
            if (t) { t.id = src.file + ":" + ln; t.at = at; triggers.push(t); trig.count++; }
            continue;
          }
          if (trig.count === 0) err(ln, "「事件：」下面沒有任何條件（要用 - 開頭）");
          trig = null;
        }

        // 選項區塊
        if (choice) {
          if (line.startsWith("//")) continue;
          if (/^[-*・＊－]/.test(line)) {
            const opt = parseOption(line.replace(/^[-*・＊－]\s*/, ""), err, ln);
            if (opt) {
              opt.oid = lastLabel + "|" + opt.text;
              choice.options.push(opt);
            }
            continue;
          }
          if (choice.options.length === 0) err(ln, "「選擇」下面沒有任何選項（選項要用 - 開頭）");
          choice = null;
        }

        if (!line || line.startsWith("//")) continue;

        // 行首的 [希望輪] 等：這一行只在該階段出現
        let onlyPhase = null, inner = false, onlyIf = null;
        let body = line;
        for (;;) {
          // 行首的 [若 條件]：條件成立時，這一行才會出現
          const im = body.match(/^[\[［]若\s+([^\]］]+)[\]］]\s*(.+)$/);
          if (im) { onlyIf = onlyIf ? onlyIf + " 且 " + im[1].trim() : im[1].trim(); body = im[2].trim(); continue; }
          const pm = body.match(/^[\[［](一般輪|絕望輪|希望輪|非希望輪|心聲)[\]］]\s*(.+)$/);
          if (!pm) break;
          if (pm[1] === "心聲") inner = true; else onlyPhase = pm[1].replace("輪", "");
          body = pm[2].trim();
        }
        const before = cmds.length;
        parseLine(body, ln);
        for (let k = before; k < cmds.length; k++) {
          if (onlyPhase) cmds[k].onlyPhase = onlyPhase;
          if (onlyIf) cmds[k].onlyIf = onlyIf;
          if (inner) cmds[k].inner = true;
        }
        continue;
      }
      if (choice && choice.options.length === 0) err(lines.length, "「選擇」下面沒有任何選項");

      function parseLine(line, ln) {
        const at = { file: src.file, line: ln };

        // 標籤
        if (line.startsWith("#") || line.startsWith("＃")) {
          const name = line.replace(/^[#＃]+/, "").trim();
          if (!name) { err(ln, "標籤沒有名字"); return; }
          if (labels[name] !== undefined) err(ln, `標籤「${name}」重複了`);
          labels[name] = cmds.length;
          lastLabel = name;
          cmds.push({ t: "label", name, at });
          return;
        }

        // 事件（達到條件時觸發）
        if (/^事件[：:]?$/.test(line)) {
          trig = { count: 0 };
          return;
        }

        // 選擇
        // 選擇（關鍵）：絕望輪、希望輪裡，玩家只能在「關鍵」的選擇做決定，其他的會自動選
        //   選擇（關鍵）：兩輪都是關鍵　選擇（希望輪關鍵）：只在希望輪　選擇（絕望輪關鍵）：只在絕望輪
        const cm = line.match(/^選擇(?:[（(]([^）)]*)[）)])?[：:]?$/);
        if (cm) {
          const tag = cm[1] || "";
          const key = !tag ? null : /希望/.test(tag) ? ["希望"] : /絕望/.test(tag) ? ["絕望"] : ["絕望", "希望"];
          choice = { t: "choice", options: [], at, label: lastLabel, key };
          cmds.push(choice);
          return;
        }

        // 指令 [ ... ]
        if ((line.startsWith("[") && line.endsWith("]")) || (line.startsWith("［") && line.endsWith("］"))) {
          const inner = line.slice(1, -1).trim();
          const parts = inner.split(WS);
          const w = parts[0];
          const rest = parts.slice(1);
          const restStr = inner.slice(w.length).trim();
          const c = parseCommand(w, rest, restStr, at, err, ln, charNames, config);
          if (c) {
            if (c.t === "ending") endingIds.add(c.id);
            cmds.push(c);
          }
          return;
        }

        // 強制旁白
        if (line.startsWith(">") || line.startsWith("＞")) {
          const text = line.slice(1).trim();
          cmds.push({ t: "narr", text, key: keyFor(text), at });
          return;
        }

        // 台詞：名字：內容
        const m = line.match(/^([^：:「『（(\[]{1,12}?)[：:]\s*(.+)$/);
        if (m) {
          const who = m[1].trim();
          const text = m[2].trim();
          cmds.push({ t: "say", who, text, key: keyFor(who + "|" + text), at });
          return;
        }

        // 旁白
        cmds.push({ t: "narr", text: line, key: keyFor(line), at });
      }
    }

    // [心聲] 掛到它前面最近的一句台詞或旁白上（點名字旁的愛心才會顯示）
    let lastLine = null;
    for (const c of cmds) {
      if (c.t === "label" || c.t === "choice") { if (c.t === "choice") lastLine = null; continue; }
      if ((c.t === "say" || c.t === "narr") && !c.inner) { lastLine = c; continue; }
      if (c.inner && (c.t === "say" || c.t === "narr")) {
        if (lastLine) (lastLine.innerLines = lastLine.innerLines || []).push({ t: c.t, who: c.who, text: c.text, onlyIf: c.onlyIf || null, onlyPhase: c.onlyPhase || null });
        else errors.push({ file: c.at.file, line: c.at.line, msg: "[心聲] 前面要有一句台詞或旁白，愛心才知道要掛在哪裡" });
      }
    }

    // 檢查跳轉目標
    for (const c of cmds) {
      const check = (target) => {
        if (target && labels[target] === undefined)
          errors.push({ file: c.at.file, line: c.at.line, msg: `找不到標籤「${target}」` });
      };
      if (c.t === "jump" || c.t === "if") check(c.target);
      if (c.t === "choice") c.options.forEach((o) => check(o.target));
    }
    for (const t of triggers) {
      if (labels[t.target] === undefined) errors.push({ file: t.at.file, line: t.at.line, msg: `找不到標籤「${t.target}」` });
    }

    return { cmds, labels, errors, endingIds: [...endingIds], triggers };
  }

  function parseOption(s, err, ln) {
    let mods = [];
    const mm = s.match(/[\[［]([^\]］]*)[\]］]\s*$/);
    if (mm) { mods = mm[1].split(/[,，、]/).map((x) => x.trim()).filter(Boolean); s = s.slice(0, mm.index).trim(); }
    let target = null;
    const am = s.match(/\s*(?:->|→|=>)\s*(.+)$/);
    if (am) { target = am[1].trim(); s = s.slice(0, am.index).trim(); }
    if (!s) { err(ln, "選項沒有文字"); return null; }
    const opt = { text: s, target, effects: [], cond: null, phase: null, wrong: false };
    for (const m of mods) {
      if (/^只在(一般|絕望|希望)輪?$/.test(m)) { opt.phase = m.match(/(一般|絕望|希望)/)[1]; continue; }
      if (/^不在(一般|絕望|希望)輪?$/.test(m)) { opt.notPhase = m.match(/(一般|絕望|希望)/)[1]; continue; }
      if (/^如果\s*/.test(m)) { opt.cond = m.replace(/^如果\s*/, ""); continue; }
      if (m === "錯" || m === "錯誤") { opt.wrong = true; continue; }
      if (m === "大事件") { opt.big = true; continue; }
      const st = parseSet(m);
      if (st) { opt.effects.push(st); continue; }
      err(ln, `看不懂選項的設定「${m}」`);
    }
    return opt;
  }

  function parseTrigger(s, err, ln) {
    let mods = [];
    const mm = s.match(/[\[［]([^\]］]*)[\]］]\s*$/);
    if (mm) { mods = mm[1].split(/[,，、]/).map((x) => x.trim()).filter(Boolean); s = s.slice(0, mm.index).trim(); }
    const am = s.match(/^(.+?)\s*(?:->|→|=>)\s*(.+)$/);
    if (!am) { err(ln, "事件的寫法是：- 條件 -> 標籤"); return null; }
    const t = { cond: am[1].trim(), target: am[2].trim(), from: 0, to: 0, phase: null, notPhase: null, repeat: false };
    for (const m of mods) {
      let k;
      if ((k = m.match(/^(?:從)?第\s*(\d+)\s*天(?:起|之後|以後|後)?$/)) && /起|之後|以後|後|從/.test(m)) { t.from = +k[1]; continue; }
      if ((k = m.match(/^(?:到)?第\s*(\d+)\s*天(?:前|之前|以前|為止)?$/)) && /前|為止|到/.test(m)) { t.to = +k[1]; continue; }
      if (/^只在(一般|絕望|希望)輪?$/.test(m)) { t.phase = m.match(/(一般|絕望|希望)/)[1]; continue; }
      if (/^不在(一般|絕望|希望)輪?$/.test(m)) { t.notPhase = m.match(/(一般|絕望|希望)/)[1]; continue; }
      if (m === "可重複") { t.repeat = true; continue; }
      err(ln, `看不懂事件的設定「${m}」`);
    }
    return t;
  }

  function parseCommand(w, rest, restStr, at, err, ln, charNames, config) {
    switch (w) {
      case "背景": {
        if (!rest[0]) { err(ln, "背景沒有名字"); return null; }
        if (!(config.背景 || {})[rest[0]]) err(ln, `設定檔裡沒有背景「${rest[0]}」`);
        return { t: "bg", name: rest[0], fade: rest[1] !== undefined ? Number(rest[1]) : null, at };
      }
      case "日": case "天": case "第": {
        const n = parseInt(String(rest[0] || "").replace(/[^0-9]/g, ""), 10);
        if (!n) { err(ln, "[日] 後面要寫數字，例如 [日 3]"); return null; }
        return { t: "day", n, at };
      }
      case "退場":
        return { t: "hide", who: rest[0] || "*", at };
      case "全部退場":
        return { t: "hide", who: "*", at };
      case "效果":
        if (!rest[0]) { err(ln, "效果沒有名字"); return null; }
        return { t: "fx", name: rest[0], args: rest.slice(1), at };
      case "花瓣": {
        const lv = rest[0] || "少";
        const map = { "停": 0, "關": 0, "少": 1, "中": 2, "多": 3 };
        if (map[lv] === undefined) err(ln, "[花瓣] 後面要寫 少／中／多／停");
        return { t: "petals", level: map[lv] ?? 1, at };
      }
      case "雨": case "下雨": {
        const lv = rest[0] || "中";
        const map = { "停": 0, "關": 0, "小": 1, "中": 2, "大": 3 };
        if (map[lv] === undefined) err(ln, "[雨] 後面要寫 小／中／大／停");
        return { t: "rain", level: map[lv] ?? 2, at };
      }
      case "等待": case "停頓":
        return { t: "wait", sec: Number(rest[0] || 1), at };
      case "設定": {
        const s = parseSet(restStr);
        if (!s) { err(ln, `看不懂設定「${restStr}」，例如：[設定 好感+1]`); return null; }
        return { t: "set", set: s, at };
      }
      case "如果": {
        const m = restStr.match(/^(.+?)\s+(?:跳到|跳)\s+(.+)$/);
        if (!m) { err(ln, "[如果] 的寫法是：[如果 條件 跳 標籤]"); return null; }
        return { t: "if", cond: m[1], target: m[2].trim(), at };
      }
      case "跳": case "跳到":
        if (!rest[0]) { err(ln, "[跳] 後面要寫標籤名字"); return null; }
        return { t: "jump", target: restStr, at };
      case "結局":
        if (!rest[0]) { err(ln, "[結局] 後面要寫結局編號"); return null; }
        return { t: "ending", id: rest[0], at };
      case "音樂":
        return { t: "bgm", name: rest[0] || "停", at };
      case "音效":
        return { t: "se", name: rest[0], at };
      case "生存可能": {
        // [生存可能 15]：希望輪裡，右上角的「生存可能」一點一點往上加
        const v = parseInt(rest[0], 10);
        if (isNaN(v)) err(ln, "[生存可能] 後面要接一個數字，例如 [生存可能 15]");
        return { t: "survival", v: Math.max(0, Math.min(100, v || 0)), at };
      }
      case "對話框":
        return { t: "box", show: !/隱藏|關/.test(rest[0] || ""), at };
      case "回到標題":
        return { t: "title", at };
      case "返回":
        // [返回 到 第{天}天_3]：結束事件，但不回到原本的位置，而是跳到指定的標籤
        if (rest[0] === "到" && rest[1]) return { t: "return", to: rest.slice(1).join(" "), at };
        return { t: "return", at };
      case "檢查事件":
        return { t: "checkEvents", at };
    }
    if (charNames.has(w)) {
      if (rest[0] === "退場") return { t: "hide", who: w, at };
      let expr = null, pos = null;
      for (const r of rest) {
        if (POSITIONS[r]) pos = POSITIONS[r];
        else expr = r;
      }
      const ch = config.角色[w];
      if (!ch.立繪) { err(ln, `角色「${w}」沒有立繪`); return null; }
      if (expr && !ch.立繪[expr]) err(ln, `角色「${w}」沒有「${expr}」這個表情`);
      return { t: "show", who: w, expr, pos, at };
    }
    err(ln, `看不懂的指令 [${w}]`);
    return null;
  }

  window.ScriptParser = { parseAll, parseSet, sources };
})();
