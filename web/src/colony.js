// colony.js — living, continuously-animated colony canvas.
//   mountColony(canvas)        start the render loop
//   updateColony(state, build) feed the latest game state (display eases toward it)
//   stopColony()               cancel the loop (call when leaving the play screen)
//
// Pure presentation. Reads palette tokens from CSS. Honors prefers-reduced-motion.

const GOLDEN = 2.399963229; // golden angle, for even cell packing

let cv = null, ctx = null, raf = null, dpr = 1;
let target = null;          // latest { state, build }
let disp = { load: 10, lock: 0, host: 100, window: 0 }; // eased display values
let cells = [];             // persistent cell slots (seeded jitter/phase)
let sentinels = [];         // persistent immune slots
let palette = null;
let t0 = 0;

function reduced() {
  try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

function hexToRgb(hex) {
  const m = (hex || "").trim().replace("#", "");
  if (m.length < 6) return [120, 120, 120];
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
}
function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const get = (n) => cs.getPropertyValue(n);
  return {
    accent: hexToRgb(get("--accent")),
    danger: hexToRgb(get("--danger")),
    warning: hexToRgb(get("--warning")),
    success: hexToRgb(get("--success")),
    surface2: (get("--surface-2") || "#eef2f6").trim(),
    border: (get("--border") || "#dbe3ea").trim(),
    muted: hexToRgb(get("--text-muted")),
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
}

function ensureCells(n) {
  while (cells.length < n) {
    cells.push({ seed: Math.random() * 6.28, sp: 0.6 + Math.random() * 0.9, jr: Math.random() });
  }
}
function ensureSentinels(n) {
  while (sentinels.length < n) {
    sentinels.push({ edge: Math.random(), drift: Math.random() * 6.28, sp: 0.3 + Math.random() * 0.5 });
  }
}

export function mountColony(canvas) {
  if (!canvas || !canvas.getContext) return;
  cv = canvas; ctx = canvas.getContext("2d");
  palette = readPalette();
  disp = { load: 10, lock: 0, host: 100, window: 0 };
  cells = []; sentinels = [];
  t0 = performance.now();
  resize();
  if (raf) cancelAnimationFrame(raf);
  if (reduced()) { draw(0); return; }     // single static frame
  const loop = (now) => { draw((now - t0) / 1000); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
}

export function updateColony(state, build) {
  target = { state, build };
  if (reduced()) {
    disp = { load: state.colony_load, lock: state.immune_lockon, host: state.host_stability, window: state.transmission_window };
    draw(0);
  }
}

export function stopColony() {
  if (raf) cancelAnimationFrame(raf);
  raf = null; cv = null; ctx = null; target = null;
}

function draw(time) {
  if (!ctx || !cv) return;
  const w = cv.clientWidth || 680, h = cv.clientHeight || 220;
  const cx = w * 0.42, cy = h * 0.5;

  if (target) {
    const s = target.state;
    disp.load = lerp(disp.load, s.colony_load, 0.08);
    disp.lock = lerp(disp.lock, s.immune_lockon, 0.10);
    disp.host = lerp(disp.host, s.host_stability, 0.10);
    disp.window = s.transmission_window;
  }
  const alarm = Math.max(0, Math.min(1, disp.lock / 100));

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = palette.surface2;
  roundRect(ctx, 0, 0, w, h, 12); ctx.fill();
  if (alarm > 0.02) {
    ctx.fillStyle = rgba(palette.danger, 0.05 + alarm * 0.10);
    roundRect(ctx, 0, 0, w, h, 12); ctx.fill();
  }

  const tint = mix(palette.accent, palette.danger, alarm * 0.65);

  const n = Math.max(5, Math.min(70, Math.round(disp.load / 2.4)));
  ensureCells(n);
  const clusterR = 14 + Math.sqrt(n) * 7.2;

  ctx.beginPath();
  ctx.arc(cx, cy, clusterR + 12, 0, 6.2832);
  ctx.fillStyle = rgba(tint, 0.08);
  ctx.fill();

  for (let i = 0; i < n; i++) {
    const c = cells[i];
    const ang = i * GOLDEN;
    const rad = clusterR * Math.sqrt(i / n);
    const pulse = reduced() ? 0 : Math.sin(time * c.sp + c.seed) * 1.6;
    const jx = reduced() ? 0 : Math.cos(time * 0.7 + c.seed) * (0.6 + c.jr);
    const jy = reduced() ? 0 : Math.sin(time * 0.9 + c.seed) * (0.6 + c.jr);
    const x = cx + Math.cos(ang) * rad + jx;
    const y = cy + Math.sin(ang) * rad + jy;
    const r = 3.4 + pulse;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 6.2832);
    ctx.fillStyle = rgba(tint, 0.85);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r + 1.2, 0, 6.2832);
    ctx.strokeStyle = rgba(tint, 0.25);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  const sn = Math.max(0, Math.min(6, Math.round(disp.lock / 17)));
  ensureSentinels(sn);
  for (let i = 0; i < sn; i++) {
    const s = sentinels[i];
    const baseAng = s.edge * 6.2832 + time * s.sp * 0.15;
    const far = Math.max(w, h) * 0.52;
    const near = clusterR + 26;
    const d = lerp(far, near, 0.25 + alarm * 0.7) + (reduced() ? 0 : Math.sin(time * s.sp + s.drift) * 6);
    const x = cx + Math.cos(baseAng) * d;
    const y = cy + Math.sin(baseAng) * d * 0.7;
    drawSentinel(x, y, baseAng + Math.PI, 5 + alarm * 2);
  }

  if (disp.window > 0) {
    const gx = w - 14;
    const glow = 0.45 + (reduced() ? 0 : Math.sin(time * 3) * 0.25);
    const grad = ctx.createLinearGradient(gx - 40, 0, gx, 0);
    grad.addColorStop(0, rgba(palette.success, 0));
    grad.addColorStop(1, rgba(palette.success, 0.22 * glow + 0.12));
    ctx.fillStyle = grad;
    ctx.fillRect(gx - 40, 8, 40, h - 16);
    ctx.strokeStyle = rgba(palette.success, 0.55 + glow * 0.25);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(gx - 3, 14); ctx.lineTo(gx - 3, h - 14);
    ctx.stroke();
  }
}

function drawSentinel(x, y, rot, size) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot);
  ctx.strokeStyle = rgba(palette.warning, 0.85);
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(-size, -size); ctx.lineTo(size, 0); ctx.lineTo(-size, size);
  ctx.stroke();
  ctx.restore();
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
