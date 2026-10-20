/* =========================================================
   雲端存檔（Firebase：Google 登入 + Firestore）
   config/firebase-config.js 還是 null 時，整個功能會隱藏。
   設定方式請看 docs/雲端存檔設定.md
   ========================================================= */
(function () {
  "use strict";

  const VERSION = "10.12.2";
  const SOURCES = [
    (n) => `https://www.gstatic.com/firebasejs/${VERSION}/${n}`,
    (n) => `https://cdn.jsdelivr.net/npm/firebase@${VERSION}/${n}`,
  ];
  const FILES = ["firebase-app-compat.js", "firebase-auth-compat.js", "firebase-firestore-compat.js"];

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("載入失敗：" + src));
      document.head.append(s);
    });
  }

  async function loadFirebase() {
    let lastErr;
    for (const src of SOURCES) {
      try {
        for (const f of FILES) await loadScript(src(f));
        return;
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  const Cloud = {
    status: "off",     // off | loading | signedOut | signedIn | error
    user: null,
    lastSync: 0,
    error: "",
    busy: false,

    available() { return !!window.FIREBASE_CONFIG; },

    async init() {
      if (!this.available()) return;
      this.status = "loading";
      try {
        await loadFirebase();
        firebase.initializeApp(window.FIREBASE_CONFIG);
        this.auth = firebase.auth();
        this.db = firebase.firestore();
        try { await this.auth.getRedirectResult(); } catch (e) { /* 忽略 */ }
        this.auth.onAuthStateChanged((u) => {
          this.user = u;
          this.status = u ? "signedIn" : "signedOut";
          if (u) this.sync(true);
          this.refresh();
        });
        Store.onChange((reason) => { if (reason !== "cloud") this.pushSoon(); });
      } catch (e) {
        console.warn(e);
        this.status = "error";
        this.error = "無法連上雲端服務。請確認網路連線，或稍後再試。";
      }
    },

    async signIn() {
      if (!this.auth) return;
      const provider = new firebase.auth.GoogleAuthProvider();
      try {
        await this.auth.signInWithPopup(provider);
      } catch (e) {
        if (e && (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment")) {
          await this.auth.signInWithRedirect(provider);
          return;
        }
        if (e && e.code === "auth/popup-closed-by-user") return;
        this.error = "登入失敗：" + (e && e.message ? e.message : e);
        this.refresh();
      }
    },

    async signOut() {
      if (!this.auth) return;
      await this.auth.signOut();
      this.refresh();
    },

    // 雲端的資料結構：
    //   players/{uid}               進度（meta：輪迴、花瓣、變灰的選項、讀過的文字、設定）
    //   players/{uid}/slots/{id}    每一個存檔欄各自一份（auto、quick、1～30）
    // Firestore 一份文件最多 1 MiB，存檔欄放在一起很容易超過，所以分開存。
    docRef() { return this.db.collection("players").doc(this.user.uid); },
    slotsRef() { return this.docRef().collection("slots"); },
    sig(slot) { return (slot && slot.time || 0) + ":" + JSON.stringify(slot || null).length; },

    // 下載雲端進度、和本機合併、再上傳
    async sync(silent) {
      if (!this.user || this.busy) return;
      this.busy = true;
      this.error = "";
      this.refresh();
      try {
        const [snap, slotSnap] = await Promise.all([this.docRef().get(), this.slotsRef().get()]);
        const local = Store.getPackage();
        const remote = { meta: {}, slots: {} };
        this._pushed = {};
        if (snap.exists) {
          const data = snap.data();
          if (data.meta) remote.meta = JSON.parse(data.meta);
          else if (data.pkg) Object.assign(remote, JSON.parse(data.pkg));   // 舊版：全部存在同一份文件
        }
        slotSnap.forEach((d) => {
          try {
            const slot = JSON.parse(d.data().data);
            remote.slots[d.id] = slot;
            this._pushed[d.id] = this.sig(slot);
          } catch (e) { console.warn("雲端存檔欄讀取失敗", d.id, e); }
        });
        const merged = (snap.exists || !slotSnap.empty) ? Store.mergePackages(local, remote) : local;
        Store.applyPackage(merged, "replace");
        await this.push(true);
        UI.applySettings();
        if (!UI.playing && Screens.base === "title") Title.render(Screens.engine.titleState());
        if (!silent && !this.error) UI.toast("已和雲端同步");
      } catch (e) {
        console.warn(e);
        this.error = "同步失敗：" + (e && e.message ? e.message : e);
      }
      this.busy = false;
      this.refresh();
    },

    pushSoon() {
      if (!this.user) return;
      clearTimeout(this._t);
      this._t = setTimeout(() => this.push(), 2500);
    },

    // 把這台裝置的進度上傳：進度一份，存檔欄只上傳有改變的那幾個，本機刪掉的存檔欄雲端也刪掉
    async push(force) {
      if (!this.user || (this.busy && !force)) return;
      try {
        const pkg = Store.getPackage();
        const pushed = this._pushed || (this._pushed = {});
        await this.docRef().set({
          meta: JSON.stringify(pkg.meta),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          loops: Math.floor(pkg.meta.loops || 0),
          v: 2,
        });
        const jobs = [];
        for (const [id, slot] of Object.entries(pkg.slots || {})) {
          const sg = this.sig(slot);
          if (pushed[id] === sg) continue;
          jobs.push(this.slotsRef().doc(id).set({ data: JSON.stringify(slot), time: Math.floor(slot.time || 0) }).then(() => { pushed[id] = sg; }));
        }
        for (const id of Object.keys(pushed)) {
          if (pkg.slots && pkg.slots[id]) continue;
          jobs.push(this.slotsRef().doc(id).delete().then(() => { delete pushed[id]; }));
        }
        await Promise.all(jobs);
        this.lastSync = Date.now();
      } catch (e) {
        console.warn(e);
        this.error = "上傳失敗：" + (e && e.message ? e.message : e);
      }
      this.refresh();
    },

    // 刪除這個帳號在雲端的所有資料（本機進度保留），按兩次才會執行
    async deleteCloud(btn) {
      if (!this.user || this.busy) return;
      if (!btn.dataset.confirm) {
        btn.dataset.confirm = "1";
        btn.textContent = "確定刪除？再按一次";
        setTimeout(() => { if (btn.isConnected) { delete btn.dataset.confirm; btn.textContent = "刪除雲端資料"; } }, 4000);
        return;
      }
      this.busy = true;
      clearTimeout(this._t);
      try {
        const slots = await this.slotsRef().get();
        await Promise.all(slots.docs.map((d) => d.ref.delete()));
        await this.docRef().delete();
        this._pushed = {};
        await this.auth.signOut();
        UI.toast("雲端資料已刪除（這台裝置上的進度仍保留）");
      } catch (e) {
        console.warn(e);
        this.error = "刪除失敗：" + (e && e.message ? e.message : e);
      }
      this.busy = false;
      this.refresh();
    },

    refresh() {
      const body = document.getElementById("cloud-body");
      if (body && Screens.stack && Screens.stack.includes("cloud")) this.render(body);
    },

    render(body) {
      body.textContent = "";
      const wrap = document.createElement("div");
      wrap.className = "backup-col";
      wrap.style.maxWidth = "880px";
      const p = (text, cls) => { const e = document.createElement("p"); e.textContent = text; if (cls) e.className = cls; wrap.append(e); return e; };
      const h = document.createElement("h3");
      wrap.append(h);

      if (!this.available()) {
        h.textContent = "雲端存檔尚未設定";
        p("這個畫面只有在開發模式才看得到。設定好 Firebase 之後，玩家就能用 Google 帳號登入，換裝置也能接著玩，輪迴進度不會因為清除瀏覽器資料而消失。");
        p("設定步驟請看 docs/雲端存檔設定.md，完成後把設定貼進 config/firebase-config.js。");
        p("在設定好之前，玩家可以用「讀取 → 存檔碼」手動備份進度。");
        body.append(wrap);
        return;
      }

      const row = document.createElement("div");
      row.className = "row-btns";

      const privacy = () => p("隱私說明：登入後，雲端只會保存你的 Google 帳號識別碼、電子郵件，以及遊戲進度與存檔，只用來讓你在不同裝置接著玩，不會用在其他地方，也不會提供給任何人。你可以隨時按「刪除雲端資料」把它們全部刪除。", "note");

      if (this.status === "loading") {
        h.textContent = "連線中";
        p("正在連接雲端服務……");
      } else if (this.status === "error") {
        h.textContent = "無法連線";
        p(this.error, "note err");
        const b = document.createElement("button"); b.className = "btn small"; b.textContent = "重新連線";
        b.addEventListener("click", () => { this.init().then(() => this.refresh()); });
        row.append(b);
      } else if (this.user) {
        h.textContent = "已登入";
        p(`帳號：${this.user.email || this.user.displayName || "Google 帳號"}`);
        p("進度會自動上傳。在其他裝置登入同一個帳號，就能接著玩。", "note");
        if (this.lastSync) p(`上次同步：${new Date(this.lastSync).toLocaleString("zh-TW")}`, "note");
        const s = document.createElement("button"); s.className = "btn small primary"; s.textContent = this.busy ? "同步中……" : "立刻同步";
        s.disabled = this.busy;
        s.addEventListener("click", () => this.sync(false));
        const o = document.createElement("button"); o.className = "btn small"; o.textContent = "登出";
        o.addEventListener("click", () => this.signOut());
        const d = document.createElement("button"); d.className = "btn small"; d.textContent = "刪除雲端資料";
        d.disabled = this.busy;
        d.addEventListener("click", () => this.deleteCloud(d));
        row.append(s, o, d);
        privacy();
      } else {
        h.textContent = "登入以保存進度";
        p("用 Google 帳號登入後，輪迴、花瓣和存檔都會保存在雲端。即使清除瀏覽器資料、換手機或換電腦，也能從原本的地方接著玩。");
        p("不登入也可以玩，進度會先存在這台裝置上，登入時會自動合併。", "note");
        const b = document.createElement("button"); b.className = "btn primary"; b.textContent = "使用 Google 登入";
        b.addEventListener("click", () => this.signIn());
        row.append(b);
        privacy();
      }
      wrap.append(row);
      if (this.error && this.status !== "error") p(this.error, "note err");
      body.append(wrap);
    },
  };

  window.Cloud = Cloud;
})();
