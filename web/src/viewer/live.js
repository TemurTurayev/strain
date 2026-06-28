// live.js — in-engine recorder (no DOM; runs in both browser and Node). Wraps the
// real ecosystem engine + a seeded RNG to produce a fresh EcoReplay v1 synchronously
// for "Run live / re-seed". The same buildFrame is reused by agent/record.mjs.
import {
  freshEcosystem, observeEco, resolveEcoTick, colonyIds,
  defaultColonyPolicy, defaultImmunePolicy,
  ZONES, ADJ, EXIT_THRESH, EXITS, MAX_TICKS,
  QUORUM_TRANSMIT, QUORUM_TOXIN, DETECT_REVEAL, LOCK_TO_STRIKE, LOCK_TO_TRANSMIT,
} from "../ecosystem.mjs";

const PALETTE = ["#e5484d", "#30a46c", "#e2a336", "#8e6cd9"];

export function makeSeededRng(seed) {
  let h = 1779033703 ^ String(seed ?? "strain").length;
  for (const ch of String(seed ?? "strain")) { h = Math.imul(h ^ ch.charCodeAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const EXPORT_CONFIG = {
  ZONES, ADJ, EXIT_THRESH, EXITS, QUORUM_TRANSMIT, QUORUM_TOXIN,
  DETECT_REVEAL, LOCK_TO_STRIKE, LOCK_TO_TRANSMIT, MAX_TICKS,
};

const snap = (o) => JSON.parse(JSON.stringify(o));

// build one canonical Frame from the START-of-tick world + the actions about to
// fire + the log that resolving them produced.
export function buildFrame(world, actions, log) {
  const zones = {};
  for (const z of ZONES) {
    const zw = world.zones[z];
    zones[z] = {
      glucose: +zw.glucose.toFixed(1), iron: +zw.iron.toFixed(1), oxygen: zw.oxygen,
      immune_presence: +zw.immune_presence.toFixed(2), inflammation: +zw.inflammation.toFixed(1),
      drainLast: +zw.drainLast.toFixed(1), sweptLast: !!zw.sweptLast,
      contained: zw.containTimer > 0, containTimer: zw.containTimer,
      is_exit: EXITS.includes(z), fibrosis: +zw.fibrosis.toFixed(1),
    };
  }
  const colonies = {};
  for (const id of colonyIds(world)) {
    const c = world.colonies[id];
    colonies[id] = {
      alive: c.alive, transmitted: c.transmitted,
      presence: snap(c.presence), signature: snap(c.signature),
      lock: +c.lock.toFixed(1), memory: +c.memory.toFixed(1), sm: +c.sm.toFixed(1),
      resistance: +(c.resistance ?? 0).toFixed(3), virulence: +(c.virulence ?? 0).toFixed(3),
    };
  }
  const views = {};
  for (const id of colonyIds(world)) {
    const c = world.colonies[id];
    if (c.alive && !c.transmitted) views[id] = observeEco(world, id);
  }
  views.immune = observeEco(world, "immune");
  return {
    tick: world.tick,
    host: { integrity: +world.host.integrity.toFixed(1), toxin: +world.host.toxin.toFixed(1) },
    zones, colonies,
    actions: { ...actions },
    log: (log || []).slice(),
    views,
  };
}

// epsilon-greedy seeded noise so each seed plays a distinct (but deterministic) game.
function noisy(policy, legalFor, rng) {
  return (o) => {
    if (rng() < 0.12) { const legal = legalFor(o); return legal[Math.floor(rng() * legal.length)]; }
    return policy(o);
  };
}
const colonyLegal = (o) => {
  const adj = (o.zones[o.me.dominant_zone]?.adjacent) || [];
  return ["feed", "hide", "toxin", "transmit", ...adj.map((z) => "move:" + z), ...adj.map((z) => "scout:" + z)];
};
const immuneLegal = (o) => ["tolerize", ...ZONES.map((z) => "sweep:" + z), ...ZONES.map((z) => "contain:" + z),
  ...o.contacts.flatMap((c) => ["scan:" + c.id, "strike:" + c.id])];

export function runLiveGame({ seed, genomes, controllers } = {}) {
  seed = seed ?? "strain-" + (genomes ? genomes.length : 0);
  const rng = makeSeededRng(seed);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  if (!genomes || !genomes.length) {
    genomes = [
      { id: "A", stealth: 2 + rng() * 6, preferredO2: 10 + rng() * 80, home: pick(["gut", "lung"]) },
      { id: "B", stealth: 2 + rng() * 6, preferredO2: 10 + rng() * 80, home: pick(["gut", "lung"]) },
    ];
  }
  const colCtl = noisy(defaultColonyPolicy, colonyLegal, rng);
  const immCtl = noisy(defaultImmunePolicy, immuneLegal, rng);
  const ctl = (controllers && Object.keys(controllers).length) ? controllers : null;

  let w = freshEcosystem(genomes);
  const ids = colonyIds(w);
  const frames = [];
  for (let i = 0; i < MAX_TICKS + 2 && !w.outcome; i++) {
    const factionList = [...ids.filter((id) => w.colonies[id].alive && !w.colonies[id].transmitted), "immune"];
    const actions = {};
    for (const f of factionList) {
      const o = observeEco(w, f);
      actions[f] = ctl && ctl[f] ? ctl[f](o) : (f === "immune" ? immCtl(o) : colCtl(o));
    }
    const next = resolveEcoTick(w, actions);
    frames.push(buildFrame(w, actions, next.log));
    w = next;
  }
  frames.push(buildFrame(w, {}, w.log)); // terminal state

  const meta = {};
  ids.sort().forEach((id, k) => { meta[id] = { color: PALETTE[k % PALETTE.length], label: `Strain ${id}` }; });
  return {
    format: "eco-replay", version: 1, seed,
    source: "heuristic",
    controllers: Object.fromEntries(factionNames(ids).map((f) => [f, "heuristic"])),
    config: EXPORT_CONFIG,
    genomes, colonyMeta: meta,
    outcome: w.outcome || { type: "contained", winner: "immune", reason: "time", tick: w.tick },
    frames,
  };
}

function factionNames(ids) { return [...ids, "immune"]; }
