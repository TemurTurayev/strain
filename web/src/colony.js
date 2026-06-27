// colony.js — living, watchable colony simulation on a canvas.
//   mountColony(canvas)        start the render loop
//   updateColony(state, build) feed the latest game state (display eases toward it)
//   pulse(kind, mag)           play a per-turn beat: "damage" | "grow" | "window" | "immune"
//   playEnding(kind, onDone)   animate the finale: "win" | "cleared" | "timeout" | "host"
//   stopColony()               cancel the loop (call when leaving the play screen)
//
// Pure presentation. Reads palette tokens from CSS. Honors prefers-reduced-motion.

const GOLDEN = 2.399963229;

let cv = null, ctx = null, raf = null, dpr = 1;
let target = null;
let disp = { load: 10, lock: 0, host: 100, window: 0 };
let cells = [];          // { seed, sp, jr, nuc }
let sentinels = [];      // { edge, drift, sp, lungeT0 }
let particles = [];      // transient FX
let damageFlashT0 = -9;
let ending = null;       // { kind, t0, onDone, done }
let palette = null;
let bg = null;           // cached tissue blobs
let t0 = 0;

function reduced() {
  try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}
function now() { return performance.now() / 1000; }

function hexToRgb(hex) {
  const m = (hex || "").trim().replace("#", "");
  if (m.length < 6) return [120, 120, 120];
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
}
function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const g = (n) => cs.getPropertyValue(n);
  return {
    accent: hexToRgb(g("--accent")), danger: hexToRgb(g("--danger")),
    warning: hexToRgb(g("--warning")), success: hexToRgb(g("--success")),
    surface2: (g("--surface-2") || "#eef2f6").trim(),
    muted: hexToRgb(g("--text-muted")),
  };
}
function lerp(a, b, k) { return a + (b - a) * k; }
function mix(c1, c2, k) { return [lerp(c1[0], c2[0], k), lerp(c1[1], c2[1], k), lerp(c1[2], c2[2], k)]; }
function rgba(c, a) { return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`; }

function resize() {
  if (!cv || !ctx) return;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth || 680, h = cv.clientHeight || 220;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  buildBg(w, h);
}
function buildBg(w, h) {
  bg = [];
  for (let i = 0; i < 7; i++) {
    bg.push({ x: Math.random() * w, y: Math.random() * h, r: 40 + Math.random() * 70 });
  }
}

function ensureCells(n) {
  while (cells.length < n) {
    cells.push({ seed: Math.random() * 6.28, sp: 0.6 + Math.random() * 0.9, jr: Math.random(), nuc: Math.random() * 6.28 });
  }
}
function ensureSentinels(n) {
  while (sentinels.length < n) {
    sentinels.push({ edge: Math.random(), drift: Math.random() * 6.28, sp: 0.3 + Math.random() * 0.5, lungeT0: -9 });
  }
}

export function mountColony(canvas) {
  if (!canvas || !canvas.getContext) return;
  cv = canvas; ctx = canvas.getContext("2d");
  palette = readPalette();
  disp = { load: 10, lock: 0, host: 100, window: 0 };
  cells = []; sentinels = []; particles = []; ending = null; damageFlashT0 = -9;
  t0 = performance.now();
  resize();
  if (raf) cancelAnimationFrame(raf);
  if (reduced()) { draw(0); return; }
  const loop = (ts) => { draw((ts - t0) / 1000); raf = cv ? requestAnimationFrame(loop) : null; };
  raf = requestAnimationFrame(loop);
}

export function updateColony(state, build) {
  target = { state, build };
  if (reduced()) {
    disp = { load: state.colony_load, lock: state.immune_lockon, host: state.host_stability, window: state.transmission_window };
    draw(0);
  }
}

// A per-turn beat. kind: "damage" | "grow" | "window" | "immune".
export function pulse(kind, mag = 1) {
  if (reduced() || !cv) return;
  const w = cv.clientWidth || 680, h = cv.clientHeight || 220;
  const cx = w * 0.42, cy = h * 0.5;
  if (kind === "damage") {
    damageFlashT0 = now();
    const k = Math.max(2, Math.min(14, Math.round(mag)));
    for (let i = 0; i < k; i++) spawnParticle(cx, cy, palette.danger, 26 + Math.random() * 22, 0.9);
    for (const s of sentinels) s.lungeT0 = now(); // immune cells strike inward
  } else if (kind === "grow") {
    const k = Math.max(2, Math.min(10, Math.round(mag / 4)));
    for (let i = 0; i < k; i++) spawnParticle(cx, cy, palette.accent, 14 + Math.random() * 14, 0.7);
  } else if (kind === "window") {
    for (let i = 0; i < 10; i++) spawnParticle(w - 16, cy + (Math.random() - 0.5) * h * 0.5, palette.success, 18, 0.8);
  } else if (kind === "immune") {
    for (const s of sentinels) s.lungeT0 = now();
  }
}

function spawnParticle(x, y, color, speed, life) {
  if (particles.length > 160) return;
  const a = Math.random() * 6.2832;
  particles.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, color, t0: now(), life });
}

// Animate the finale, then call onDone once.
export function playEnding(kind, onDone) {
  if (reduced()) { if (onDone) onDone(); return; }
  ending = { kind, t0: now(), onDone, done: false };
  if (!raf && cv) { // ensure the loop is alive
    t0 = performance.now();
    const loop = (ts) => { draw((ts - t0) / 1000); raf = cv ? requestAnimationFrame(loop) : null; };
    raf = requestAnimationFrame(loop);
  }
}

export function stopColony() {
  if (raf) cancelAnimationFrame(raf);
  raf = null; cv = null; ctx = null; target = null; ending = null; particles = [];
}

function draw(time) {
  if (!ctx || !cv) return;
  const w = cv.clientWidth || 680, h = cv.clientHeight || 220;
  const cx = w * 0.42, cy = h * 0.5;

  if (target && !ending) {
    const s = target.state;
    disp.load = lerp(disp.load, s.colony_load, 0.08);
    disp.lock = lerp(disp.lock, s.immune_lockon, 0.10);
    disp.host = lerp(disp.host, s.host_stability, 0.10);
    disp.window = s.transmission_window;
  }

  // Ending progress (0..1) drives the finale transforms.
  let ep = 0;
  if (ending) {
    ep = Math.min(1, (now() - ending.t0) / 2.6);
    if (ep >= 1 && !ending.done) {
      ending.done = true;
      const cb = ending.onDone; ending = null;
      if (cb) cb();
      return;
    }
  }
  const alarm = Math.max(0, Math.min(1, disp.lock / 100));

  // ---- background: tissue + vignette --------------------------------------
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = palette.surface2;
  roundRect(ctx, 0, 0, w, h, 12); ctx.fill();
  ctx.save();
  roundRect(ctx, 0, 0, w, h, 12); ctx.clip();
  if (bg) for (const b of bg) {
    const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
    g.addColorStop(0, rgba(palette.muted, 0.05));
    g.addColorStop(1, rgba(palette.muted, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 6.2832); ctx.fill();
  }
  // alarm wash + damage flash + ending tints
  let washA = 0.04 + alarm * 0.12;
  if (ending && (ending.kind === "cleared" || ending.kind === "host")) washA += ep * 0.25;
  ctx.fillStyle = rgba(palette.danger, washA);
  ctx.fillRect(0, 0, w, h);
  if (now() - damageFlashT0 < 0.32) {
    ctx.fillStyle = rgba(palette.danger, 0.18 * (1 - (now() - damageFlashT0) / 0.32));
    ctx.fillRect(0, 0, w, h);
  }
  if (ending && ending.kind === "win") {
    ctx.fillStyle = rgba(palette.success, ep * 0.18);
    ctx.fillRect(0, 0, w, h);
  }
  // vignette
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(20,30,40,0.10)");
  ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
  ctx.restore();

  const tint = mix(palette.accent, palette.danger, alarm * 0.65);

  // ---- colony cells -------------------------------------------------------
  // During a "cleared/timeout/host" ending the colony shrinks to nothing.
  let loadForCount = disp.load;
  if (ending && ending.kind !== "win") loadForCount = disp.load * (1 - ep);
  const n = Math.max(ending ? 0 : 4, Math.min(70, Math.round(loadForCount / 2.4)));
  ensureCells(Math.max(n, 1));
  const clusterR = 14 + Math.sqrt(Math.max(1, n)) * 7.2;

  ctx.beginPath();
  ctx.arc(cx, cy, clusterR + 12, 0, 6.2832);
  ctx.fillStyle = rgba(tint, 0.08 * (ending ? 1 - ep * 0.7 : 1));
  ctx.fill();

  for (let i = 0; i < n; i++) {
    const c = cells[i];
    const ang = i * GOLDEN;
    let rad = clusterR * Math.sqrt(i / Math.max(1, n));
    const pulseR = reduced() ? 0 : Math.sin(time * c.sp + c.seed) * 1.6;
    let x = cx + Math.cos(ang) * rad;
    let y = cy + Math.sin(ang) * rad;
    if (!reduced()) { x += Math.cos(time * 0.7 + c.seed) * (0.6 + c.jr); y += Math.sin(time * 0.9 + c.seed) * (0.6 + c.jr); }
    let alpha = 0.9;
    if (ending) {
      if (ending.kind === "win") { x += ep * (w - cx) * (0.5 + c.jr * 0.8); alpha = 1 - ep * 0.8; }
      else if (ending.kind === "timeout") { x += ep * (w + 40 - x); alpha = 1 - ep; }
      else { // cleared / host: scatter + die
        x += Math.cos(ang) * ep * 70 * (0.5 + c.jr);
        y += Math.sin(ang) * ep * 70 * (0.5 + c.jr);
        alpha = 1 - ep;
      }
    }
    drawCell(x, y, 3.6 + pulseR, tint, alpha, c.nuc + time * 0.5);
  }

  // ---- immune sentinels (hunt + lunge) -----------------------------------
  let sn = Math.max(0, Math.min(6, Math.round(disp.lock / 17)));
  if (ending && (ending.kind === "cleared" || ending.kind === "host")) sn = Math.min(7, sn + Math.round(ep * 4));
  ensureSentinels(sn);
  for (let i = 0; i < sn; i++) {
    const s = sentinels[i];
    const baseAng = s.edge * 6.2832 + time * s.sp * 0.15;
    const far = Math.max(w, h) * 0.52;
    const near = clusterR + 22;
    let prox = 0.25 + alarm * 0.7;
    if (ending && (ending.kind === "cleared" || ending.kind === "host")) prox = Math.min(1, prox + ep);
    // lunge: brief dart inward
    const lt = now() - s.lungeT0;
    const lunge = lt >= 0 && lt < 0.5 ? Math.sin(lt / 0.5 * Math.PI) * 0.35 : 0;
    const d = lerp(far, near, Math.min(1, prox + lunge)) + (reduced() ? 0 : Math.sin(time * s.sp + s.drift) * 5);
    const x = cx + Math.cos(baseAng) * d;
    const y = cy + Math.sin(baseAng) * d * 0.72;
    drawSentinel(x, y, Math.atan2(cy - y, cx - x), 6 + alarm * 2 + lunge * 6, time + s.drift);
  }

  // ---- transmission window gateway ---------------------------------------
  const winOpen = (disp.window > 0) || (ending && ending.kind === "win");
  if (winOpen) {
    const gx = w - 14;
    const glow = 0.5 + (reduced() ? 0 : Math.sin(time * 3) * 0.25) + (ending && ending.kind === "win" ? ep * 0.5 : 0);
    const grad = ctx.createLinearGradient(gx - 48, 0, gx, 0);
    grad.addColorStop(0, rgba(palette.success, 0));
    grad.addColorStop(1, rgba(palette.success, 0.16 + 0.22 * glow));
    ctx.fillStyle = grad;
    ctx.fillRect(gx - 48, 8, 48, h - 16);
    ctx.strokeStyle = rgba(palette.success, 0.6 + glow * 0.3);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(gx - 3, 14); ctx.lineTo(gx - 3, h - 14); ctx.stroke();
  }

  // ---- particles ----------------------------------------------------------
  drawParticles();
}

function drawCell(x, y, r, tint, alpha, nucPhase) {
  // cytoplasm body
  ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832);
  ctx.fillStyle = rgba(tint, 0.85 * alpha); ctx.fill();
  // membrane ring
  ctx.beginPath(); ctx.arc(x, y, r + 1.1, 0, 6.2832);
  ctx.strokeStyle = rgba(tint, 0.28 * alpha); ctx.lineWidth = 1; ctx.stroke();
  // nucleus
  ctx.beginPath();
  ctx.arc(x + Math.cos(nucPhase) * r * 0.25, y + Math.sin(nucPhase) * r * 0.25, r * 0.42, 0, 6.2832);
  ctx.fillStyle = rgba([255, 255, 255], 0.45 * alpha); ctx.fill();
}

function drawSentinel(x, y, rot, size, t) {
  // an antibody-ish hunter: Y body with drifting pseudopod tips
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot);
  ctx.strokeStyle = rgba(palette.warning, 0.9);
  ctx.lineWidth = 1.8; ctx.lineCap = "round";
  const wob = Math.sin(t * 2) * 1.2;
  ctx.beginPath();
  ctx.moveTo(-size, -size + wob); ctx.lineTo(0, 0); ctx.lineTo(-size, size - wob);
  ctx.moveTo(0, 0); ctx.lineTo(size * 0.9, 0);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 2, 0, 6.2832);
  ctx.fillStyle = rgba(palette.warning, 0.9); ctx.fill();
  ctx.restore();
}

function drawParticles() {
  const t = now();
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    const age = t - p.t0;
    if (age > p.life) { particles.splice(i, 1); continue; }
    const k = age / p.life;
    const x = p.x + p.vx * age, y = p.y + p.vy * age;
    ctx.beginPath(); ctx.arc(x, y, 2.6 * (1 - k), 0, 6.2832);
    ctx.fillStyle = rgba(p.color, 0.8 * (1 - k)); ctx.fill();
  }
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
