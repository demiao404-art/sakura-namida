/* =========================================================
   花瓣粒子
   ========================================================= */
(function () {
  "use strict";

  const PALETTES = [
    ["#fde6ee", "#f6bfd0", "#e98fab"],
    ["#fff0f4", "#f9cfdb", "#ee9fb7"],
    ["#fbe1ea", "#f2b3c6", "#dc7f9c"],
    ["#fff6f8", "#fadbe4", "#f0b1c4"],
  ];

  // 預先畫好花瓣圖，之後只要貼圖，效能比較好
  const sprites = PALETTES.map((p) => {
    const S = 72;
    const c = document.createElement("canvas");
    c.width = S; c.height = S;
    const g = c.getContext("2d");
    g.translate(S / 2, S / 2);
    g.scale(S / 26, S / 26);
    g.translate(-12, -12.6);
    const path = new Path2D("M12 22.5C6.2 18 3.6 12.2 6.4 5.4 7.6 2.6 10.4 2.4 12 5.6 13.6 2.4 16.4 2.6 17.6 5.4 20.4 12.2 17.8 18 12 22.5Z");
    const grad = g.createRadialGradient(12, 19, 1, 12, 12, 13);
    grad.addColorStop(0, p[0]);
    grad.addColorStop(0.55, p[1]);
    grad.addColorStop(1, p[2]);
    g.fillStyle = grad;
    g.fill(path);
    g.strokeStyle = "rgba(255,255,255,0.35)";
    g.lineWidth = 0.35;
    g.beginPath(); g.moveTo(12, 21); g.quadraticCurveTo(11.6, 13, 12, 7); g.stroke();
    return c;
  });

  function rand(a, b) { return a + Math.random() * (b - a); }

  class PetalField {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.w = canvas.width;
      this.h = canvas.height;
      this.opts = Object.assign({ perLevel: 22, size: [12, 26], speed: [38, 90], wind: 26, alpha: 1 }, opts || {});
      this.level = 0;
      this.ps = [];
      this.specials = [];
      this.running = false;
      this.last = 0;
      this.paused = false;
      this.reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.loop = this.loop.bind(this);
    }

    target() { return this.reduced ? Math.round(this.level * this.opts.perLevel * 0.3) : this.level * this.opts.perLevel; }

    make(initial) {
      const o = this.opts;
      const z = Math.random();
      return {
        x: rand(-80, this.w + 40),
        y: initial ? rand(-40, this.h) : rand(-120, -20),
        s: o.size[0] + (o.size[1] - o.size[0]) * z,
        vy: o.speed[0] + (o.speed[1] - o.speed[0]) * z,
        vx: rand(0.4, 1.2) * o.wind * (0.6 + z * 0.6),
        rot: rand(0, Math.PI * 2),
        vr: rand(-1.4, 1.4),
        flip: rand(0, Math.PI * 2),
        vf: rand(1.2, 3.2),
        sway: rand(0, Math.PI * 2),
        vs: rand(0.6, 1.4),
        amp: rand(14, 40),
        a: (0.55 + z * 0.45) * o.alpha,
        spr: sprites[(Math.random() * sprites.length) | 0],
        blur: z < 0.25,
      };
    }

    setLevel(n, fill) {
      this.level = n;
      if (fill) { const t = this.target(); while (this.ps.length < t) this.ps.push(this.make(true)); }
      if (n > 0 || this.specials.length) this.start();
    }

    // 一片特別的花瓣（結局、標題畫面落地用）
    single(opts) {
      return new Promise((resolve) => {
        const o = Object.assign({ x: this.w * 0.55, y: -60, tx: null, ty: this.h + 80, s: 34, dur: 7000 }, opts);
        this.specials.push({
          x0: o.x, y0: o.y, tx: o.tx === null ? o.x - 160 : o.tx, ty: o.ty,
          s: o.s, dur: o.dur, t: 0, rot: rand(0, 6), flip: 0,
          spr: sprites[o.spr === undefined ? 1 : o.spr], resolve, land: !!o.land, fadeOut: o.fadeOut !== false,
          endRot: o.endRot === undefined ? 0.4 : o.endRot, endScaleY: o.endScaleY || 1,
        });
        this.start();
      });
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame(this.loop);
    }

    clear() {
      this.ps = [];
      this.specials.forEach((s) => s.resolve());
      this.specials = [];
      this.ctx.clearRect(0, 0, this.w, this.h);
    }

    loop(now) {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.w, this.h);

      const t = this.target();
      if (this.ps.length < t && Math.random() < 0.5) this.ps.push(this.make(false));

      for (let i = this.ps.length - 1; i >= 0; i--) {
        const p = this.ps[i];
        p.sway += p.vs * dt;
        p.flip += p.vf * dt;
        p.rot += p.vr * dt;
        p.y += p.vy * dt;
        p.x += (p.vx + Math.cos(p.sway) * p.amp * 0.9) * dt;
        if (p.y > this.h + 40 || p.x > this.w + 100) {
          if (this.ps.length > t) { this.ps.splice(i, 1); continue; }
          Object.assign(p, this.make(false));
          continue;
        }
        this.drawPetal(p.x, p.y, p.s, p.rot, Math.cos(p.flip), p.a, p.spr);
      }

      for (let i = this.specials.length - 1; i >= 0; i--) {
        const s = this.specials[i];
        s.t += dt * 1000;
        const k = Math.min(1, s.t / s.dur);
        const e = s.land ? 1 - Math.pow(1 - k, 2.2) : k;
        const x = s.x0 + (s.tx - s.x0) * e + Math.sin(k * Math.PI * 3) * 70 * (1 - k);
        const y = s.y0 + (s.ty - s.y0) * e;
        s.rot += dt * (1 - k * 0.8) * 1.2;
        s.flip += dt * 2.2 * (1 - k * 0.9);
        let a = 1;
        if (k < 0.08) a = k / 0.08;
        if (s.fadeOut && k > 0.85) a = Math.max(0, (1 - k) / 0.15);
        let rot = s.rot, flip = Math.cos(s.flip), sy = 1;
        if (s.land) {
          // 最後一段慢慢轉成躺在地上的樣子
          const e2 = k > 0.75 ? (k - 0.75) / 0.25 : 0;
          const ee = e2 * e2 * (3 - 2 * e2);
          rot = rot + (s.endRot - rot) * ee;
          flip = flip + (1 - flip) * ee;
          sy = 1 + (s.endScaleY - 1) * ee;
        }
        this.drawPetal(x, y, s.s, rot, flip, a, s.spr, true, sy);
        if (k >= 1) { this.specials.splice(i, 1); s.resolve({ x, y }); }
      }

      if (this.level === 0 && this.ps.length && !this._draining) {
        // 漸漸停下：讓已經在空中的花瓣落完
        this.ps = this.ps.filter((p) => p.y < this.h + 40);
      }
      if (this.level === 0 && this.ps.every((p) => p.y > this.h) && !this.specials.length) {
        this.ps = [];
        ctx.clearRect(0, 0, this.w, this.h);
        this.running = false;
        return;
      }
      requestAnimationFrame(this.loop);
    }

    drawPetal(x, y, s, rot, flip, a, spr, glow, sy) {
      const ctx = this.ctx;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(x, y);
      if (sy && sy !== 1) ctx.scale(1, sy);
      ctx.rotate(rot);
      ctx.scale(Math.max(0.12, Math.abs(flip)), 1);
      if (glow) { ctx.shadowColor = "rgba(255,210,224,0.9)"; ctx.shadowBlur = 18; }
      ctx.drawImage(spr, -s / 2, -s / 2, s, s);
      ctx.restore();
    }
  }

  PetalField.sprites = sprites;
  window.PetalField = PetalField;
})();
