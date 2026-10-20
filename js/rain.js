/* =========================================================
   下雨效果：畫在背景和人物之間
   [雨 小] [雨 中] [雨 大] [雨 停]
   ========================================================= */
(function () {
  "use strict";

  const COUNTS = [0, 70, 160, 300];

  class RainField {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.w = canvas.width;
      this.h = canvas.height;
      this.level = 0;
      this.drops = [];
      this.running = false;
      this.last = 0;
      this.reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.loop = this.loop.bind(this);
    }

    make(initial) {
      const z = Math.random();             // 遠近：越大越近、越快、越明顯
      return {
        x: Math.random() * (this.w + 300) - 150,
        y: initial ? Math.random() * this.h : -Math.random() * 200 - 40,
        len: 16 + z * 34,
        speed: 900 + z * 900,
        a: 0.16 + z * 0.34,
        wd: 0.7 + z * 1.1,
      };
    }

    target() {
      const n = COUNTS[this.level] || 0;
      return this.reduced ? Math.round(n * 0.35) : n;
    }

    setLevel(level, fill) {
      this.level = Math.max(0, Math.min(3, level | 0));
      if (fill) { const t = this.target(); while (this.drops.length < t) this.drops.push(this.make(true)); }
      if (this.level > 0) this.start();
    }

    clear() {
      this.drops = [];
      this.ctx.clearRect(0, 0, this.w, this.h);
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame(this.loop);
    }

    loop(now) {
      if (!this.running) return;
      const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.w, this.h);
      const t = this.target();
      while (this.drops.length < t) this.drops.push(this.make(false));
      const wind = 0.16;
      ctx.lineCap = "round";
      for (let i = this.drops.length - 1; i >= 0; i--) {
        const d = this.drops[i];
        d.y += d.speed * dt;
        d.x += d.speed * dt * wind;
        if (d.y - d.len > this.h) {
          if (this.drops.length > t) { this.drops.splice(i, 1); continue; }
          Object.assign(d, this.make(false));
          continue;
        }
        ctx.strokeStyle = `rgba(220,228,240,${d.a})`;
        ctx.lineWidth = d.wd;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - d.len * wind, d.y - d.len);
        ctx.stroke();
      }
      if (this.level === 0 && !this.drops.length) {
        ctx.clearRect(0, 0, this.w, this.h);
        this.running = false;
        return;
      }
      requestAnimationFrame(this.loop);
    }
  }

  window.RainField = RainField;
})();
