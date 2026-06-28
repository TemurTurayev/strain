// ecosystem.mjs — a multi-faction, HIDDEN-INFORMATION simulation inside one host,
// played across a GRAPH OF TISSUE ZONES (gut / blood / lung / lymph).
//
// Several microbe colonies compete (invisibly) for each zone's nutrients, migrate
// between adjacent zones, and race to transmit from an EXIT zone — while the host's
// immune system, which can't see a colony until it builds RECOGNITION (immune_lock)
// of that strain in a specific zone, hunts them down. Each faction gets only its OWN
// partial view (observeEco). Simultaneous ticks. Built for multi-agent play.
//
// Balance package reviewed by the Consilium council. Core principle: depth lives in
// VISIBLE environment variables that change the value of existing actions — and mass
// accumulating at an exit LEAKS detection before transmit, so quiet exit-camping is
// not a free win. Separate from solo and versus — its own mode.

// ---- the tissue graph ------------------------------------------------------
export const ZONES = ["gut", "blood", "lung", "lymph"];
export const ADJ = {
  gut: ["blood"],
  lung: ["blood"],
  blood: ["gut", "lung", "lymph"],
  lymph: ["blood"],
};
// transmit exits + their per-zone presence thresholds (gut = slow/resource, lung =
// fast/loud). The two exits are deliberately different escape routes.
export const EXIT_THRESH = { gut: 70, lung: 65 };
export const EXITS = Object.keys(EXIT_THRESH);

// per-zone environment. oxygen is 0..100 (an aerobe/anaerobe niche); immune is a
// DAMAGE/DETECT multiplier (lymph hits ~3x harder than gut). glucose/iron deplete
// and regenerate toward base; g_regen/i_regen set the refill rate.
const ZONE_BASE = {
  gut: { glucose: 85, g_regen: 11, iron: 45, i_regen: 3, oxygen: 15, immune: 0.70 },
  lung: { glucose: 72, g_regen: 10, iron: 25, i_regen: 2, oxygen: 85, immune: 0.70 },
  blood: { glucose: 80, g_regen: 10, iron: 90, i_regen: 8, oxygen: 80, immune: 1.5 },
  lymph: { glucose: 35, g_regen: 4, iron: 20, i_regen: 1, oxygen: 50, immune: 2.0 },
};

// ---- tuning knobs (council-reviewed first cut) ----------------------------
export const MAX_TICKS = 60;
export const QUORUM_TRANSMIT = 75;  // quorum needed to transmit (total_load ~60)
export const QUORUM_TOXIN = 35;     // quorum needed to release toxins (total_load ~28)
export const DETECT_REVEAL = 25;    // immune_lock above which a colony becomes a visible "contact"
export const LOCK_TO_STRIKE = 40;   // immune_lock needed before a strike actually bites
export const LOCK_TO_TRANSMIT = 70; // above this recognition, the exit is too watched to slip out
const MEMORY_CAP = 80;
const HOST_MIN_TRANSMIT = 25;       // a dying host can't be transmitted from
const BASE_GROW = 8;

// ---- intel layer (scouting / snitching) -----------------------------------
// Signaling Molecules (SM) are an espionage currency a colony accrues at high
// quorum. scout buys recon on a neighbour; snitch frames a rival to the immune
// system (which must investigate to trust the tip). This turns parallel farming
// into social deduction without RTS micro.
export const SCOUT_COST = 3;
export const SNITCH_COST = 6;
const SM_CAP = 20;
const INVESTIGATE_ENERGY = 4;
const TIP_TTL = 3;                   // ticks a tip stays on the immune's board

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const sum = (obj) => Object.values(obj).reduce((s, v) => s + v, 0);

export function totalLoad(c) { return sum(c.presence); }
export function quorum(c) { return Math.min(100, totalLoad(c) * 1.25); }
export function quorumOk(c) { return quorum(c) >= QUORUM_TOXIN; } // back-compat helper
export function dominantZone(c) {
  return ZONES.reduce((best, z) => (c.presence[z] > c.presence[best] ? z : best), ZONES[0]);
}

// ---- world construction ----------------------------------------------------
export function freshEcosystem(genomes) {
  // genomes: [{ id, stealth, preferredO2, home }]
  const colonies = {};
  for (const g of genomes) {
    const home = g.home && ZONES.includes(g.home) && home_ok(g.home) ? g.home : "gut";
    const presence = Object.fromEntries(ZONES.map((z) => [z, 0]));
    presence[home] = 12;
    const signature = Object.fromEntries(ZONES.map((z) => [z, 0]));
    signature[home] = 8;
    colonies[g.id] = {
      id: g.id,
      stealth: g.stealth ?? 5,
      preferredO2: g.preferredO2 ?? 50,
      home,
      presence,
      signature,
      lock: 0,        // immune recognition of THIS strain (global)
      memory: 0,      // long-term memory: floors the lock, soft-enrages over time
      alive: true,
      transmitted: false,
      lastDrain: 0,
      sm: 0,          // Signaling Molecules — funds scouting/snitching
      lastScout: null, // most recent recon readout (surfaced once, then cleared)
      resistance: 0,  // A1: adaptation to being struck — softens repeated strikes (immune-owned, hidden)
      virulence: 0,   // A3: toxin-built aggression — feed kicker + a standing detection tax (colony-owned)
    };
  }
  const zones = {};
  for (const z of ZONES) {
    zones[z] = {
      glucose: ZONE_BASE[z].glucose,
      iron: ZONE_BASE[z].iron,
      oxygen: ZONE_BASE[z].oxygen,
      immune_presence: ZONE_BASE[z].immune,
      inflammation: 0,
      drainLast: 0,        // glucose pulled here last tick (an anomaly the immune can read)
      sweptLast: false,    // patrolled last tick (passing through costs extra here)
      containTimer: 0,     // quarantine countdown; >0 means contained (1-tick delayed effect)
      fibrosis: 0,         // A2: scar tissue from over-fighting — drops BOTH regen and immune_presence here
    };
  }
  return {
    tick: 0,
    host: { integrity: 100, toxin: 0 },
    zones,
    colonies,
    immune: { energy: 6 },
    tips: [],          // snitch/trace tips visible to the immune: {zone, fromId, real, age}
    outcome: null,
    log: [],
  };
}
function home_ok(z) { return z !== "blood" && z !== "lymph"; } // colonies seed in gut/lung

export function colonyIds(world) { return Object.keys(world.colonies); }
export function factions(world) { return [...colonyIds(world), "immune"]; }

// ---- partial observation per faction --------------------------------------
export function observeEco(world, factionId) {
  if (factionId === "immune") return observeImmune(world);
  return observeColony(world, factionId);
}

function observeColony(world, id) {
  const c = world.colonies[id];
  if (!c) return null;
  const occupied = ZONES.filter((z) => c.presence[z] > 0.5);
  const visibleZones = new Set(occupied);
  for (const z of occupied) for (const n of ADJ[z]) visibleZones.add(n);

  const zoneView = {};
  for (const z of visibleZones) {
    const zw = world.zones[z];
    const here = occupied.includes(z);
    zoneView[z] = {
      mine: +c.presence[z].toFixed(1),
      glucose: +zw.glucose.toFixed(0),
      iron: +zw.iron.toFixed(0),
      oxygen: zw.oxygen,
      inflammation: +zw.inflammation.toFixed(0),
      immune_pressure: +zw.immune_presence.toFixed(2),
      scarring: +zw.fibrosis.toFixed(0),   // A2: shared terrain — colony sees scar tissue
      contained: zw.containTimer > 0,
      signature: here ? +c.signature[z].toFixed(0) : undefined,
      is_exit: EXITS.includes(z),
      exit_threshold: EXIT_THRESH[z],
      adjacent: ADJ[z],
    };
  }

  const myDrain = c.lastDrain;
  const zonesDrain = occupied.reduce((s, z) => s + world.zones[z].drainLast, 0);
  const rivalDrain = Math.max(0, zonesDrain - myDrain);
  const competition = rivalDrain < 1 ? "none" : rivalDrain < 6 ? "low" : rivalDrain < 14 ? "medium" : "high";

  return {
    faction: "colony", id: c.id, tick: world.tick,
    me: {
      total_load: +totalLoad(c).toFixed(1),
      dominant_zone: dominantZone(c),
      detected: +c.lock.toFixed(0),
      quorum: +quorum(c).toFixed(0),
      preferred_oxygen: c.preferredO2,
      sm: +c.sm.toFixed(1),
      virulence: +(c.virulence * 100).toFixed(0), // A3: own stat (immune only infers it via faster lock)
    },
    zones: zoneView,
    host: { integrity: +world.host.integrity.toFixed(0), toxin: +world.host.toxin.toFixed(0) },
    competition,
    scout_intel: (c.lastScout && world.tick - c.lastScout.tick <= 1) ? c.lastScout : null,
    exits: EXIT_THRESH,
    quorum_to_transmit: QUORUM_TRANSMIT,
    quorum_to_toxin: QUORUM_TOXIN,
    scout_cost: SCOUT_COST,
    snitch_cost: SNITCH_COST,
    legal_actions: ["feed", "move:<zone>", "hide", "toxin", "scout:<zone>", "snitch:<zone>", "transmit"],
    note: "Can't see other colonies. Grow biomass, migrate (move:zone) to an EXIT zone (gut thr 70 / lung thr 65), then transmit once presence there >= its threshold AND quorum >= 75 AND you're not too recognised. WARNING: mass piling up at an exit LEAKS detection before you escape. Blood is rich (iron) but a kill-zone; lymph is a memory trap.",
  };
}

function observeImmune(world) {
  const zoneReads = {};
  for (const z of ZONES) {
    const zw = world.zones[z];
    let anomalySig = 0;
    for (const c of Object.values(world.colonies)) {
      if (c.alive && !c.transmitted && c.presence[z] > 0.5) anomalySig += c.signature[z];
    }
    zoneReads[z] = {
      inflammation: +zw.inflammation.toFixed(0),
      nutrient_drain: +zw.drainLast.toFixed(0),
      immune_presence: +zw.immune_presence.toFixed(2),
      fibrosis: +zw.fibrosis.toFixed(0),   // A2: shared terrain — immune sees its own scarring
      anomaly: +anomalySig.toFixed(0),
      contained: zw.containTimer > 0,
      is_exit: EXITS.includes(z),
    };
  }

  const contacts = [];
  let hiddenThreat = 0;
  for (const c of Object.values(world.colonies)) {
    if (!c.alive || c.transmitted) continue;
    if (c.lock >= DETECT_REVEAL) {
      const noise = 1 - c.lock / 200;
      contacts.push({
        id: c.id,
        lock: +c.lock.toFixed(0),
        est_load: +Math.max(0, totalLoad(c) * (0.85 + 0.3 * (1 - noise))).toFixed(0),
        zones: ZONES.filter((z) => c.presence[z] > 0.5),
        memory: +c.memory.toFixed(0),
        adapted: +(c.resistance * 100).toFixed(0), // A1: immune feels its strikes landing softer (% damage absorbed)
      });
    } else {
      hiddenThreat += sum(c.signature);
    }
  }

  return {
    faction: "immune", tick: world.tick,
    host: { integrity: +world.host.integrity.toFixed(0), toxin: +world.host.toxin.toFixed(0) },
    energy: +world.immune.energy.toFixed(1),
    zones: zoneReads,
    contacts,
    hidden_threat: +hiddenThreat.toFixed(0),
    lock_to_strike: LOCK_TO_STRIKE,
    tips: world.tips.filter((t) => t.age <= TIP_TTL).map((t) => ({ zone: t.zone, age: t.age })), // who tipped & truth are hidden until you investigate
    legal_actions: ["sweep:<zone>", "scan:<ID>", "strike:<ID>", "contain:<zone>", "investigate:<zone>", "tolerize"],
    note: "You can't see undetected colonies — only per-zone anomalies (inflammation/nutrient_drain/signal) and TIPS (a colony may have snitched on a rival). sweep a zone to build recognition (immune_lock) on whatever is there (1.35x at exits); scan:ID to focus a contact; strike:ID needs its lock>=lock_to_strike and hits hardest where immune_presence is high; contain:zone quarantines a zone after a 1-tick delay; investigate:zone acts on a tip — a TRUE tip instantly localises a hidden colony (+30 lock), a FALSE tip just wastes energy, so don't trust tips blindly; tolerize heals the host. Memory makes a known strain re-lock fast even after it hides.",
  };
}

// ---- one simultaneous tick ------------------------------------------------
export function resolveEcoTick(world, actions) {
  const w = cloneWorld(world);
  const log = [];
  for (const z of ZONES) { w.zones[z].drainLast = 0; w.zones[z].sweptLast = false; }
  const live = () => Object.values(w.colonies).filter((c) => c.alive && !c.transmitted);

  // 1. colony actions FIRST — they read containment set on a PREVIOUS tick, which
  //    gives the council's 1-tick escape window before a fresh quarantine bites.
  for (const c of live()) {
    const [act, arg] = String(actions[c.id] || "feed").split(":");
    c.lastDrain = 0;
    if (act === "feed") feedColony(w, c, log);
    else if (act === "move") moveColony(w, c, arg, log);
    else if (act === "hide") hideColony(c, log);
    else if (act === "toxin") toxinColony(w, c, log);
    else if (act === "scout") scoutColony(w, c, arg, log);
    else if (act === "snitch") snitchColony(w, c, arg, log);
    else if (act === "transmit") tryTransmit(w, c, log);
    else feedColony(w, c, log);
  }

  // 2. immune action
  const [iact, itarget] = String(actions.immune || "sweep").split(":");
  const im = w.immune;
  if (iact === "sweep") {
    const z = ZONES.includes(itarget) ? itarget : busiestZone(w);
    if (z) sweepZone(w, z, log);
    im.energy += 2;
  } else if (iact === "scan") {
    const c = w.colonies[itarget] || hottestUndetected(live());
    if (c) {
      const gain = (18 + sum(c.signature) * 0.15 + c.memory * 0.4) * (1 + c.memory / 100);
      c.lock = clamp(c.lock + gain, 0, 100);
      gainMemory(c, sum(c.signature), 1);
      log.push(`immune scan ${c.id} (+${gain.toFixed(0)} lock)`);
    }
    im.energy -= 1;
  } else if (iact === "strike") {
    strikeColony(w, w.colonies[itarget] || hottestContact(live()), log);
  } else if (iact === "contain") {
    const z = ZONES.includes(itarget) ? itarget : busiestZone(w);
    if (z) { w.zones[z].containTimer = 2; im.energy -= 2; w.zones[z].inflammation += 3; w.zones[z].fibrosis = Math.min(40, w.zones[z].fibrosis + 2); log.push(`immune contain ${z} (arms next tick)`); }
  } else if (iact === "investigate") {
    investigateZone(w, ZONES.includes(itarget) ? itarget : newestTipZone(w), log);
  } else if (iact === "tolerize") {
    w.host.integrity = clamp(w.host.integrity + 6, 0, 100);
    for (const z of ZONES) w.zones[z].inflammation = Math.max(0, w.zones[z].inflammation - 6);
    im.energy += 3;
    log.push("immune tolerize");
  }
  const totalInfl = ZONES.reduce((s, z) => s + w.zones[z].inflammation, 0);
  im.energy = clamp(im.energy - (totalInfl > 120 ? 1 : 0), 0, 12);

  // 3. exit pre-transmit detect-pressure (the mandatory anti-camping patch):
  //    a bulge piling up at an exit leaks signature, inflames the tissue, AND is
  //    directly visible to the immune system the closer it gets to the threshold.
  for (const c of live()) {
    for (const z of EXITS) {
      const ratio = c.presence[z] / EXIT_THRESH[z];
      if (ratio >= 0.6) {
        c.signature[z] += 3;
        w.zones[z].inflammation += 2;
        c.lock = clamp(c.lock + 3 + 6 * (ratio - 0.6), 0, 100); // the bulge gives you away
      }
    }
  }

  // 4. passive upkeep
  upkeep(w, log);

  w.tick += 1;
  w.outcome = evaluateEco(w);
  w.log = log;
  return w;
}

// ---- colony action mechanics ----------------------------------------------
function feedColony(w, c, log) {
  const z = dominantZone(c);
  const zw = w.zones[z];
  const glucoseFactor = clamp(zw.glucose / 60, 0.35, 1.25);
  const o2match = clamp(1.15 - Math.abs(c.preferredO2 - zw.oxygen) / 120, 0.5, 1.15);
  const containFactor = zw.containTimer > 0 ? 0.55 : 1;
  const depleted = c.presence[z] > zw.glucose * 0.8;  // crowding/depletion pushes you out
  const lymphPenalty = z === "lymph" ? 0.45 : 1;
  let grow = BASE_GROW * glucoseFactor * o2match * containFactor * lymphPenalty;
  if (depleted) grow *= 0.7;
  grow *= (1 + 0.10 * c.virulence); // A3: a virulent strain runs hotter (paid for via toxin)
  c.presence[z] += grow;
  const drained = grow * 1.2;
  zw.glucose = clamp(zw.glucose - drained, 0, 100);
  zw.drainLast += drained;
  c.lastDrain += drained;
  let sig = (5 + 0.35 * grow) * (1 - 0.45 * (c.stealth / 10));
  if (depleted) sig *= 1.25;
  c.signature[z] += sig;
  zw.inflammation += 2 + 0.15 * grow;
  if (z === "lymph") { w.host.integrity = clamp(w.host.integrity + 3, 0, 100); gainMemory(c, 0, 1, 4); } // sacrificial pressure-vent
  log.push(`${c.id} feed@${z} +${grow.toFixed(1)}`);
}

function moveColony(w, c, target, log) {
  const src = dominantZone(c);
  const dest = ZONES.includes(target) ? target : null;
  if (!dest || !ADJ[src].includes(dest)) { log.push(`${c.id} move ✗ (${src}->${target} not adjacent)`); return; }
  const amount = c.presence[src] * 0.4;
  const blocked = (w.zones[src].containTimer > 0 || w.zones[dest].containTimer > 0) ? 0.35 : 0;
  const success = clamp(0.85 - blocked - 0.10 * w.zones[dest].immune_presence, 0.4, 0.95);
  const arrived = amount * success;
  c.presence[src] -= amount;
  c.presence[dest] += arrived;
  c.signature[src] += 4 + 0.15 * amount;
  c.signature[dest] += 6 + 0.20 * arrived;
  if (dest === "blood") { c.signature.blood += 8; if (w.zones.blood.sweptLast) c.lock = clamp(c.lock + 4, 0, 100); }
  log.push(`${c.id} move ${src}->${dest} (${arrived.toFixed(1)}${success < 0.9 ? `, lost ${(amount - arrived).toFixed(1)}` : ""})`);
}

function hideColony(c, log) {
  const floor = c.memory * 0.15; // memory leaves an immunological trace you can't scrub
  for (const z of ZONES) c.signature[z] = Math.max(floor, c.signature[z] * 0.45);
  log.push(`${c.id} hide`);
}

function toxinColony(w, c, log) {
  if (quorum(c) < QUORUM_TOXIN) { c.signature[dominantZone(c)] += 4; log.push(`${c.id} toxin ✗ (no quorum)`); return; }
  const z = dominantZone(c);
  const zw = w.zones[z];
  if (zw.iron < 8) { c.signature[z] += 4; log.push(`${c.id} toxin ✗ (no iron in ${z})`); return; }
  zw.iron = clamp(zw.iron - 8, 0, 100);
  c.presence[z] = Math.max(0, c.presence[z] - 10);     // toxins cost you 10 biomass (anti-grief)
  w.host.toxin = clamp(w.host.toxin + 10, 0, 100);
  w.host.integrity -= 4;
  zw.inflammation += 6;
  c.signature[z] += 35;
  c.lock = clamp(c.lock + 0.5 * w.host.toxin, 0, 100);
  c.virulence = Math.min(1, c.virulence + 0.25); // A3: secreting toxins makes the strain more virulent
  const dmg = 8 + 0.12 * w.host.toxin;
  for (const rival of Object.values(w.colonies)) {
    if (rival.id === c.id || !rival.alive || rival.transmitted) continue;
    if (rival.presence[z] > 0.5) rival.presence[z] = Math.max(0, rival.presence[z] - dmg);
  }
  log.push(`${c.id} toxin@${z} (host toxin ${w.host.toxin.toFixed(0)}, −${dmg.toFixed(0)} to rivals here)`);
}

function scoutColony(w, c, target, log) {
  if (c.sm < SCOUT_COST) { feedColony(w, c, log); return; } // can't afford -> just feed
  const src = dominantZone(c);
  const dest = ZONES.includes(target) && ADJ[src].concat(src).includes(target) ? target : ADJ[src][0];
  c.sm -= SCOUT_COST;
  let rivalPresence = 0, rivalSignal = 0;
  for (const r of Object.values(w.colonies)) {
    if (r.id === c.id || !r.alive || r.transmitted) continue;
    rivalPresence += r.presence[dest]; rivalSignal += r.signature[dest];
  }
  c.lastScout = { zone: dest, rival_presence: +rivalPresence.toFixed(1), rival_signal: +rivalSignal.toFixed(1), tick: w.tick };
  c.signature[src] += 4; // recon is not free — you stir the tissue a little
  log.push(`${c.id} scout ${dest} (rivals ~${rivalPresence.toFixed(0)})`);
}

function snitchColony(w, c, target, log) {
  if (c.sm < SNITCH_COST) { hideColony(c, log); return; }
  const z = ZONES.includes(target) ? target : busiestRivalZone(w, c);
  c.sm -= SNITCH_COST;
  const victim = Object.values(w.colonies)
    .filter((r) => r.id !== c.id && r.alive && !r.transmitted && r.presence[z] > 0.5)
    .sort((a, b) => b.presence[z] - a.presence[z])[0];
  if (victim) {
    victim.signature[z] += 15; // frame them: their signal spikes where you ratted
    w.tips.push({ zone: z, fromId: c.id, real: true, age: 0 });
    log.push(`${c.id} snitch -> ${victim.id}@${z}`);
  } else {
    w.tips.push({ zone: z, fromId: c.id, real: false, age: 0 }); // a false tip (no real rival there)
    log.push(`${c.id} snitch@${z} (false tip)`);
  }
  c.signature[dominantZone(c)] += 6; // snitching is audible
}

function investigateZone(w, z, log) {
  if (!z) { w.immune.energy -= 1; log.push("immune investigate (no tip)"); return; }
  w.immune.energy -= INVESTIGATE_ENERGY;
  const real = Object.values(w.colonies)
    .filter((r) => r.alive && !r.transmitted && r.presence[z] > 4)
    .sort((a, b) => b.presence[z] - a.presence[z])[0];
  // consume tips on this zone
  for (const t of w.tips) if (t.zone === z) t.age = TIP_TTL + 1;
  if (real) {
    real.lock = clamp(real.lock + 30, 0, 100);
    gainMemory(real, real.signature[z], 1);
    log.push(`immune investigate ${z} -> localised ${real.id} (+30 lock)`);
  } else {
    log.push(`immune investigate ${z} (false alarm — energy wasted)`);
  }
}

function busiestRivalZone(w, c) {
  return ZONES.map((z) => [z, Object.values(w.colonies)
    .filter((r) => r.id !== c.id && r.alive && !r.transmitted).reduce((s, r) => s + r.presence[z], 0)])
    .sort((a, b) => b[1] - a[1])[0][0];
}
function newestTipZone(w) {
  const t = w.tips.filter((x) => x.age <= TIP_TTL).sort((a, b) => a.age - b.age)[0];
  return t ? t.zone : null;
}

function tryTransmit(w, c, log) {
  const toxinThrMul = w.host.toxin >= 30 ? 1.2 : 1;     // a toxic host is harder to escape
  const exitZone = EXITS
    .filter((z) => c.presence[z] >= EXIT_THRESH[z] * toxinThrMul)
    .sort((a, b) => c.presence[b] - c.presence[a])[0];
  const ok = exitZone && quorum(c) >= QUORUM_TRANSMIT && c.lock < LOCK_TO_TRANSMIT && w.host.integrity >= HOST_MIN_TRANSMIT;
  if (ok) { c.transmitted = true; log.push(`${c.id} TRANSMIT ✓ via ${exitZone}`); }
  else {
    for (const z of EXITS) c.signature[z] += 8;
    c.lock = clamp(c.lock + 5, 0, 100);
    log.push(`${c.id} transmit ✗ (need exit presence + quorum>=${QUORUM_TRANSMIT} + lock<${LOCK_TO_TRANSMIT})`);
  }
}

// ---- immune action mechanics ----------------------------------------------
function sweepZone(w, z, log) {
  const zw = w.zones[z];
  zw.sweptLast = true;
  zw.fibrosis = Math.min(40, zw.fibrosis + 2); // A2: patrolling a node scars it over time
  const exitMul = EXITS.includes(z) ? 1.35 : 1;
  for (const c of Object.values(w.colonies)) {
    if (!c.alive || c.transmitted || c.presence[z] <= 0.5) continue;
    const gain = (10 * zw.immune_presence + 0.12 * c.signature[z]) * (1 + c.memory / 100) * exitMul * 0.45;
    c.lock = clamp(c.lock + gain, 0, 100);
    gainMemory(c, c.signature[z], z === "lymph" ? 2 : 1);
  }
  log.push(`immune sweep ${z}`);
}

function strikeColony(w, c, log) {
  w.immune.energy -= 3;
  if (!c || !c.alive || c.transmitted || c.lock < LOCK_TO_STRIKE) {
    w.host.integrity -= 4;
    if (c) c.signature[dominantZone(c)] += 2;
    log.push("immune strike ✗ (no locked target — host hurt)");
    return;
  }
  const z = ZONES.filter((zz) => c.presence[zz] > 0.5)
    .sort((a, b) => (c.presence[b] * w.zones[b].immune_presence) - (c.presence[a] * w.zones[a].immune_presence))[0]
    || dominantZone(c);
  const lockFactor = 0.75 + c.lock / 100;
  const dmg = 10 * w.zones[z].immune_presence * lockFactor;
  const eff = dmg * (1 - c.resistance);                 // A1: adaptation softens the bite
  c.presence[z] = Math.max(0, c.presence[z] - eff);
  c.resistance = Math.min(0.45, c.resistance + 0.12);   // A1: each landed hit raises adaptation
  c.lock = Math.max(0, c.lock - 18);
  w.zones[z].inflammation += 6;
  w.zones[z].fibrosis = Math.min(40, w.zones[z].fibrosis + 2); // A2: a fought-over node scars
  w.host.integrity -= 2;
  log.push(`immune strike ${c.id}@${z} −${eff.toFixed(1)}`);
}

function gainMemory(c, detectedSig, mul = 1, flat = 0) {
  c.memory = Math.min(MEMORY_CAP, c.memory + (0.06 * detectedSig * mul) + flat);
}

// ---- passive upkeep --------------------------------------------------------
function upkeep(w, log) {
  for (const c of Object.values(w.colonies)) {
    if (!c.alive || c.transmitted) continue;
    // recognition leaks from signature (weighted by immune strength) AND from sheer
    // biomass — a large bulge of cells is intrinsically hard to hide anywhere.
    let passive = 0;
    let maxPresence = 0;
    for (const z of ZONES) {
      passive += c.signature[z] * 0.08 * w.zones[z].immune_presence;
      if (c.presence[z] > maxPresence) maxPresence = c.presence[z];
    }
    passive += maxPresence * 0.045;
    c.lock = clamp(c.lock + passive, 0, 100);
    c.lock = clamp(c.lock + c.virulence * 1.2, 0, 100);  // A3: virulent strains run loud
    c.lock = Math.max(c.lock - 3, c.memory * 0.25); // decays, memory floors it (soft enrage)
    for (const z of ZONES) c.signature[z] *= 0.85;
    c.sm = Math.min(SM_CAP, c.sm + Math.max(0, (quorum(c) - 40) / 15)); // espionage currency
    c.resistance = Math.max(0, c.resistance - 0.04); // A1: adaptation fades if the immune stops hammering
    c.virulence = Math.max(0, c.virulence - 0.1);    // A3: virulence relaxes without fresh toxin
    if (totalLoad(c) <= 0.5) { c.alive = false; log.push(`${c.id} cleared`); }
  }
  for (const t of w.tips) t.age += 1;
  w.tips = w.tips.filter((t) => t.age <= TIP_TTL);
  let totalInfl = 0;
  for (const z of ZONES) {
    const zw = w.zones[z];
    zw.inflammation = Math.max(0, zw.inflammation - 4) * 0.92;
    totalInfl += zw.inflammation;
    if (zw.containTimer > 0) zw.containTimer -= 1;
    // A2: fibrosis decays slowly; while present it scars BOTH the pantry (regen) and the
    // hunting ground (immune_presence), recomputed fresh from base so it never drifts.
    zw.fibrosis = Math.max(0, zw.fibrosis - 0.5);
    const scarMul = clamp(1 - zw.fibrosis / 80, 0.5, 1);
    zw.immune_presence = ZONE_BASE[z].immune * scarMul;
    const regenMul = clamp(1 - zw.inflammation / 100, 0.35, 1.0);
    zw.glucose = clamp(zw.glucose + ZONE_BASE[z].g_regen * regenMul * scarMul, 0, ZONE_BASE[z].glucose);
    zw.iron = clamp(zw.iron + ZONE_BASE[z].i_regen * regenMul * scarMul, 0, ZONE_BASE[z].iron);
  }
  w.host.toxin = clamp(w.host.toxin * 0.85, 0, 100);
  w.host.integrity = clamp(w.host.integrity - w.host.toxin * 0.06 - totalInfl * 0.01, 0, 100);
}

// ---- helpers ---------------------------------------------------------------
function zoneOccupancy(w, z) {
  let s = 0;
  for (const c of Object.values(w.colonies)) if (c.alive && !c.transmitted) s += c.presence[z];
  return s;
}
function busiestZone(w) {
  return ZONES.map((z) => [z, zoneOccupancy(w, z) + w.zones[z].inflammation])
    .sort((a, b) => b[1] - a[1])[0][0];
}
function hottestContact(live) {
  return live.filter((x) => x.lock >= LOCK_TO_STRIKE).sort((a, b) => totalLoad(b) - totalLoad(a))[0] || null;
}
function hottestUndetected(live) {
  return live.filter((x) => x.lock < DETECT_REVEAL).sort((a, b) => sum(b.signature) - sum(a.signature))[0] || null;
}

export function evaluateEco(w) {
  for (const c of Object.values(w.colonies)) {
    if (c.transmitted) return { type: "transmit", winner: c.id, reason: `${c.id} transmitted` };
  }
  if (w.host.integrity <= 0) return { type: "host_death", winner: "none", reason: "host died (everyone loses)" };
  const liveCount = Object.values(w.colonies).filter((c) => c.alive && !c.transmitted).length;
  if (liveCount === 0) return { type: "cleared", winner: "immune", reason: "all colonies cleared" };
  if (w.tick >= MAX_TICKS) return { type: "contained", winner: "immune", reason: "immune contained everything to the time limit" };
  return null;
}

// ---- default policies (heuristic baselines) -------------------------------
export function defaultColonyPolicy(o) {
  const dom = o.me.dominant_zone;
  const here = o.zones[dom] || {};
  if (EXITS.includes(dom) && here.mine >= (o.exits[dom] || 70) && o.me.quorum >= o.quorum_to_transmit && o.me.detected < LOCK_TO_TRANSMIT) return "transmit";
  if (o.me.detected >= 55) return "hide";
  // recon: if rivals are pressing and we can afford it, scout the contested neighbour
  if (o.competition === "high" && o.me.sm >= o.scout_cost && !o.scout_intel) {
    const neighbour = (here.adjacent || [])[0];
    if (neighbour) return "scout:" + neighbour;
  }
  if (o.me.total_load >= 40 && !EXITS.includes(dom)) {
    const exitNeighbor = (here.adjacent || []).filter((z) => EXITS.includes(z))
      .sort((a, b) => (o.zones[a]?.immune_pressure ?? 9) - (o.zones[b]?.immune_pressure ?? 9))[0];
    if (exitNeighbor && !o.zones[exitNeighbor]?.contained) return "move:" + exitNeighbor;
    if ((here.adjacent || []).includes("blood")) return "move:blood";
  }
  return "feed";
}

export function defaultImmunePolicy(o) {
  if (o.host.integrity <= 35 || o.host.toxin >= 45) return "tolerize";
  const ready = o.contacts.filter((c) => c.lock >= o.lock_to_strike).sort((a, b) => b.est_load - a.est_load)[0];
  if (ready && o.energy >= 3 && ready.est_load >= 18) return "strike:" + ready.id;
  // act on a fresh tip when we have energy to spare — but it might be a false frame
  if (o.tips && o.tips.length && o.energy >= 5) {
    const fresh = o.tips.sort((a, b) => a.age - b.age)[0];
    return "investigate:" + fresh.zone;
  }
  const climbing = o.contacts.filter((c) => c.lock < o.lock_to_strike).sort((a, b) => b.est_load - a.est_load)[0];
  if (climbing) {
    const exitZone = (climbing.zones || []).find((z) => z === "gut" || z === "lung");
    if (exitZone && o.energy >= 2 && !o.zones[exitZone]?.contained) return "contain:" + exitZone;
    return "scan:" + climbing.id;
  }
  // nothing locked — sweep the noisiest zone, biasing toward exits (their pre-transmit leak)
  const noisy = ZONES.map((z) => [z, (o.zones[z]?.anomaly ?? 0) + (o.zones[z]?.nutrient_drain ?? 0) + (o.zones[z]?.is_exit ? 5 : 0)])
    .sort((a, b) => b[1] - a[1])[0];
  return "sweep:" + noisy[0];
}

// ---- cloning ---------------------------------------------------------------
function cloneWorld(w) {
  try { return structuredClone(w); }
  catch {
    return {
      ...w,
      host: { ...w.host },
      immune: { ...w.immune },
      zones: Object.fromEntries(Object.entries(w.zones).map(([k, v]) => [k, { ...v }])),
      colonies: Object.fromEntries(Object.entries(w.colonies).map(([k, v]) => [k, {
        ...v, presence: { ...v.presence }, signature: { ...v.signature },
      }])),
      log: [],
    };
  }
}
