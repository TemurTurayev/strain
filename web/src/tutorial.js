// tutorial.js — onboarding: first-visit gating + how-to overlay open/close.
// The intro screen and the how-to content are static markup in index.html;
// this module only governs when they show.

const SEEN_KEY = "strain.seenIntro";

export function isFirstVisit() {
  try { return !localStorage.getItem(SEEN_KEY); } catch { return false; }
}

export function markSeen() {
  try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* storage unavailable */ }
}

export function openHowTo(overlay) {
  if (!overlay) return;
  overlay.classList.add("show");
  overlay.setAttribute("aria-hidden", "false");
  const close = overlay.querySelector("[data-howto-close]");
  if (close) close.focus();
}

export function closeHowTo(overlay) {
  if (!overlay) return;
  overlay.classList.remove("show");
  overlay.setAttribute("aria-hidden", "true");
}
