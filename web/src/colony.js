// colony.js — a living, watchable microbe-simulation viewport (dark, atmospheric).
//   mountColony(canvas)        start the render loop
//   updateColony(state, build) feed the latest game state (display eases toward it)
//   pulse(kind, mag)           per-turn beat: "damage" | "grow" | "window" | "immune"
//   playEnding(kind, onDone)   finale: "win" | "cleared" | "timeout" | "host"
//   fixation()                 0..1 immune-fixation pressure (for the UI readout)
//   stopColony()               cancel the loop (call when leaving play)
//
// The viewport is intentionally dark (a microscope view) while the dashboard around
// it stays light. Layered: offscreen tissue+capillaries+noise -> cells -> immune ->
// particles -> fixation ring -> vignette. Honors prefers-reduced-motion.

import { MAX_TURNS } from "./engine.js";

const GOLDEN = 2.399963229;

let cv = null, ctx = null, raf = null, dpr = 1, W = 680, H = 220;
let bgCanvas = null;            // cached static background
let target = null;
let disp = { load: 10, lock: 0, host: 100, window: 0, turn: 0 };
let cells = [];                 // { seed, sp, jr, nuc, bornAt, dmgT }
let immune = [];                // { x, y, vx, vy, phase, sp, lungeT, trail }
let particles = [];
let damageFlashT = -9, shakeT = -9;
let ending = null;
let t0 = 0;

function reduced() { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } }
function now() { return performance.now() / 1000; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, k) { return a + (b - a) * k; }
function easeIO(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

export function fixation() {
  // How close the host is to forcing you out: time pressure + how well it knows you.
  return clamp(0.55 * (disp.turn / MAX_TURNS) + 0.6 * (disp.lock / 100), 0, 1);
}

function resize() {
  if (!cv || !ctx) return;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  W = cv.clientWidth || 680; H = cv.clientHeight || 220;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  buildBackground();
}

function buildBackground() {
  bgCanvas = document.createElement("canvas");
  bgCanvas.width = Math.round(W * dpr); bgCanvas.height = Math.round(H * dpr);
  const b = bgCanvas.getContext("2d");
  b.setTransform(dpr, 0, 0, dpr, 0, 0);
  // deep tissue gradient
  const g = b.createRadialGradient(W * 0.42, H * 0.5, 40, W * 0.5, H * 0.5, W * 0.85);
  g.addColorStop(0, "#1a2730"); g.addColorStop(0.55, "#221a2b"); g.addColorStop(1, "#0a0c11");
  b.fillStyle = g; b.fillRect(0, 0, W, H);
  // capillaries (generated once)
  for (let i = 0; i < 11; i++) {
    const y = Math.random() * H;
    b.beginPath();
    b.moveTo(-20, y);
    b.bezierCurveTo(W * 0.3, y + (Math.random() - 0.5) * 120, W * 0.6, y + (Math.random() - 0.5) * 120, W + 20, y + (Math.random() - 0.5) * 80);
    b.strokeStyle = `rgba(150,52,70,${0.05 + Math.random() * 0.06})`;
    b.lineWidth = 2 + Math.random() * 6;
    b.stroke();
  }
  // cheap noise speckle
  for (let i = 0; i < 380; i++) {
    b.fillStyle = `rgba(255,255,255,${Math.random() * 0.025})`;
    b.fillRect(Math.random() * W, Math.random() * H, 1, 1);
  }
}

function ensureCells(n) {
  while (cells.length < n) {
    cells.push({ seed: Math.random() * 6.28, sp: 0.5 + Math.random() * 0.9, jr: Math.random(), nuc: Math.random() * 6.28, bornAt: now(), dmgT: -9 });
  }
}
function syncImmune(count) {
  while (immune.length < count) {
    const edge = Math.random();
    immune.push({ x: Math.random() * W, y: Math.random() * H, vx: 0, vy: 0, phase: Math.random() * 6.28, sp: 0.5 + Math.random() * 0.6, lungeT: -9, trail: [], edge });
  }
  while (immune.length > count) immune.pop();
}

export function mountColony(canvas) {
  if (!canvas || !canvas.getContext) return;
  cv = canvas; ctx = canvas.getContext("2d");
  disp = { load: 10, lock: 0, host: 100, window: 0, turn: 0 };
  cells = []; immune = []; particles = []; ending = null; damageFlashT = -9; shakeT = -9;
  t0 = performance.now();
  resize();
  startLoop();
  if (reduced()) draw(0);
}
function startLoop() {
  if (raf) cancelAnimationFrame(raf);
  if (reduced()) return;
  const loop = (ts) => { draw((ts - t0) / 1000); raf = cv ? requestAnimationFrame(loop) : null; };
  raf = requestAnimationFrame(loop);
}

export function updateColony(state, build) {
  target = { state, build };
  if (reduced()) {
    disp = { load: state.colony_load, lock: state.immune_lockon, host: state.host_stability, window: state.transmission_window, turn: state.turn };
    draw(0);
  }
}

export function pulse(kind, mag = 1) {
  if (reduced() || !cv) return;
  const cx = W * 0.42, cy = H * 0.5;
  if (kind === "damage") {
    damageFlashT = now(); shakeT = now();
    const k = clamp(Math.round(mag), 2, 14);
    for (let i = 0; i < k; i++) {
      const a = Math.random() * 6.28, d = 10 + Math.random() * 30;
      spawnParticle(cx + Math.cos(a) * d, cy + Math.sin(a) * d, "rgba(255,150,150,", 24 + Math.random() * 24, 0.8);
    }
    for (const im of immune) im.lungeT = now();
    for (let i = 0; i < Math.min(cells.length, k); i++) {
      const idx = (Math.random() * cells.length) | 0; if (cells[idx]) cells[idx].dmgT = now();
    }
  } else if (kind === "grow") {
    const k = clamp(Math.round(mag / 4), 1, 8);
    for (const c of cells) if (now() - c.bornAt < 0.05) c.bornAt = now();
    for (let i = 0; i < k; i++) spawnParticle(cx, cy, "rgba(140,240,200,", 12 + Math.random() * 12, 0.6);
  } else if (kind === "window") {
    for (let i = 0; i < 12; i++) spawnParticle(W - 16, cy + (Math.random() - 0.5) * H * 0.5, "rgba(120,240,200,", 16, 0.8);
  } else if (kind === "immune") {
    for (const im of immune) im.lungeT = now();
  }
}

function spawnParticle(x, y, colorPrefix, speed, life) {
  if (particles.length > 170) return;
  const a = Math.random() * 6.2832;
  particles.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, cp: colorPrefix, t0: now(), life });
}

export function playEnding(kind, onDone) {
  if (reduced()) { if (onDone) onDone(); return; }
  ending = { kind, t0: now(), onDone, done: false };
  if (!raf && cv) { t0 = performance.now(); startLoop(); }
}

export function stopColony() {
  if (raf) cancelAnimationFrame(raf);
  raf = null; cv = null; ctx = null; target = null; ending = null; particles = []; immune = [];
}

function draw(time) {
  if (!ctx || !cv) return;
  const cx = W * 0.42, cy = H * 0.5;

  if (target && !ending) {
    const s = target.state;
    disp.load = lerp(disp.load, s.colony_load, 0.08);
    disp.lock = lerp(disp.lock, s.immune_lockon, 0.10);
    disp.host = lerp(disp.host, s.host_stability, 0.10);
    disp.window = s.transmission_window; disp.turn = s.turn;
  }

  let ep = 0;
  if (ending) {
    const dur = ending.kind === "win" ? 2.6 : ending.kind === "host" ? 3.0 : 2.8;
    ep = Math.min(1, (now() - ending.t0) / dur);
    if (ep >= 1 && !ending.done) { ending.done = true; const cb = ending.onDone; ending = null; if (cb) cb(); return; }
  }

  const alarm = clamp(disp.lock / 100, 0, 1);
  const fix = fixation();

  // screen shake
  let sx = 0, sy = 0;
  if (now() - shakeT < 0.18) { const k = 1 - (now() - shakeT) / 0.18; sx = (Math.random() - 0.5) * 4 * k; sy = (Math.random() - 0.5) * 4 * k; }
  ctx.save(); ctx.translate(sx, sy);

  // layer 1: cached background
  if (bgCanvas) ctx.drawImage(bgCanvas, 0, 0, W, H);
  ctx.save();
  roundRectPath(ctx, 0, 0, W, H, 12); ctx.clip();

  // alarm + flashes + ending tints
  let red = 0.05 + alarm * 0.16;
  if (ending && (ending.kind === "cleared" || ending.kind === "host")) red += ep * 0.3;
  ctx.fillStyle = `rgba(200,40,46,${red})`; ctx.fillRect(0, 0, W, H);
  if (now() - damageFlashT < 0.3) { ctx.fillStyle = `rgba(255,80,80,${0.16 * (1 - (now() - damageFlashT) / 0.3)})`; ctx.fillRect(0, 0, W, H); }
  if (ending && ending.kind === "win") { ctx.fillStyle = `rgba(60,210,160,${ep * 0.16})`; ctx.fillRect(0, 0, W, H); }
  if (ending && ending.kind === "host") { ctx.fillStyle = `rgba(10,12,16,${ep * 0.5})`; ctx.fillRect(0, 0, W, H); }

  // ---- colony cells -------------------------------------------------------
  let loadForCount = disp.load;
  if (ending && ending.kind !== "win") loadForCount = disp.load * (1 - ep);
  const n = clamp(Math.round(loadForCount / 2.3), ending ? 0 : 4, 64);
  ensureCells(Math.max(1, n));
  const clusterR = 12 + Math.sqrt(Math.max(1, n)) * 7.0;

  // biofilm web between near cells (draw first, behind cells)
  ctx.strokeStyle = "rgba(120,230,190,0.10)"; ctx.lineWidth = 1;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const ang = i * GOLDEN, rad = clusterR * Math.sqrt(i / Math.max(1, n));
    let x = cx + Math.cos(ang) * rad, y = cy + Math.sin(ang) * rad;
    const c = cells[i];
    if (!reduced()) { x += Math.cos(time * 0.6 + c.seed) * (0.6 + c.jr); y += Math.sin(time * 0.8 + c.seed) * (0.6 + c.jr); }
    if (ending) {
      if (ending.kind === "win") x += ep * (W - cx) * (0.5 + c.jr * 0.8);
      else if (ending.kind === "timeout") x += easeIO(ep) * (W + 50 - x);
      else { x += Math.cos(ang) * ep * 80 * (0.5 + c.jr); y += Math.sin(ang) * ep * 80 * (0.5 + c.jr); }
    }
    pts.push({ x, y, c });
  }
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < Math.min(pts.length, i + 4); j++) {
      const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y, d = Math.hypot(dx, dy);
      if (d < 26) { ctx.globalAlpha = (1 - d / 26) * 0.5; ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke(); }
    }
  }
  ctx.globalAlpha = 1;

  for (let i = 0; i < pts.length; i++) {
    const { x, y, c } = pts[i];
    const grow = clamp((now() - c.bornAt) / 0.5, 0, 1);
    const pulseR = reduced() ? 0 : Math.sin(time * c.sp + c.seed) * 0.7;
    let alpha = ending ? (ending.kind === "win" || ending.kind === "timeout" ? 1 - ep : 1 - ep) : 1;
    drawCell(x, y, (3.4 + pulseR) * (0.4 + 0.6 * grow), c, alpha, time);
  }

  // ---- immune cells -------------------------------------------------------
  let icount = Math.round(lerp(0, 16, Math.max(alarm, fix * 0.8)));
  if (ending && (ending.kind === "cleared" || ending.kind === "host")) icount = Math.round(lerp(icount, 22, ep));
  syncImmune(clamp(icount, 0, 22));
  for (const im of immune) updateImmune(im, cx, cy, clusterR, alarm, fix, ending, ep, time);

  // ---- transmission window ------------------------------------------------
  if (disp.window > 0 || (ending && ending.kind === "win")) drawWindow(cx, cy, ending, ep, time);

  // ---- fixation ring (the immune closing in) ------------------------------
  if (fix > 0.25 && !ending) {
    const ringR = lerp(Math.max(W, H) * 0.5, clusterR + 30, fix) + Math.sin(time * 2) * 3;
    ctx.strokeStyle = `rgba(255,255,255,${0.06 + fix * 0.18})`;
    ctx.lineWidth = 1.5; ctx.setLineDash([6, 8]); ctx.lineDashOffset = -time * 14;
    ctx.beginPath(); ctx.arc(cx, cy, ringR, 0, 6.2832); ctx.stroke(); ctx.setLineDash([]);
  }

  drawParticles();
  // vignette
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.28, W / 2, H / 2, Math.max(W, H) * 0.72);
  vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

  // host-death flatline
  if (ending && ending.kind === "host" && ep > 0.55) drawFlatline(ep);

  ctx.restore();
  ctx.restore();
}

function drawCell(x, y, r, c, alpha, time) {
  const damaged = now() - c.dmgT < 0.45;
  // glow
  const glow = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 2.4);
  glow.addColorStop(0, `rgba(75,220,170,${0.20 * alpha})`); glow.addColorStop(1, "rgba(75,220,170,0)");
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, r * 2.4, 0, 6.2832); ctx.fill();
  // body
  const body = ctx.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.2, x, y, r);
  body.addColorStop(0, `rgba(143,240,200,${alpha})`); body.addColorStop(0.65, `rgba(43,169,128,${alpha})`); body.addColorStop(1, `rgba(17,97,79,${alpha})`);
  ctx.fillStyle = body; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
  // membrane
  ctx.strokeStyle = damaged ? `rgba(255,120,120,${0.9 * alpha})` : `rgba(180,255,225,${0.7 * alpha})`;
  ctx.lineWidth = 1.2; ctx.stroke();
  // nucleus
  ctx.fillStyle = `rgba(18,64,58,${0.6 * alpha})`;
  ctx.beginPath(); ctx.arc(x + Math.cos(c.nuc) * r * 0.25, y + Math.sin(c.nuc) * r * 0.2, r * 0.34, 0, 6.2832); ctx.fill();
}

function updateImmune(im, cx, cy, clusterR, alarm, fix, ending, ep, time) {
  // target: a jittered point near the colony
  const tx = cx + Math.cos(time * 0.5 + im.phase) * clusterR * 0.6;
  const ty = cy + Math.sin(time * 0.6 + im.phase) * clusterR * 0.6;
  let seek = 0.012 + alarm * 0.02;
  if (ending && (ending.kind === "cleared" || ending.kind === "host")) seek += ep * 0.06;
  im.vx += (tx - im.x) * seek + Math.cos(time + im.phase) * 0.12;
  im.vy += (ty - im.y) * seek + Math.sin(time * 1.1 + im.phase) * 0.12;
  // lunge
  const lt = now() - im.lungeT;
  if (lt >= 0 && lt < 0.5) { const k = Math.sin(lt / 0.5 * Math.PI); im.x += (tx - im.x) * 0.10 * k; im.y += (ty - im.y) * 0.10 * k; }
  im.vx *= 0.86; im.vy *= 0.86;
  im.x += im.vx; im.y += im.vy;
  // trail
  im.trail.push([im.x, im.y]); if (im.trail.length > 6) im.trail.shift();
  for (let i = 0; i < im.trail.length; i++) {
    const a = (i / im.trail.length) * 0.12;
    ctx.beginPath(); ctx.arc(im.trail[i][0], im.trail[i][1], 5, 0, 6.2832);
    ctx.fillStyle = `rgba(210,240,255,${a})`; ctx.fill();
  }
  drawImmune(im, 6 + alarm * 2, time, Math.atan2(cy - im.y, cx - im.x));
}

function drawImmune(im, r, t, rot) {
  ctx.save(); ctx.translate(im.x, im.y);
  // blobby wobbly body
  ctx.beginPath();
  const pts = 14;
  for (let i = 0; i <= pts; i++) {
    const a = i / pts * 6.2832;
    const wob = 1 + Math.sin(a * 3 + t * 1.5 + im.phase) * 0.10 + Math.sin(a * 7 - t) * 0.05;
    const rr = r * wob, x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = "rgba(216,240,255,0.80)"; ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 1; ctx.stroke();
  // a couple of pseudopods toward the colony
  ctx.rotate(rot);
  ctx.strokeStyle = "rgba(216,240,255,0.55)"; ctx.lineWidth = 1.4;
  for (let k = -1; k <= 1; k += 2) {
    ctx.beginPath(); ctx.moveTo(0, k * r * 0.4);
    ctx.quadraticCurveTo(r * 1.2, k * r * 0.2, r * 1.8 + Math.sin(t * 3 + k) * 2, 0);
    ctx.stroke();
  }
  // dark nucleus
  ctx.rotate(-rot);
  ctx.beginPath(); ctx.arc(0, 0, r * 0.4, 0, 6.2832); ctx.fillStyle = "rgba(70,110,140,0.6)"; ctx.fill();
  ctx.restore();
}

function drawWindow(cx, cy, ending, ep, time) {
  const gx = W - 12;
  const glow = 0.5 + Math.sin(time * 3) * 0.22 + (ending && ending.kind === "win" ? ep * 0.6 : 0);
  const grad = ctx.createLinearGradient(gx - 56, 0, gx, 0);
  grad.addColorStop(0, "rgba(75,220,170,0)"); grad.addColorStop(1, `rgba(75,220,170,${0.14 + 0.22 * glow})`);
  ctx.fillStyle = grad; ctx.fillRect(gx - 56, 6, 56, H - 12);
  ctx.strokeStyle = `rgba(120,240,200,${0.6 + glow * 0.3})`; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(gx - 3, 12); ctx.lineTo(gx - 3, H - 12); ctx.stroke();
}

function drawFlatline(ep) {
  const y = H * 0.5, prog = clamp((ep - 0.55) / 0.45, 0, 1), x = prog * W;
  ctx.strokeStyle = "rgba(120,255,180,0.7)"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, y);
  for (let i = 0; i < x; i += 4) {
    let yy = y;
    if (i > x - 40 && i < x - 20) yy = y - 22 * Math.sin((i - (x - 40)) / 20 * Math.PI);
    ctx.lineTo(i, yy);
  }
  ctx.stroke();
}

function drawParticles() {
  const t = now();
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]; const age = t - p.t0;
    if (age > p.life) { particles.splice(i, 1); continue; }
    const k = age / p.life, x = p.x + p.vx * age, y = p.y + p.vy * age;
    ctx.beginPath(); ctx.arc(x, y, 2.4 * (1 - k), 0, 6.2832);
    ctx.fillStyle = p.cp + (0.8 * (1 - k)) + ")"; ctx.fill();
  }
}

function roundRectPath(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
