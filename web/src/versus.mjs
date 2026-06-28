// versus.mjs — the two-sided (Colony vs Immune) mode. Simultaneous ticks, one
// protocol for both sides: observeVersus(state, side) -> action, applied by
// resolveTick(state, colonyAction, immuneAction). Solo's NPC immune is just the
// default immune policy here. Kept SEPARATE from the polished single-player
// engine so that one stays untouched.
//
// Design from the Consilium council: the immune side buys information & control
// at the cost of inflammation, energy, and host health; killing the host is a
// mutual loss, so neither side wants it.

export const WINDOW_THRESHOLD = 26;   // transmission_window needed to transmit
export const LOAD_THRESHOLD = 40;     // colony_load needed to transmit
export const MAX_TICKS = 80;
const CARRY = 300;

export const COLONY_ACTIONS = ["replicate", "suppress", "provoke", "transmit"];
export const IMMUNE_ACTIONS = ["scan", "contain", "strike", "fever", "tolerize"];

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function freshVersus(build) {
  return {
    tick: 0,
    colony_load: 12,
    host_stability: 100,
    immune_lockon: 8,
    immune_fixation: 0,
    inflammation: 5,
    transmission_window: 0,
    immune_energy: 5,
    transmitted: false,
    growthMod: 1,            // applied to this tick's replicate, set by last tick's immune action
    nextGrowthMod: 1,
    last_colony_action: null,
    last_immune_action: null,
    build: build || { virulence: 5, stealth: 5, adhesion: 5, resistance: 5 },
    outcome: null,           // set by resolveTick on a terminal tick
  };
}

// ---- the public observation (same shape for both sides) -------------------
export function observeVersus(state, side) {
  const s = state;
  return {
    tick: s.tick,
    side,
    colony_load: +s.colony_load.toFixed(1),
    host_stability: +s.host_stability.toFixed(1),
    immune_lockon: +s.immune_lockon.toFixed(1),
    immune_fixation: +s.immune_fixation.toFixed(1),
    inflammation: +s.inflammation.toFixed(1),
    transmission_window: +s.transmission_window.toFixed(1),
    immune_energy: +s.immune_energy.toFixed(1),
    window_threshold: WINDOW_THRESHOLD,
    load_threshold: LOAD_THRESHOLD,
    genome: { ...s.build },
    last_colony_action: s.last_colony_action,
    last_immune_action: s.last_immune_action,
    legal_actions: side === "immune" ? IMMUNE_ACTIONS : COLONY_ACTIONS,
  };
}

// ---- one simultaneous tick ------------------------------------------------
export function resolveTick(state, colonyAction, immuneAction) {
  const s = { ...state };
  const b = s.build;
  const v = b.virulence / 10, se = b.stealth / 10, a = b.adhesion / 10, r = b.resistance / 10;
  const log = [];

  if (!COLONY_ACTIONS.includes(colonyAction)) colonyAction = "replicate";
  if (!IMMUNE_ACTIONS.includes(immuneAction)) immuneAction = "scan";

  // affordability: an immune action that costs more energy than available is
  // downgraded to scan (except contain, which has a weakened version).
  const cost = { scan: 0, contain: 3, strike: 3, fever: 4, tolerize: 0 }[immuneAction];
  let weakContain = false;
  if (s.immune_energy < cost) {
    if (immuneAction === "contain") weakContain = true;
    else immuneAction = "scan";
  }

  s.growthMod = s.nextGrowthMod || 1;
  s.nextGrowthMod = 1;
  let transmitAttempt = false;

  // ---- 2. colony action ----
  if (colonyAction === "replicate") {
    const cap = Math.max(0, 1 - s.colony_load / CARRY);
    const g = s.colony_load * 0.31 * (0.5 + v) * cap * s.growthMod;
    s.colony_load += g; s.inflammation += 2.5 * (0.5 + v) * (1 - 0.6 * se);
    s.immune_fixation += 0.4 * (1 - 0.4 * se); // cost of visibility (stealth dampens)
    log.push(`colony replicate +${g.toFixed(1)}`);
  } else if (colonyAction === "suppress") {
    s.inflammation *= 0.45; s.immune_lockon = Math.max(0, s.immune_lockon - 3 * (0.5 + se));
    log.push("colony suppress");
  } else if (colonyAction === "provoke") {
    s.transmission_window += 36; s.host_stability -= 3.5 * (0.5 + v); s.inflammation += 6 * (0.5 + v);
    s.immune_fixation += 1.8; // provoking is loud — it advances the immune clock
    log.push("colony provoke (window +36)");
  } else if (colonyAction === "transmit") {
    transmitAttempt = true;
  }

  // ---- 3. immune action ----
  if (immuneAction === "scan") {
    s.immune_lockon += 5 + s.colony_load * 0.035; s.immune_fixation += 1 + s.immune_lockon * 0.015;
    s.inflammation += 1; s.immune_energy += 2;
    log.push("immune scan");
  } else if (immuneAction === "contain") {
    const wcut = weakContain ? 10 : 22 + s.immune_lockon * 0.10;
    s.transmission_window = Math.max(0, s.transmission_window - wcut);
    s.nextGrowthMod *= weakContain ? 0.85 : 0.65;
    s.immune_fixation += 3; s.inflammation += 3; if (!weakContain) s.immune_energy -= 3;
    log.push(`immune contain (window −${wcut.toFixed(1)})`);
  } else if (immuneAction === "strike") {
    if (s.immune_lockon >= 30) {
      const dmg = 4 + s.immune_lockon * 0.12 + s.immune_fixation * 0.05;
      s.colony_load = Math.max(0, s.colony_load - dmg); s.host_stability -= 2 + s.inflammation * 0.025;
      s.inflammation += 7; s.immune_fixation += 2;
      log.push(`immune strike −${dmg.toFixed(1)}`);
    } else {
      s.colony_load = Math.max(0, s.colony_load - 4); s.host_stability -= 5; s.inflammation += 10;
      log.push("immune strike (miss, host hurt)");
    }
    s.immune_energy -= 3;
  } else if (immuneAction === "fever") {
    s.colony_load = Math.max(0, s.colony_load - (8 + s.inflammation * 0.06));
    s.transmission_window = Math.max(0, s.transmission_window - 25);
    s.immune_lockon += 6; s.immune_fixation += 4; s.host_stability -= 7; s.inflammation += 14; s.immune_energy -= 4;
    if (s.inflammation > 70) s.host_stability -= 4;
    if (s.host_stability < 35) s.host_stability -= 3;
    log.push("immune FEVER");
  } else if (immuneAction === "tolerize") {
    s.inflammation = Math.max(0, s.inflammation - 12); s.host_stability += 4; s.immune_energy += 3;
    s.immune_lockon = Math.max(0, s.immune_lockon - 5); s.immune_fixation = Math.max(0, s.immune_fixation - 1);
    s.nextGrowthMod *= 1.12;
    log.push("immune tolerize");
  }

  s.immune_lockon = Math.min(100, s.immune_lockon);
  s.immune_fixation = Math.min(100, s.immune_fixation);

  // ---- 5. transmit check (immune contain/fever above may have shut the window) ----
  if (transmitAttempt) {
    const can = s.transmission_window >= WINDOW_THRESHOLD && s.colony_load >= LOAD_THRESHOLD && s.host_stability > 0;
    if (can) { s.transmitted = true; log.push("colony TRANSMIT ✓"); }
    else { s.immune_lockon = Math.min(100, s.immune_lockon + 5); log.push("colony transmit ✗"); }
  }

  // fixation auto-clear pressure once the immune system has fully adapted
  if (s.immune_fixation >= 100) {
    s.colony_load = Math.max(0, s.colony_load - 12);
    s.transmission_window = Math.max(0, s.transmission_window - 20);
  }

  // ---- 6. decay + energy regen ----
  s.transmission_window *= 0.84;
  s.inflammation *= 0.94;
  s.immune_lockon *= colonyAction === "suppress" ? 0.82 : 0.96;
  let regen = 1; if (s.inflammation > 60) regen -= 1; if (s.host_stability < 40) regen -= 1;
  s.immune_energy = clamp(s.immune_energy + regen, 0, 10);

  s.tick += 1;
  s.last_colony_action = colonyAction; s.last_immune_action = immuneAction;

  s.outcome = evaluateVersus(s);
  return [s, log];
}

// win from each side's perspective; returns { winner, reason } or null
export function evaluateVersus(s) {
  if (s.transmitted) return { winner: "colony", reason: "transmitted" };
  if (s.host_stability <= 0) return { winner: "draw", reason: "host died (mutual loss)" };
  if (s.colony_load <= 0) return { winner: "immune", reason: "colony cleared" };
  if (s.immune_fixation >= 100 && s.colony_load < 25) return { winner: "immune", reason: "fixation + weak colony" };
  if (s.tick >= MAX_TICKS) return { winner: "immune", reason: "ran out of ticks (contained)" };
  return null;
}

// ---- default policies (NPC / baseline) ------------------------------------
export function defaultImmunePolicy(o) {
  if (o.transmission_window >= 30 && o.immune_energy >= 2) return "contain";
  if (o.colony_load >= 65 && o.immune_lockon >= 45 && o.immune_energy >= 3) return "strike";
  if (o.colony_load >= 80 && o.transmission_window >= 20 && o.immune_energy >= 4 && o.host_stability >= 45) return "fever";
  if (o.inflammation >= 65 || o.host_stability <= 45) return "tolerize";
  return "scan";
}

export function defaultColonyPolicy(o) {
  if (o.transmission_window >= o.window_threshold && o.colony_load >= o.load_threshold) return "transmit";
  if (o.immune_lockon > 55) return "suppress";
  if (o.colony_load >= o.load_threshold && o.transmission_window < o.window_threshold) return "provoke";
  return "replicate";
}
