// fx.js — lightweight animation helpers: count-up numbers + particle bursts.
// Pure browser module, no engine dependency. Honors prefers-reduced-motion.

function reduced() {
  try { return matchMedia("(prefers-reduced-motion: reduce)").matches; }
  catch { return false; }
}

// Animate el's text from its previous numeric value to `to`.
export function countUp(el, to, { decimals = 0, ms = 340 } = {}) {
  if (!el) return;
  const from = parseFloat(el.dataset.v ?? el.textContent) || 0;
  el.dataset.v = String(to);
  if (reduced() || ms <= 0 || Math.abs(to - from) < 0.05) {
    el.textContent = to.toFixed(decimals);
    return;
  }
  const t0 = performance.now();
  const tick = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3); // easeOutCubic
    el.textContent = (from + (to - from) * e).toFixed(decimals);
    if (k < 1) requestAnimationFrame(tick);
    else el.textContent = to.toFixed(decimals);
  };
  requestAnimationFrame(tick);
}

let styleInjected = false;
function ensureStyle() {
  if (styleInjected || typeof document === "undefined") return;
  styleInjected = true;
  const s = document.createElement("style");
  s.id = "fx-styles";
  s.textContent =
    ".fx-particle{position:fixed;width:7px;height:7px;border-radius:50%;" +
    "pointer-events:none;z-index:60;will-change:transform,opacity;}" +
    "@keyframes fx-fly{to{transform:translate(var(--dx),var(--dy)) scale(.25);opacity:0;}}";
  document.head.appendChild(s);
}

// Spawn a short particle burst from the centre of originEl.
export function burst(originEl, { count = 12, color = "var(--accent)", spread = 46 } = {}) {
  if (!originEl || reduced() || typeof document === "undefined") return;
  ensureStyle();
  const r = originEl.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  for (let i = 0; i < count; i++) {
    const p = document.createElement("div");
    p.className = "fx-particle";
    p.style.left = cx + "px";
    p.style.top = cy + "px";
    p.style.background = color;
    const ang = Math.random() * Math.PI * 2;
    const dist = spread * (0.5 + Math.random());
    p.style.setProperty("--dx", Math.cos(ang) * dist + "px");
    p.style.setProperty("--dy", Math.sin(ang) * dist + "px");
    p.style.animation = `fx-fly ${380 + Math.random() * 320}ms ease-out forwards`;
    document.body.appendChild(p);
    p.addEventListener("animationend", () => p.remove());
  }
}
