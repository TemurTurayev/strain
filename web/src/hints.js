// hints.js — contextual novice hint. Imports only from ./engine.js.
import { transmitScore, transmitThreshold, needNow } from "./engine.js?v=3";

/**
 * Contextual nudge for the current state + build (host- and window-aware).
 * @param {object} state  engine state
 * @param {object} build  genome (virulence, stealth, adhesion, resistance)
 * @returns {{icon:string, text:string}} Tabler outline icon name + sentence-case nudge.
 */
export function hint(state, build) {
  const windowOpen = state.transmission_window > 0;
  const score = transmitScore(state, build);
  const thr = transmitThreshold(state);
  const needLoad = needNow(state, build);

  if (windowOpen && score >= thr) {
    return { icon: "ti-arrow-right", text: "Window is open and your load is high enough — transmit now, before it decays." };
  }
  if (windowOpen) {
    return { icon: "ti-hourglass", text: "Window is open but the score is too low — it will fail. The window weakens each turn; grow fast or re-provoke." };
  }
  if (state.colony_load >= needLoad) {
    return { icon: "ti-flame", text: "You're big enough — provoke to open a transmission window, then transmit promptly." };
  }
  if ((state.fixation || 0) >= 70) {
    return { icon: "ti-alert-triangle", text: "Immune fixation is high — you're nearly cornered. Make your move." };
  }
  if (state.immune_lockon >= 55) {
    return { icon: "ti-shield-half", text: "Immune lock-on is climbing — suppress to cool it (and slow fixation)." };
  }
  if (state.colony_load < needLoad) {
    return { icon: "ti-bacteria", text: "Load is still too low — keep replicating." };
  }
  return { icon: "ti-trending-up", text: "Grow your colony, then break out to a new host." };
}
