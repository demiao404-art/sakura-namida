/* =========================================================
   標題畫面的櫻花樹
   mood：
     spring  一般輪：花隨著拿到的結局越來越少，地上的花瓣越來越多
     bare    集滿結局，下一輪就是絕望輪：黃昏、幾乎沒有花
     night   絕望輪之後（希望輪）：夜晚、樹上沒有花
     leaves  完美結局之後：早晨、新葉與少量的花
   不顯示任何數字，玩家只看得到樹的變化
   ========================================================= */
(function () {
  "use strict";

  const W = 1600, H = 900;

  function mulberry(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const MOODS = {
    spring: {
      sky: ["#c7d3ea", "#e9d9e8", "#f8e3e3", "#fbece4"],
      glow: ["rgba(255,247,236,0.85)", 360, 150],
      hill: ["#e9cdd6", "#d9b7c4"], ground: ["#e7c6cf", "#d4a9b8"],
      trunk: "#4b3540", trunkHi: "rgba(255,230,236,0.18)",
      bloom: ["rgba(255,236,242,", "rgba(249,206,220,", "rgba(240,170,193,", "rgba(255,248,250,"],
      dark: false, ambient: 1,
    },
    bare: {
      sky: ["#4e4a6b", "#8a7690", "#d39fa8", "#efc7b9"],
      glow: ["rgba(255,214,190,0.6)", 300, 640],
      hill: ["#6f5468", "#5a4256"], ground: ["#5d4357", "#3f2c3c"],
      trunk: "#2a1d26", trunkHi: "rgba(255,200,190,0.12)",
      bloom: ["rgba(245,200,214,", "rgba(232,170,190,", "rgba(214,140,166,", "rgba(250,224,232,"],
      dark: true, ambient: 0.35,
    },
    night: {
      sky: ["#070915", "#121429", "#1f1a33", "#2b2238"],
      glow: ["rgba(200,205,255,0.28)", 260, 160],
      hill: ["#1b1626", "#141019"], ground: ["#1e1726", "#120d16"],
      trunk: "#0d0910", trunkHi: "rgba(190,200,255,0.10)",
      bloom: ["rgba(240,215,230,", "rgba(220,190,210,", "rgba(200,160,190,", "rgba(250,235,245,"],
      dark: true, ambient: 0, moon: true, stars: true,
    },
    leaves: {
      sky: ["#b9dcef", "#d9ecef", "#f2f2e6", "#f8efe3"],
      glow: ["rgba(255,252,236,0.9)", 380, 140],
      hill: ["#cfe0c4", "#b7cfa9"], ground: ["#cfdcc0", "#adc39e"],
      trunk: "#463a36", trunkHi: "rgba(255,255,240,0.2)",
      bloom: ["rgba(255,240,244,", "rgba(250,214,226,", "rgba(242,184,203,", "rgba(255,250,251,"],
      leaf: ["rgba(178,214,140,", "rgba(140,190,110,", "rgba(206,232,160,"],
      dark: false, ambient: 0.4,
    },
  };

  // ---------- 樹的形狀（固定種子，每次都一樣） ----------
  const tree = (function build() {
    const rnd = mulberry(20261020);
    const segs = [];
    const tips = [];
    function branch(x, y, ang, len, w, depth) {
      const x2 = x + Math.cos(ang) * len;
      const y2 = y + Math.sin(ang) * len;
      const bend = (rnd() - 0.5) * len * 0.35;
      const cx = (x + x2) / 2 + Math.cos(ang + Math.PI / 2) * bend;
      const cy = (y + y2) / 2 + Math.sin(ang + Math.PI / 2) * bend;
      segs.push({ x, y, cx, cy, x2, y2, w, w2: w * 0.68, depth });
      if (depth <= 0 || w < 2.2) { tips.push({ x: x2, y: y2, depth }); return; }
      if (depth <= 3) tips.push({ x: x2, y: y2, depth, inner: true });
      const n = depth > 5 ? 2 : rnd() < 0.7 ? 2 : 3;
      for (let i = 0; i < n; i++) {
        const spread = (i - (n - 1) / 2) * (0.5 + rnd() * 0.35) + (rnd() - 0.5) * 0.3;
        // 往左上伸展，偏向畫面中央
        const pull = -0.06;
        branch(x2, y2, ang + spread + pull, len * (0.7 + rnd() * 0.16), w * 0.68, depth - 1);
      }
    }
    // 主幹從右下長出，往左上
    branch(1210, 935, -1.72, 210, 54, 7);
    branch(1225, 935, -1.32, 150, 30, 6);
    return { segs, tips };
  })();

  // 花團：沿著細枝分布，依隨機順序決定哪些先消失
  const clusters = (function () {
    const rnd = mulberry(77);
    const out = [];
    const add = (x, y, r) => out.push({ x, y, r, order: rnd(), seed: (rnd() * 1e9) | 0 });
    for (const t of tree.tips) add(t.x + (rnd() - 0.5) * 30, t.y + (rnd() - 0.5) * 24, 20 + rnd() * 18);
    for (const sg of tree.segs) {
      if (sg.depth > 3) continue;
      const k = sg.depth <= 1 ? 2 : 1;
      for (let j = 0; j < k; j++) {
        const t = 0.35 + rnd() * 0.6;
        const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
        add(a * sg.x + b * sg.cx + c * sg.x2 + (rnd() - 0.5) * 26, a * sg.y + b * sg.cy + c * sg.y2 + (rnd() - 0.5) * 20, 16 + rnd() * 16);
      }
    }
    out.sort((a, b) => a.order - b.order);
    return out;
  })();

  // 地上花瓣的位置（第 i 片永遠落在同一個地方）
  function groundSpot(i) {
    const rnd = mulberry(900 + i * 31);
    const x = 760 + rnd() * 720 + (i % 2 ? -30 : 30);
    const y = 842 + rnd() * 42 - Math.max(0, (x - 1000)) * 0.02;
    return { x, y, rot: rnd() * Math.PI * 2, s: 24 + rnd() * 8, spr: (rnd() * 4) | 0 };
  }

  function grad(ctx, stops, y0, y1) {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
    return g;
  }

  function drawScene(ctx, mood, bloomFrac) {
    const M = MOODS[mood];
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = grad(ctx, M.sky, 0, H);
    ctx.fillRect(0, 0, W, H);

    // 光暈
    const [gc, gr, gy] = M.glow;
    const gx = M.moon ? 1330 : mood === "bare" ? 520 : 420;
    const rg = ctx.createRadialGradient(gx, gy, 10, gx, gy, gr * 2.2);
    rg.addColorStop(0, gc); rg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);

    if (M.stars) {
      const rnd = mulberry(5);
      for (let i = 0; i < 160; i++) {
        const x = rnd() * W, y = rnd() * 560, r = rnd() * 1.4 + 0.3;
        ctx.fillStyle = `rgba(230,232,255,${0.25 + rnd() * 0.6})`;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (M.moon) {
      ctx.save();
      ctx.shadowColor = "rgba(220,225,255,0.8)"; ctx.shadowBlur = 50;
      ctx.fillStyle = "#eef0ff";
      ctx.beginPath(); ctx.arc(1330, 160, 46, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.fillStyle = "rgba(200,205,235,0.25)";
      ctx.beginPath(); ctx.arc(1316, 150, 9, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(1345, 175, 6, 0, Math.PI * 2); ctx.fill();
    }

    // 遠山與城市
    ctx.fillStyle = M.hill[0];
    ctx.beginPath(); ctx.moveTo(0, 720);
    for (let x = 0; x <= W; x += 40) ctx.lineTo(x, 716 - Math.sin(x / 260) * 22 - Math.sin(x / 97) * 7);
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.filter = "blur(1.5px)";
    ctx.fillStyle = M.hill[1];
    const rnd = mulberry(12);
    for (let x = -10; x < W; x += 26 + rnd() * 34) {
      const h = 10 + rnd() * 34;
      ctx.fillRect(x, 770 - h, 18 + rnd() * 30, h + 30);
    }
    ctx.restore();
    if (M.dark) {
      for (let i = 0; i < 60; i++) {
        ctx.fillStyle = mood === "night" ? "rgba(255,226,170,0.55)" : "rgba(255,220,180,0.32)";
        ctx.fillRect(rnd() * W, 742 + rnd() * 30, 2.5, 2.5);
      }
    }

    // 地面
    ctx.fillStyle = grad(ctx, M.ground, 780, H);
    ctx.beginPath(); ctx.moveTo(0, 812);
    ctx.bezierCurveTo(400, 790, 900, 800, 1600, 770);
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();

    // 樹幹與樹枝
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of tree.segs) {
      ctx.strokeStyle = M.trunk;
      const steps = 6;
      for (let i = 0; i < steps; i++) {
        const t0 = i / steps, t1 = (i + 1) / steps;
        const p = (t) => {
          const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
          return [a * s.x + b * s.cx + c * s.x2, a * s.y + b * s.cy + c * s.y2];
        };
        const [ax, ay] = p(t0), [bx, by] = p(t1);
        ctx.lineWidth = s.w + (s.w2 - s.w) * t0;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      }
      if (s.w > 8) {
        ctx.strokeStyle = M.trunkHi;
        ctx.lineWidth = s.w * 0.18;
        ctx.beginPath();
        ctx.moveTo(s.x - s.w * 0.25, s.y);
        ctx.quadraticCurveTo(s.cx - s.w * 0.22, s.cy, s.x2 - s.w2 * 0.25, s.y2);
        ctx.stroke();
      }
    }

    // 葉子（完美結局之後）
    if (M.leaf) {
      for (const c of clusters) {
        const r = mulberry(c.seed + 3);
        for (let i = 0; i < 14; i++) {
          const a = r() * Math.PI * 2, d = r() * c.r;
          ctx.fillStyle = M.leaf[(r() * 3) | 0] + (0.45 + r() * 0.45) + ")";
          ctx.save();
          ctx.translate(c.x + Math.cos(a) * d, c.y + Math.sin(a) * d * 0.8);
          ctx.rotate(r() * Math.PI);
          ctx.beginPath(); ctx.ellipse(0, 0, 9 + r() * 6, 4 + r() * 3, 0, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }
    }

    // 花
    const keep = Math.round(clusters.length * bloomFrac);
    for (let k = 0; k < keep; k++) {
      const c = clusters[k];
      const soft = ctx.createRadialGradient(c.x, c.y, 1, c.x, c.y, c.r * 1.6);
      soft.addColorStop(0, M.bloom[3] + "0.42)"); soft.addColorStop(1, M.bloom[3] + "0)");
      ctx.fillStyle = soft;
      ctx.beginPath(); ctx.arc(c.x, c.y, c.r * 1.6, 0, Math.PI * 2); ctx.fill();
    }
    for (let k = 0; k < keep; k++) {
      const c = clusters[k];
      const r = mulberry(c.seed);
      const n = 16;
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * c.r;
        const x = c.x + Math.cos(a) * d, y = c.y + Math.sin(a) * d * 0.8;
        const rr = 3.2 + r() * 5.5;
        ctx.fillStyle = M.bloom[(r() * 4) | 0] + (0.42 + r() * 0.48) + ")";
        // 五瓣小花
        if (rr > 6.5 && r() < 0.45) {
          for (let q = 0; q < 5; q++) {
            const qa = q * Math.PI * 0.4 + a;
            ctx.beginPath(); ctx.arc(x + Math.cos(qa) * rr * 0.55, y + Math.sin(qa) * rr * 0.55, rr * 0.48, 0, Math.PI * 2); ctx.fill();
          }
        } else {
          ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  }

  function drawGround(ctx, count, skipLast) {
    const sprites = PetalField.sprites;
    const n = skipLast ? count - 1 : count;
    for (let i = 0; i < n; i++) {
      const g = groundSpot(i);
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.scale(1, 0.62);
      ctx.rotate(g.rot);
      ctx.globalAlpha = 0.95;
      ctx.shadowColor = "rgba(255,220,230,0.6)";
      ctx.shadowBlur = 8;
      ctx.drawImage(sprites[g.spr], -g.s / 2, -g.s / 2, g.s, g.s);
      ctx.restore();
    }
  }

  const Title = {
    init() {
      this.canvas = document.getElementById("title-canvas");
      this.ctx = this.canvas.getContext("2d");
      const over = document.createElement("canvas");
      over.width = W; over.height = H;
      over.style.cssText = "position:absolute;inset:0;width:1600px;height:900px;pointer-events:none";
      this.canvas.after(over);
      this.petals = new PetalField(over, { perLevel: 10, size: [10, 22], speed: [30, 70], wind: 30 });
      this.base = document.createElement("canvas");
      this.base.width = W; this.base.height = H;
    },

    render(ts) {
      const mood = ts.mood;
      const frac = mood === "spring" ? Math.max(0.12, 1 - 0.86 * (ts.petals / Math.max(1, ts.need)))
        : mood === "bare" ? 0.022 : mood === "night" ? 0 : 0.3;
      const bctx = this.base.getContext("2d");
      drawScene(bctx, mood, frac);
      this.ts = ts;

      let seen = 0;
      try { seen = Number(localStorage.getItem("sakura-vn.seenPetal") || 0); } catch (e) {}
      const animateNew = ts.lastPetalAt > seen && ts.petals > 0 && mood !== "night" && mood !== "leaves";
      this.paint(ts.petals, animateNew);

      const screen = document.getElementById("screen-title");
      screen.classList.toggle("dark", MOODS[mood].dark);

      const amb = Math.round(MOODS[mood].ambient * (mood === "spring" ? 1 + frac * 2 : 1));
      this.petals.clear();
      this.petals.setLevel(amb, true);

      if (animateNew) {
        try { localStorage.setItem("sakura-vn.seenPetal", String(ts.lastPetalAt)); } catch (e) {}
        const g = groundSpot(ts.petals - 1);
        setTimeout(() => {
          this.petals.single({ x: 1080, y: 260, tx: g.x, ty: g.y, s: g.s, dur: 5200, land: true, fadeOut: false, endRot: g.rot, endScaleY: 0.62, spr: g.spr })
            .then(() => this.paint(ts.petals, false));
        }, 900);
      }
    },

    paint(count, skipLast) {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(this.base, 0, 0);
      drawGround(ctx, count, skipLast);
    },

    stop() { this.petals.setLevel(0); },
  };

  window.Title = Title;
})();
