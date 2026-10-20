/* =========================================================
   存檔系統
   - meta：跨輪迴的永久進度（輪迴次數、花瓣、變灰的選項、已讀文字、設定）
   - slots：一般存檔欄（自動、快速、1～30）
   ========================================================= */
(function () {
  "use strict";

  const KEY_META = "sakura-vn.meta.v1";
  const KEY_SLOTS = "sakura-vn.slots.v1";
  const SLOT_COUNT = 30;

  const DEFAULT_SETTINGS = {
    textSpeed: 55,      // 0–100
    autoDelay: 50,      // 0–100
    bgmVolume: 70,
    seVolume: 80,
    skipMode: "read",   // read | all
    boxOpacity: 78,
    ambientPetals: true,
    innerVoice: true,   // 完美結局之後才有作用
  };

  function defaultMeta() {
    return {
      version: 1,
      warningAccepted: false,
      playerName: "",
      loops: 0,
      endings: [],          // 一般輪拿到過的結局編號
      endingLog: [],        // [{id, loop, at}]
      despairDone: false,
      perfect: false,
      greyed: [],           // 希望輪變灰的選項 id
      read: [],             // 已讀文字 key
      lastPetalAt: 0,       // 最後一次新增花瓣的時間（用於標題畫面動畫）
      resetAt: 0,           // 最後一次清除進度的時間
      settings: { ...DEFAULT_SETTINGS },
      updatedAt: 0,
    };
  }

  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }

  let meta = defaultMeta();
  let slots = {};
  let readSet = new Set();
  const listeners = [];
  let storageOk = true;

  function loadAll() {
    const m = safeGet(KEY_META);
    const s = safeGet(KEY_SLOTS);
    try { if (m) meta = Object.assign(defaultMeta(), JSON.parse(m)); } catch (e) { console.warn("meta 讀取失敗", e); }
    try { if (s) slots = JSON.parse(s) || {}; } catch (e) { console.warn("slots 讀取失敗", e); }
    meta.settings = Object.assign({ ...DEFAULT_SETTINGS }, meta.settings || {});
    readSet = new Set(meta.read || []);
    storageOk = safeSet("sakura-vn.probe", "1");
  }

  function persist(reason) {
    meta.read = [...readSet];
    meta.updatedAt = Date.now();
    const ok1 = safeSet(KEY_META, JSON.stringify(meta));
    const ok2 = safeSet(KEY_SLOTS, JSON.stringify(slots));
    storageOk = ok1 && ok2;
    listeners.forEach((fn) => { try { fn(reason); } catch (e) { console.error(e); } });
  }

  let persistTimer = null;
  function persistSoon(reason) {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => persist(reason), 400);
  }

  // ---------- 合併兩份進度（雲端同步、匯入存檔碼都用這個） ----------
  function union(a, b) { return [...new Set([...(a || []), ...(b || [])])]; }

  function mergePackages(local, remote) {
    const lm = Object.assign(defaultMeta(), local.meta || {});
    const rm = Object.assign(defaultMeta(), remote.meta || {});
    // 其中一邊清除過進度：比清除時間還舊的另一邊資料不再合併
    if ((lm.resetAt || 0) !== (rm.resetAt || 0)) {
      const lw = (lm.resetAt || 0) > (rm.resetAt || 0);
      const win = lw ? local : remote, winM = lw ? lm : rm, loseM = lw ? rm : lm;
      if ((loseM.updatedAt || 0) <= (winM.resetAt || 0)) {
        return JSON.parse(JSON.stringify({ meta: winM, slots: win.slots || {} }));
      }
    }
    const newer = (rm.updatedAt || 0) > (lm.updatedAt || 0) ? rm : lm;
    const m = {
      version: 1,
      warningAccepted: lm.warningAccepted || rm.warningAccepted,
      playerName: newer.playerName || lm.playerName || rm.playerName,
      loops: Math.max(lm.loops || 0, rm.loops || 0),
      endings: union(lm.endings, rm.endings),
      endingLog: mergeLog(lm.endingLog, rm.endingLog),
      despairDone: lm.despairDone || rm.despairDone,
      perfect: lm.perfect || rm.perfect,
      greyed: union(lm.greyed, rm.greyed),
      read: union(lm.read, rm.read),
      lastPetalAt: Math.max(lm.lastPetalAt || 0, rm.lastPetalAt || 0),
      settings: Object.assign({ ...DEFAULT_SETTINGS }, newer.settings || {}),
      resetAt: Math.max(lm.resetAt || 0, rm.resetAt || 0),
      updatedAt: Math.max(lm.updatedAt || 0, rm.updatedAt || 0),
    };
    const s = {};
    const keys = new Set([...Object.keys(local.slots || {}), ...Object.keys(remote.slots || {})]);
    for (const k of keys) {
      const a = (local.slots || {})[k], b = (remote.slots || {})[k];
      if (!a) s[k] = b; else if (!b) s[k] = a; else s[k] = (b.time || 0) > (a.time || 0) ? b : a;
    }
    return { meta: m, slots: s };
  }

  function mergeLog(a, b) {
    const seen = new Set(); const out = [];
    for (const e of [...(a || []), ...(b || [])]) {
      const k = e.id + "@" + e.at;
      if (!seen.has(k)) { seen.add(k); out.push(e); }
    }
    return out.sort((x, y) => x.at - y.at).slice(-500);
  }

  function getPackage() {
    meta.read = [...readSet];
    return { meta: JSON.parse(JSON.stringify(meta)), slots: JSON.parse(JSON.stringify(slots)) };
  }

  function applyPackage(pkg, mode) {
    const merged = mode === "replace" ? {
      meta: Object.assign(defaultMeta(), pkg.meta || {}),
      slots: pkg.slots || {},
    } : mergePackages(getPackage(), pkg);
    meta = merged.meta;
    meta.settings = Object.assign({ ...DEFAULT_SETTINGS }, meta.settings || {});
    slots = merged.slots || {};
    readSet = new Set(meta.read || []);
    persist("import");
  }

  // ---------- 存檔碼 ----------
  function bytesToB64(bytes) {
    let bin = "";
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(bin);
  }
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function exportCode() {
    const json = JSON.stringify(getPackage());
    const bytes = new TextEncoder().encode(json);
    if (typeof CompressionStream !== "undefined") {
      try {
        const cs = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
        const buf = new Uint8Array(await new Response(cs).arrayBuffer());
        return "SAKURA1." + bytesToB64(buf);
      } catch (e) { /* 改用不壓縮 */ }
    }
    return "SAKURA0." + bytesToB64(bytes);
  }

  async function decodeCode(code) {
    code = String(code || "").trim().replace(/\s+/g, "");
    const m = code.match(/^SAKURA([01])\.(.+)$/);
    if (!m) throw new Error("這不是有效的存檔碼。請確認有完整貼上，開頭應該是 SAKURA。");
    let bytes;
    try { bytes = b64ToBytes(m[2]); } catch (e) { throw new Error("存檔碼不完整，可能少貼了一段。"); }
    if (m[1] === "1") {
      if (typeof DecompressionStream === "undefined") throw new Error("這個瀏覽器無法讀取壓縮的存檔碼，請換一個較新的瀏覽器。");
      try {
        const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
        bytes = new Uint8Array(await new Response(ds).arrayBuffer());
      } catch (e) { throw new Error("存檔碼不完整，可能少貼了一段。"); }
    }
    let pkg;
    try { pkg = JSON.parse(new TextDecoder().decode(bytes)); } catch (e) { throw new Error("存檔碼內容損壞，無法讀取。"); }
    if (!pkg || !pkg.meta) throw new Error("存檔碼裡沒有進度資料。");
    return pkg;
  }

  window.Store = {
    SLOT_COUNT,
    DEFAULT_SETTINGS,
    load: loadAll,
    get meta() { return meta; },
    get slots() { return slots; },
    get ok() { return storageOk; },
    save: persist,
    saveSoon: persistSoon,
    onChange(fn) { listeners.push(fn); },

    markRead(key) { if (!readSet.has(key)) { readSet.add(key); persistSoon("read"); } },
    isRead(key) { return readSet.has(key); },

    setSlot(id, data) { slots[id] = data; persist("slot"); },
    getSlot(id) { return slots[id] || null; },
    deleteSlot(id) { delete slots[id]; persist("slot"); },

    resetAll() {
      const keepSettings = meta.settings;
      const keepWarning = meta.warningAccepted;
      meta = defaultMeta();
      meta.settings = keepSettings;
      meta.warningAccepted = keepWarning;
      meta.resetAt = Date.now();
      slots = {};
      readSet = new Set();
      persist("reset");
    },

    getPackage, applyPackage, mergePackages, exportCode, decodeCode,
  };
})();
