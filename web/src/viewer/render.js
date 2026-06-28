// render.js — Canvas-2D draw of one interpolated frame on the tissue graph.
// Reads alpha-interpolated frames from the controller; never owns the clock.
// Static layers (vignette gradient, starfield, edges) are cached on an offscreen
// canvas like colony.js's bgCanvas; only dynamic layers redraw each frame.
import { EDGES, zoneCenter, isExit, fitToCanvas } from "./graph.js?v=1";
import { ZONE_KEYS } from "./replay.js?v=1";

const ZONE_LABEL = { gut: "GUT", blood: "BLOOD", lung: "LUNG", lymph: "LYMPH" };
const EXIT_THRESH = { gut: 70, lung: 65 };

export function mountViewer(canvas) {
  let { W, H, dpr } = fitToCanvas(canvas);
  const ctx = canvas.getContext("2d");
  let bg = null;
  let theme = {};
  let particles = [];
  let lastFrame = null;

  const R = () => Math.max(34, Math.min(W, H) * 0.13); // node radius scales to canvas

  function buildBg() {
    bg = document.createElement("canvas");
    bg.width = canvas.width; bg.height = canvas.height;
    const b = bg.getContext("2d");
    b.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = b.createRadialGradient(W / 2, H / 2, 30, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, theme.bgInner || "#16212b");
    g.addColorStop(1, theme.bgOuter || "#080b10");
    b.fillStyle = g; b.fillRect(0, 0, W, H);
    b.fillStyle = "rgba(255,255,255,0.5)";
    for (let i = 0; i < 240; i++) { b.globalAlpha = Math.random() * 0.04; b.fillRect(Math.random() * W, Math.random() * H, 1, 1); }
    b.globalAlpha = 1;
    b.lineWidth = 2; b.strokeStyle = "rgba(150,180,200,0.18)";
    for (const e of EDGES) { const a = zoneCenter(e.a), c = zoneCenter(e.b); b.beginPath(); b.moveTo(a.x, a.y); b.lineTo(c.x, c.y); b.stroke(); }
  }

  function resize() { const d = fitToCanvas(canvas); W = d.W; H = d.H; dpr = d.dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); buildBg(); }

  function draw(frame, events, th) {
    if (th && th !== theme) { theme = th; bg = null; }
    if (!bg) buildBg();
    const t = nowMotion();
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bg, 0, 0, W, H);
    if (!frame) return;
    lastFrame = frame;

    const integ = frame.host?.integrity ?? 100, toxin = frame.host?.toxin ?? 0;
    if (integ < 100) { ctx.fillStyle = `rgba(200,40,46,${(1 - integ / 100) * 0.22})`; ctx.fillRect(0, 0, W, H); }
    if (toxin > 0) { ctx.fillStyle = `rgba(120,210,120,${(toxin / 100) * 0.22})`; ctx.fillRect(0, 0, W, H); }

    const cols = frame.colonies || {};
    const meta = theme.factionColors || {};
    const r = R();

    for (const z of ZONE_KEYS) {
      const c = zoneCenter(z); if (!c.x && !c.y) continue;
      const zone = (frame.zones || {})[z] || {};
      const gluc = Math.min(1, (zone.glucose ?? 50) / 100), iron = Math.min(1, (zone.iron ?? 30) / 100);
      const grad = ctx.createRadialGradient(c.x, c.y, 4, c.x, c.y, r);
      grad.addColorStop(0, `rgba(${40 + iron * 120}, ${70 + gluc * 130}, 70, 0.95)`);
      grad.addColorStop(1, `rgba(${30 + iron * 80}, ${50 + gluc * 90}, 60, 0.5)`);
      ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, 7); ctx.fillStyle = grad; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = "rgba(220,235,245,0.35)"; ctx.stroke();

      if ((zone.inflammation || 0) > 4) { ctx.fillStyle = `rgba(255,110,60,${Math.min(0.4, zone.inflammation / 120)})`; ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, 7); ctx.fill(); }
      if ((zone.fibrosis || 0) > 1) { ctx.strokeStyle = `rgba(200,205,210,${Math.min(0.6, zone.fibrosis / 50)})`; ctx.lineWidth = 1; for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(c.x - r * 0.6, c.y + k * 9); ctx.lineTo(c.x + r * 0.55, c.y + k * 9 + 7); ctx.stroke(); } }
      if (zone.contained || zone.containTimer > 0) { ctx.setLineDash([5, 5]); ctx.strokeStyle = "rgba(210,210,220,0.8)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(c.x, c.y, r + 3, 0, 7); ctx.stroke(); ctx.setLineDash([]); }

      let heat = 0; for (const id in cols) if ((cols[id].presence || {})[z] > 0.5) heat += cols[id].lock || 0;
      if (heat > 4) { ctx.beginPath(); ctx.arc(c.x, c.y, r + 5, 0, 7); ctx.lineWidth = 3; ctx.strokeStyle = `rgba(255,60,60,${Math.min(0.85, heat / 160)})`; ctx.stroke(); }

      if (isExit(z)) {
        const thr = ((theme.config && theme.config.EXIT_THRESH) || EXIT_THRESH)[z] || 70;
        let ratio = 0; for (const id in cols) ratio = Math.max(ratio, ((cols[id].presence || {})[z] || 0) / thr);
        const rr = r + 9 + (ratio >= 0.6 ? Math.sin(t * 5) * 3 * ratio : 0);
        ctx.beginPath(); ctx.arc(c.x, c.y, rr, 0, 7); ctx.lineWidth = ratio >= 0.6 ? 3 : 2;
        ctx.strokeStyle = ratio >= 0.6 ? `rgba(255,70,70,${0.45 + ratio * 0.4})` : "rgba(120,220,160,0.6)"; ctx.stroke();
        label(ctx, `EXIT ${thr}`, c.x, c.y - r - 12, "rgba(150,230,180,0.9)", 11);
      }

      label(ctx, ZONE_LABEL[z], c.x, c.y + r + 16, "rgba(235,242,248,0.92)", 13, "600");
      label(ctx, `glu ${Math.round(zone.glucose ?? 0)} · fe ${Math.round(zone.iron ?? 0)}`, c.x, c.y + r + 31, "rgba(180,195,205,0.7)", 10);
    }

    for (const z of ZONE_KEYS) {
      const c = zoneCenter(z); if (!c.x && !c.y) continue;
      const present = Object.keys(cols).filter((id) => ((cols[id].presence || {})[z] || 0) > 0.5);
      present.forEach((id, i) => {
        const col = cols[id]; const p = col.presence[z];
        const baseR = Math.sqrt(p) * 3.4; const blobR = Math.min(baseR, r * 0.62); const capped = baseR > r * 0.62;
        const ang = present.length > 1 ? (i / present.length) * 6.283 - 1.57 : 0;
        const off = present.length > 1 ? r * 0.42 : 0;
        const bx = c.x + Math.cos(ang) * off, by = c.y + Math.sin(ang) * off;
        const base = meta[id] || "#66cccc";
        const lock = col.lock || 0;
        ctx.beginPath(); ctx.arc(bx, by, blobR, 0, 7); ctx.globalAlpha = 0.9; ctx.fillStyle = base; ctx.fill(); ctx.globalAlpha = 1;
        if (lock >= 25) { ctx.lineWidth = 2; ctx.strokeStyle = `rgba(255,70,70,${Math.min(1, lock / 80)})`; ctx.stroke(); }
        if (col.transmitted) { ctx.lineWidth = 3; ctx.strokeStyle = "#fff"; ctx.stroke(); }
        // hidden reservoir (viral latency / fungal colonisation) — a faint dashed inner ring
        if ((col.reservoir || 0) > 1) { ctx.save(); ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(190,170,255,0.75)"; ctx.beginPath(); ctx.arc(bx, by, blobR * 0.55, 0, 7); ctx.stroke(); ctx.restore(); }
        const tg = { virus: "ᵥ", fungus: "f" }[col.type] || "";
        label(ctx, (capped ? `${id}·${Math.round(p)}` : id) + tg, bx, by + 3, "#0a0d12", Math.max(9, Math.min(13, blobR)), "700");
      });
    }

    drawImmuneAction(ctx, frame.actions?.immune, t, r);

    for (const e of (events || [])) {
      if (e.type === "transmit") fx({ zone: e.zone, kind: "transmit" });
      else if (e.type === "strike") fx({ zone: e.zone, kind: "strike" });
      else if (e.type === "toxin") fx({ zone: e.zone, kind: "toxin" });
    }
    stepParticles(ctx);

    drawHud(ctx, frame, cols, meta);
  }

  function drawImmuneAction(ctx, act, t, r) {
    if (!act) return;
    const [verb, arg] = String(act).split(":");
    const zoneOf = ZONE_KEYS.includes(arg) ? arg : null;
    const c = zoneOf ? zoneCenter(zoneOf) : null;
    if (verb === "sweep" && c) { ctx.beginPath(); ctx.arc(c.x, c.y, r + 14 + Math.sin(t * 6) * 3, 0, 7); ctx.lineWidth = 3; ctx.strokeStyle = "rgba(90,200,255,0.8)"; ctx.stroke(); }
    else if (verb === "contain" && c) { ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.arc(c.x, c.y, r + 10, 0, 7); ctx.lineWidth = 3; ctx.strokeStyle = "rgba(230,230,120,0.9)"; ctx.stroke(); ctx.setLineDash([]); }
    else if (verb === "investigate" && c) { ctx.beginPath(); ctx.arc(c.x - 6, c.y - 6, 12, 0, 7); ctx.lineWidth = 3; ctx.strokeStyle = "rgba(255,220,120,0.9)"; ctx.stroke(); ctx.beginPath(); ctx.moveTo(c.x + 3, c.y + 3); ctx.lineTo(c.x + 14, c.y + 14); ctx.stroke(); }
    else if (verb === "tolerize") { ctx.fillStyle = "rgba(90,180,255,0.10)"; ctx.fillRect(0, 0, W, H); }
    else if ((verb === "strike" || verb === "scan") && arg && lastFrame?.colonies?.[arg]) {
      const col = lastFrame.colonies[arg];
      const z = ZONE_KEYS.reduce((b, zz) => ((col.presence || {})[zz] > (col.presence || {})[b] ? zz : b), ZONE_KEYS[0]);
      const cc = zoneCenter(z);
      if (verb === "strike") { ctx.beginPath(); ctx.arc(cc.x, cc.y, r * 0.5, 0, 7); ctx.fillStyle = "rgba(255,80,80,0.35)"; ctx.fill(); }
      else { ctx.beginPath(); ctx.arc(cc.x, cc.y, r + 8, 0, 7); ctx.lineWidth = 2; ctx.strokeStyle = "rgba(120,210,255,0.7)"; ctx.stroke(); }
    }
  }

  function drawHud(ctx, frame, cols, meta) {
    ctx.textAlign = "left";
    ctx.font = "13px ui-monospace, monospace";
    ctx.fillStyle = "rgba(235,242,248,0.92)";
    ctx.fillText(`tick ${frame.tick | 0}`, 14, 22);
    ctx.fillStyle = "rgba(180,195,205,0.8)";
    const strength = frame.host?.immune_strength;
    const hostImm = strength == null ? "" : `  immunity ${strength < 0.85 ? "weak" : strength > 1.15 ? "robust" : "healthy"}`;
    ctx.fillText(`host ${Math.round(frame.host?.integrity ?? 100)}  toxin ${Math.round(frame.host?.toxin ?? 0)}${hostImm}`, 14, 40);
    let y = 62;
    for (const id of Object.keys(cols)) {
      const col = cols[id]; if (col.transmitted) continue;
      const load = ZONE_KEYS.reduce((s, z) => s + (col.presence[z] || 0), 0);
      ctx.fillStyle = meta[id] || "#66cccc"; ctx.fillRect(14, y - 9, 11, 11);
      ctx.fillStyle = "rgba(220,230,238,0.9)";
      const resv = (col.reservoir || 0) > 1 ? `  resv ${Math.round(col.reservoir)}` : "";
      ctx.fillText(`${id} ${col.type || "bacterium"}  load ${Math.round(load)}  lock ${Math.round(col.lock || 0)}${resv}`, 30, y);
      y += 18;
    }
  }

  const FX = {
    transmit: { n: 30, col: "120,230,150", life: 0.9, sp: 90 },
    strike: { n: 16, col: "255,80,80", life: 0.6, sp: 70 },
    toxin: { n: 14, col: "190,235,120", life: 0.7, sp: 55 },
  };
  function fx(event) {
    const c = zoneCenter(event.zone || "blood"); if (!c.x && !c.y) return;
    const k = FX[event.kind] || FX.transmit;
    for (let i = 0; i < k.n; i++) { const a = Math.random() * 6.283, sp = k.sp * (0.4 + Math.random() * 0.6); particles.push({ x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t0: perfNow(), life: k.life, col: k.col }); }
  }
  function stepParticles(ctx) {
    const now = perfNow();
    for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; const age = now - p.t0; if (age > p.life) { particles.splice(i, 1); continue; } ctx.fillStyle = `rgba(${p.col},${1 - age / p.life})`; ctx.fillRect(p.x + p.vx * age, p.y + p.vy * age, 3, 3); }
  }

  function destroy() { bg = null; particles = []; }
  return { draw, fx, resize, destroy };
}

function label(ctx, text, x, y, color, size, weight = "400") {
  ctx.textAlign = "center"; ctx.font = `${weight} ${size}px system-ui, sans-serif`; ctx.fillStyle = color; ctx.fillText(text, x, y); ctx.textAlign = "left";
}
function perfNow() { try { return performance.now() / 1000; } catch { return 0; } }
function nowMotion() { try { if (matchMedia("(prefers-reduced-motion: reduce)").matches) return 0; } catch (e) {} return perfNow(); }
