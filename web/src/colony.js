// colony.js — canvas visualization of the living colony + immune presence.
//
// Self-contained ES module. Imports ONLY from ./engine.js.
//
// Contract (§Module contracts):
//   mountColony(canvasEl)          → bind to a <canvas>, prep the 2d context.
//   updateColony(state, build)     → redraw for the current engine state:
//       - N clustered colony cells scaling with colony_load (vs COL_VIS),
//       - immune sentinels scaling with immune_lockon, closing in from the edges,
//       - a soft window glow when transmission_window > 0.
//
// Flat clinical colors are pulled from the CSS palette tokens at draw time so the
// canvas matches the sci-viz theme. No animation loop, no game logic here — the
// orchestrator calls updateColony() once per turn, so balance can never drift.

import { COL_VIS, CARRY } from "./engine.js";

// Module-private binding to the active canvas + its 2d context.
let canvas = null;
let ctx = null;

// Deterministic pseudo-random so the same load always lays out the same cluster
// (a stable picture per turn, not a jittery reshuffle on every redraw).
function rng(seed) {
  let s = seed >>> 0;
  return function next() {
    // xorshift32 — cheap, deterministic, good enough for dot scatter.
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return (s >>> 0) / 4294967296;
  };
}

// Read a palette token from :root so colors track the theme. Falls back to a
// sensible literal when computed styles are unavailable (e.g. node --check).
function token(name, fallback) {
  try {
    if (typeof getComputedStyle === "undefined" || !document.documentElement) {
      return fallback;
    }
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Bind the visualization to a canvas element.
 * @param {HTMLCanvasElement} canvasEl
 */
export function mountColony(canvasEl) {
  canvas = canvasEl || null;
  ctx = canvas && canvas.getContext ? canvas.getContext("2d") : null;
  if (ctx) {
    // Clear to the surface color so the first frame is not a transparent void.
    paintBackground();
  }
}

function paintBackground() {
  if (!ctx || !canvas) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = token("--surface-2", "#eef2f6");
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

/**
 * Redraw the colony for the current state.
 * @param {object} state  engine state (colony_load, immune_lockon, transmission_window)
 * @param {object} build  genome (used only for a subtle hue cue; no logic)
 */
export function updateColony(state, build) {
  if (!ctx || !canvas || !state) return;

  const W = canvas.width;
  const H = canvas.height;

  paintBackground();

  // --- soft window glow (drawn first, under the cells) ----------------------
  if (state.transmission_window > 0) {
    drawWindowGlow(W, H, state.transmission_window);
  }

  // --- colony cells ---------------------------------------------------------
  // Cell count scales with load against the visible ceiling, capped so a huge
  // colony stays legible. Clustered around centre with deterministic scatter.
  const loadFrac = clamp01(state.colony_load / COL_VIS);
  const cells = Math.round(6 + loadFrac * 90); // 6..~96 dots
  drawColony(W, H, cells, state.colony_load);

  // --- immune sentinels closing in -----------------------------------------
  // More lock-on → more sentinels, drawn nearer the centre (the squeeze).
  const lockFrac = clamp01(state.immune_lockon / 100);
  const sentinels = Math.round(lockFrac * 14); // 0..14
  drawSentinels(W, H, sentinels, lockFrac);
}

function drawWindowGlow(W, H, windowTurns) {
  // A soft radial accent wash, brighter while more window turns remain.
  const cx = W / 2;
  const cy = H / 2;
  const r = Math.max(W, H) * 0.6;
  const alpha = 0.10 + 0.06 * Math.min(3, windowTurns);
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  const accent = token("--accent", "#0ea5a5");
  grad.addColorStop(0, withAlpha(accent, alpha));
  grad.addColorStop(1, withAlpha(accent, 0));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
}

function drawColony(W, H, count, load) {
  const cx = W / 2;
  const cy = H / 2;
  // Cluster radius grows gently with load so a fuller colony spreads out.
  const spread = Math.min(W, H) * 0.42 * clamp01(0.3 + load / CARRY);
  const rand = rng(0x57a1 ^ count); // stable layout for this cell count
  const fill = token("--accent", "#0ea5a5");
  const ring = token("--accent-soft", "#d7f2f0");

  for (let i = 0; i < count; i++) {
    // Gaussian-ish clustering via two uniform samples pulled toward centre.
    const a = rand() * Math.PI * 2;
    const rr = Math.pow(rand(), 0.6) * spread; // bias toward centre
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr * 0.62; // squashed so it reads as a colony mat
    const dot = 2.4 + rand() * 1.8;

    ctx.beginPath();
    ctx.arc(x, y, dot + 1, 0, Math.PI * 2);
    ctx.fillStyle = ring;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, dot, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  }
}

function drawSentinels(W, H, count, lockFrac) {
  if (count <= 0) return;
  const cx = W / 2;
  const cy = H / 2;
  const danger = token("--danger", "#e5484d");
  const warning = token("--warning", "#c8810a");
  // Higher lock-on tints sentinels from warning toward danger and pulls them in.
  const color = lockFrac >= 0.6 ? danger : warning;
  const rand = rng(0xa11ce5 ^ (count * 2654435761));

  // Sentinels ring the colony, edging inward as lock-on rises.
  const ringR = Math.min(W, H) * (0.62 - 0.30 * lockFrac);

  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rand() * 0.3;
    const jitter = 0.85 + rand() * 0.3;
    const x = cx + Math.cos(a) * ringR * jitter;
    const y = cy + Math.sin(a) * ringR * jitter * 0.62;

    // A small hollow chevron-ish marker: a stroked triangle pointing inward.
    const size = 5;
    const toC = Math.atan2(cy - y, cx - x);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(toC);
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.7, size * 0.7);
    ctx.lineTo(-size * 0.7, -size * 0.7);
    ctx.closePath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  }
}

// --- small color helpers ----------------------------------------------------

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

// Apply an alpha to a hex color (#rgb / #rrggbb) → rgba(). Non-hex passes through
// with a leading rgba() best-effort; falls back to the accent on any failure.
function withAlpha(color, alpha) {
  const a = Math.max(0, Math.min(1, alpha));
  const hex = parseHex(color);
  if (!hex) return color;
  return `rgba(${hex.r}, ${hex.g}, ${hex.b}, ${a})`;
}

function parseHex(color) {
  if (typeof color !== "string") return null;
  let c = color.trim();
  if (c[0] !== "#") return null;
  c = c.slice(1);
  if (c.length === 3) {
    c = c.split("").map((ch) => ch + ch).join("");
  }
  if (c.length !== 6) return null;
  const num = parseInt(c, 16);
  if (Number.isNaN(num)) return null;
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}
