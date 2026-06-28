// ecosystem.mjs — a multi-faction, HIDDEN-INFORMATION simulation inside one host.
// Several microbe colonies compete (invisibly) for the host's nutrients and race
// to transmit, while the host's immune system — which can't see a colony until it
// detects it — tries to find and clear them. Each faction gets only its OWN
// partial view (observeEco). Simultaneous ticks. Built for multi-agent play.
//
// Separate from solo and versus — its own mode.

export const TRANSMIT_THRESHOLD = 50;
export const MAX_TICKS = 60;
export const DETECT_REVEAL = 25;   // detection above which a colony becomes a "contact"

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function freshEcosystem(genomes) {
  // genomes: [{ id, stealth }] — 1..N microbe colonies
  const colonies = {};
  for (const g of genomes) {
    colonies[g.id] = {
      id: g.id, stealth: g.stealth ?? 5,
      load: 10, signature: 0, detection: 0,
      alive: true, transmitted: false,
      lastDrain: 0,
    };
  }
  return {
    tick: 0,
    host: { health: 100, nutrients: 100, inflammation: 0 },
    colonies,
    immune: { energy: 5 },
    totalDrainLast: 0,
    outcome: null,
    log: [],
  };
}

export function colonyIds(world) { return Object.keys(world.colonies); }
export function factions(world) { return [...colonyIds(world), "immune"]; }

// ---- partial observation per faction --------------------------------------
export function observeEco(world, factionId) {
  const h = world.host;
  if (factionId === "immune") {
    const contacts = [];
    let backgroundThreat = 0;
    for (const c of Object.values(world.colonies)) {
      if (!c.alive || c.transmitted) continue;
      if (c.detection >= DETECT_REVEAL) {
        // revealed: noisy load estimate
        const noise = (1 - c.detection / 200);
        contacts.push({ id: c.id, est_load: +Math.max(0, c.load * (0.85 + 0.3 * (1 - noise))).toFixed(0), detection: +c.detection.toFixed(0) });
      } else {
        backgroundThreat += c.signature; // it can feel there's *something* unseen
      }
    }
    return {
      faction: "immune", tick: world.tick,
      host: { health: +h.health.toFixed(0), inflammation: +h.inflammation.toFixed(0), nutrients: +h.nutrients.toFixed(0) },
      energy: +world.immune.energy.toFixed(1),
      contacts,
      hidden_threat: +backgroundThreat.toFixed(0), // intel: how much undetected signal is out there
      legal_actions: ["sweep", "scan", "strike", "contain", "tolerize"],
      note: "scan/strike/contain take a target id from contacts; sweep raises detection on everything; you cannot see undetected colonies, only hidden_threat.",
    };
  }
  // a colony's view
  const c = world.colonies[factionId];
  if (!c) return null;
  const rivalDrain = Math.max(0, world.totalDrainLast - c.lastDrain);
  const competition = rivalDrain < 1 ? "none" : rivalDrain < 5 ? "low" : rivalDrain < 12 ? "medium" : "high";
  return {
    faction: "colony", id: c.id, tick: world.tick,
    me: { load: +c.load.toFixed(1), signature: +c.signature.toFixed(0), detected: +c.detection.toFixed(0) },
    host: { nutrients: +h.nutrients.toFixed(0), inflammation: +h.inflammation.toFixed(0), health: +h.health.toFixed(0) },
    competition,                       // intel about unseen rivals (sensed via nutrient scarcity)
    transmit_threshold: TRANSMIT_THRESHOLD,
    legal_actions: ["feed", "hide", "transmit"],
    note: "you cannot see other colonies; 'competition' hints at unseen rivals feeding. Loud feeding raises your signature, which the immune system can detect.",
  };
}

// ---- one simultaneous tick ------------------------------------------------
// actions: { [colonyId]: "feed"|"hide"|"transmit", immune: "sweep"|"scan:ID"|"strike:ID"|"contain:ID"|"tolerize" }
export function resolveEcoTick(world, actions) {
  const w = structuredCloneish(world);
  const log = [];
  const live = Object.values(w.colonies).filter((c) => c.alive && !c.transmitted);

  // 1. colony feeding — competition for shared nutrients
  const feeders = live.filter((c) => actions[c.id] === "feed");
  const demand = {};
  let totalDemand = 0;
  for (const c of feeders) { demand[c.id] = 8 * (1 + (10 - c.stealth) / 20); totalDemand += demand[c.id]; }
  const avail = w.host.nutrients;
  const scale = totalDemand > avail ? avail / totalDemand : 1;
  let totalDrain = 0;
  for (const c of live) {
    const a = actions[c.id];
    c.lastDrain = 0;
    if (a === "feed") {
      const got = demand[c.id] * scale;
      const grow = got * 0.9;
      c.load += grow; c.lastDrain = got; totalDrain += got;
      c.signature += 6 * (1 - 0.5 * (c.stealth / 10)); // loud feeding raises signature
      w.host.inflammation += 1.5;
      log.push(`${c.id} feed +${grow.toFixed(1)} (took ${got.toFixed(1)} nutrients)`);
    } else if (a === "hide") {
      c.signature *= 0.55; c.detection *= 0.82;
      log.push(`${c.id} hide`);
    } else if (a === "transmit") {
      if (c.load >= TRANSMIT_THRESHOLD) { c.transmitted = true; log.push(`${c.id} TRANSMIT ✓`); }
      else { c.signature += 10; c.detection += 6; log.push(`${c.id} transmit ✗ (load ${c.load.toFixed(0)})`); }
    }
  }
  w.host.nutrients = clamp(w.host.nutrients - totalDrain, 0, 100);
  w.totalDrainLast = totalDrain;

  // 2. immune action
  const [iact, itarget] = String(actions.immune || "sweep").split(":");
  const im = w.immune;
  if (iact === "sweep") {
    for (const c of live) c.detection = clamp(c.detection + 4 + c.signature * 0.12, 0, 100);
    im.energy += 1;
    log.push("immune sweep");
  } else if (iact === "scan") {
    const c = w.colonies[itarget] || hottestUndetected(live);
    if (c) { c.detection = clamp(c.detection + 22 + c.signature * 0.1, 0, 100); log.push(`immune scan ${c.id}`); }
    im.energy += 2;
  } else if (iact === "strike") {
    const c = w.colonies[itarget] || hottestContact(live);
    im.energy -= 3;
    if (c && c.detection >= 40) {
      const dmg = 8 + c.detection * 0.12;
      c.load = Math.max(0, c.load - dmg); w.host.health -= 2; w.host.inflammation += 4;
      log.push(`immune strike ${c.id} −${dmg.toFixed(1)}`);
    } else { w.host.health -= 6; w.host.inflammation += 8; log.push("immune strike (no clear target — host hurt)"); }
  } else if (iact === "contain") {
    const c = w.colonies[itarget] || hottestContact(live);
    im.energy -= 2;
    if (c) { c.load *= 0.9; c.signature += 3; w.host.inflammation += 3; log.push(`immune contain ${c.id}`); }
  } else if (iact === "tolerize") {
    w.host.health = clamp(w.host.health + 5, 0, 100); w.host.inflammation = Math.max(0, w.host.inflammation - 10);
    im.energy += 3; log.push("immune tolerize");
  }
  im.energy = clamp(im.energy - (w.host.inflammation > 60 ? 1 : 0), 0, 10);

  // 3. passive: signatures leak into detection; decay; host upkeep
  for (const c of live) {
    c.detection = clamp(c.detection + c.signature * 0.03, 0, 100);
    c.signature *= 0.9;
    if (c.load <= 0) { c.alive = false; log.push(`${c.id} cleared`); }
  }
  w.host.inflammation *= 0.92;
  w.host.health = clamp(w.host.health - w.host.inflammation * 0.03, 0, 100);
  w.host.nutrients = clamp(w.host.nutrients + 6, 0, 100); // host replenishes
  w.tick += 1;

  w.outcome = evaluateEco(w);
  w.log = log;
  return w;
}

function hottestContact(live) {
  const c = live.filter((x) => x.detection >= 40).sort((a, b) => b.load - a.load)[0];
  return c || null;
}
function hottestUndetected(live) {
  return live.filter((x) => x.detection < DETECT_REVEAL).sort((a, b) => b.signature - a.signature)[0] || null;
}

export function evaluateEco(w) {
  for (const c of Object.values(w.colonies)) {
    if (c.transmitted) return { type: "transmit", winner: c.id, reason: `${c.id} transmitted` };
  }
  if (w.host.health <= 0) return { type: "host_death", winner: "none", reason: "host died (everyone loses)" };
  const liveCount = Object.values(w.colonies).filter((c) => c.alive && !c.transmitted).length;
  if (liveCount === 0) return { type: "cleared", winner: "immune", reason: "all colonies cleared" };
  if (w.tick >= MAX_TICKS) return { type: "contained", winner: "immune", reason: "immune contained everything to the time limit" };
  return null;
}

// ---- default policies (heuristic baselines) -------------------------------
export function defaultColonyPolicy(o) {
  if (o.me.load >= o.transmit_threshold && o.me.detected < 55) return "transmit";
  if (o.me.detected >= 45 || o.me.signature >= 30) return "hide";
  return "feed";
}
export function defaultImmunePolicy(o) {
  if (o.host.health <= 45 || o.host.inflammation >= 65) return "tolerize";
  const ready = o.contacts.filter((c) => c.detection >= 40).sort((a, b) => b.est_load - a.est_load)[0];
  if (ready && o.energy >= 3 && ready.est_load >= 35) return "strike:" + ready.id;
  const known = o.contacts.sort((a, b) => b.est_load - a.est_load)[0];
  if (known && o.energy >= 2 && known.est_load >= 30) return "contain:" + known.id;
  if (o.hidden_threat >= 15) return "scan"; // something's out there — go find it
  return "sweep";
}

// structuredClone exists in modern node/browser; fall back to a shallow-ish clone.
function structuredCloneish(w) {
  try { return structuredClone(w); }
  catch {
    return {
      ...w, host: { ...w.host }, immune: { ...w.immune },
      colonies: Object.fromEntries(Object.entries(w.colonies).map(([k, v]) => [k, { ...v }])),
      log: [],
    };
  }
}
