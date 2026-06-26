// juice.js — flat impact feedback (flash / shake / number-pop).
// Self-contained ES module. Imports only from ./engine.js (none needed here —
// these helpers are pure DOM, with no game logic, so balance can never drift).
// All visuals are flat: a brief soft-color background pulse, a short transform
// shake, and a small floating number. No neon, no glow, no heavy shadow.

// --- one-time CSS injection -------------------------------------------------

const STYLE_ID = "strain-juice-styles";

function injectStyles(){
  if (typeof document === "undefined") return;          // node --check / SSR safe
  if (document.getElementById(STYLE_ID)) return;        // inject exactly once

  const css = `
@keyframes strain-flash {
  0%   { background-color: var(--flash-soft); }
  100% { background-color: transparent; }
}
@keyframes strain-shake {
  0%, 100% { transform: translateX(0); }
  20%      { transform: translateX(-4px); }
  40%      { transform: translateX(4px); }
  60%      { transform: translateX(-3px); }
  80%      { transform: translateX(2px); }
}
@keyframes strain-pop {
  0%   { opacity: 0; transform: translate(-50%, 0); }
  15%  { opacity: 1; }
  100% { opacity: 0; transform: translate(-50%, -22px); }
}
.strain-flash {
  animation: strain-flash 420ms ease-out;
}
.strain-flash--accent  { --flash-soft: var(--accent-soft); }
.strain-flash--danger  { --flash-soft: var(--danger-soft); }
.strain-flash--success { --flash-soft: var(--success-soft); }
.strain-shake {
  animation: strain-shake 320ms ease-in-out;
}
.strain-pop {
  position: absolute;
  left: 50%;
  top: 0;
  transform: translate(-50%, 0);
  pointer-events: none;
  font: 600 14px var(--mono, ui-monospace, monospace);
  white-space: nowrap;
  z-index: 5;
  animation: strain-pop 900ms ease-out forwards;
}
.strain-pop--accent  { color: var(--accent); }
.strain-pop--danger  { color: var(--danger); }
.strain-pop--success { color: var(--success); }
@media (prefers-reduced-motion: reduce) {
  .strain-flash, .strain-shake, .strain-pop { animation-duration: 1ms; }
}
`;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
}

injectStyles();

// --- helpers ----------------------------------------------------------------

const FLASH_TYPES = new Set(["accent", "danger", "success"]);
const POP_TYPES = new Set(["accent", "danger", "success"]);

function restartAnimation(el, className){
  // Remove then re-add so a repeated call re-triggers the animation.
  el.classList.remove(className);
  void el.offsetWidth; // force reflow so the next add restarts the keyframes
  el.classList.add(className);
}

/**
 * Brief flat background pulse on an element.
 * @param {HTMLElement} el
 * @param {"accent"|"danger"|"success"} type
 */
export function flash(el, type = "accent"){
  if (!el || !el.classList) return;
  const t = FLASH_TYPES.has(type) ? type : "accent";
  const variant = `strain-flash--${t}`;

  // clear any prior variant so colors never stack
  el.classList.remove("strain-flash--accent", "strain-flash--danger", "strain-flash--success");
  el.classList.add(variant);
  restartAnimation(el, "strain-flash");

  el.addEventListener("animationend", function done(){
    el.removeEventListener("animationend", done);
    el.classList.remove("strain-flash", variant);
  });
}

/**
 * Short horizontal transform shake.
 * @param {HTMLElement} el
 */
export function shake(el){
  if (!el || !el.classList) return;
  restartAnimation(el, "strain-shake");

  el.addEventListener("animationend", function done(){
    el.removeEventListener("animationend", done);
    el.classList.remove("strain-shake");
  });
}

/**
 * Small floating +/- number that rises and fades.
 * The number is appended to `el`, which should be positioned (the helper sets
 * position:relative on `el` if it is currently static so absolute placement works).
 * @param {HTMLElement} el     anchor element
 * @param {string} text        e.g. "+12.4" or "−8"
 * @param {"accent"|"danger"|"success"} type
 */
export function popNumber(el, text, type = "accent"){
  if (!el || typeof document === "undefined") return;
  const t = POP_TYPES.has(type) ? type : "accent";

  // ensure the anchor can host an absolutely-positioned child
  const pos = getComputedStyle(el).position;
  if (pos === "static") el.style.position = "relative";

  const node = document.createElement("span");
  node.className = `strain-pop strain-pop--${t}`;
  node.textContent = String(text);
  el.appendChild(node);

  node.addEventListener("animationend", function done(){
    node.removeEventListener("animationend", done);
    if (node.parentNode) node.parentNode.removeChild(node);
  });
}
