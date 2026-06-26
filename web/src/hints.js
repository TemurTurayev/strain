// hints.js — contextual novice hint. Imports only from ./engine.js.
import { need, T_THRESH } from "./engine.js";

/**
 * Contextual nudge for the current state + build.
 * @param {object} state  engine state (colony_load, transmission_window, immune_lockon, ...)
 * @param {object} build  genome (virulence, stealth, adhesion, resistance)
 * @returns {{icon:string, text:string}} Tabler outline icon name + sentence-case nudge.
 */
export function hint(state, build) {
  const eff = state.colony_load * (0.5 + build.adhesion / 10);
  const windowOpen = state.transmission_window > 0;

  if (windowOpen && eff >= T_THRESH) {
    return { icon: "ti-arrow-right", text: "Window is open and your load is high enough — transmit now." };
  }
  if (windowOpen) {
    return { icon: "ti-hourglass", text: "Window is open but your load is too low — it will fail. Grow or wait." };
  }
  if (state.colony_load >= need(build)) {
    return { icon: "ti-flame", text: "Your load is high enough — provoke to open a transmission window." };
  }
  if (state.immune_lockon >= 55) {
    return { icon: "ti-shield-half", text: "Immune lock-on is climbing — suppress to cool it down." };
  }
  if (state.colony_load < need(build)) {
    return { icon: "ti-bacteria", text: "Load is still too low — keep replicating." };
  }
  return { icon: "ti-trending-up", text: "Grow your colony, then break out to a new host." };
}
