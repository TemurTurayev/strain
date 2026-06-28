// replay.js — the viewer's pure DATA layer and the frozen recording contract.
// No DOM, no canvas. Loads a recorded EcoReplay v1 (from live.js or agent/record.mjs)
// OR a bare playEcosystem transcript, and normalises both into a canonical Frame[].
// Owns the single log parser, frame interpolation, and all derivations.
//
// ── Frame[] CONTRACT (frozen) ───────────────────────────────────────────────
// EcoReplay { format:"eco-replay", version:1, seed, source, controllers, config,
//             genomes, colonyMeta, outcome, frames:[Frame] }
// Frame {                                   // WORLD STATE AT START OF TICK t
//   tick,
//   host:{ integrity, toxin },
//   zones:{ <z>:{ glucose,iron,oxygen,immune_presence,inflammation,drainLast,
//                 sweptLast,contained,containTimer,is_exit,fibrosis } },
//   colonies:{ <id>:{ alive,transmitted,presence:{<z>},signature:{<z>},
//                     lock,memory,sm,resistance,virulence } },
//   actions:{ <id>:"<actionString>", immune:"<actionString>" },
//   log:[ "<raw engine log line>" ],
//   views:{ <id>:<observeEco(w,id)>, immune:<observeEco(w,"immune")> } }  // optional
// ────────────────────────────────────────────────────────────────────────────

export const ZONE_KEYS = ["gut", "blood", "lung", "lymph"];

const DEFAULT_CONFIG = {
  ZONES: ZONE_KEYS,
  ADJ: { gut: ["blood"], lung: ["blood"], blood: ["gut", "lung", "lymph"], lymph: ["blood"] },
  EXIT_THRESH: { gut: 70, lung: 65 },
  EXITS: ["gut", "lung"],
  QUORUM_TRANSMIT: 75, QUORUM_TOXIN: 35, DETECT_REVEAL: 25,
  LOCK_TO_STRIKE: 40, LOCK_TO_TRANSMIT: 70, MAX_TICKS: 60,
};

const PALETTE = ["#e5484d", "#30a46c", "#e2a336", "#8e6cd9", "#0091ff", "#e54666"];

// ── loading / normalisation ─────────────────────────────────────────────────
export function loadReplay(jsonOrReplay) {
  const r = (jsonOrReplay && jsonOrReplay.format === "eco-replay")
    ? jsonOrReplay
    : normalizeTranscript(jsonOrReplay, {});
  r.config = { ...DEFAULT_CONFIG, ...(r.config || {}) };
  if (!r.colonyMeta) r.colonyMeta = autoMeta(r);
  return r;
}

export function validateReplay(obj) {
  // tolerant: ensure we hand back something with a frames[] array. Throw only on
  // input we cannot interpret at all, so controls.js can surface a clean error.
  if (!obj) throw new Error("empty replay");
  if (obj.format === "eco-replay" && Array.isArray(obj.frames)) return obj;
  if (Array.isArray(obj) || Array.isArray(obj.transcript) || Array.isArray(obj.frames)) {
    return normalizeTranscript(obj, {});
  }
  throw new Error("unrecognised replay shape");
}

// accepts: an EcoReplay (passthrough), a bare transcript array, or a
// playEcosystem result { transcript:[...], winner, reason, tick }.
export function normalizeTranscript(raw, meta = {}) {
  if (raw && raw.format === "eco-replay") return raw;

  const transcript = Array.isArray(raw) ? raw : (raw && raw.transcript) || [];
  const outcome = (raw && raw.winner)
    ? { type: raw.type || "transmit", winner: raw.winner, reason: raw.reason, tick: raw.tick }
    : { type: "unknown", winner: "none", reason: "", tick: transcript.length };

  const ids = transcript.length ? Object.keys(transcript[0].colonies || {}) : [];
  const frames = transcript.map((row) => degradeRow(row, ids));

  const r = {
    format: "eco-replay", version: 1, seed: meta.seed ?? null,
    source: meta.source || "transcript",
    controllers: meta.controllers || {},
    config: { ...DEFAULT_CONFIG, ...(meta.config || {}) },
    genomes: meta.genomes || ids.map((id) => ({ id })),
    colonyMeta: meta.colonyMeta || null,
    outcome,
    frames,
  };
  r.colonyMeta = r.colonyMeta || autoMeta(r);
  return r;
}

// a bare transcript row -> a partial Frame (one blob per colony on its dom zone,
// no per-zone env, no private views). Keeps old/LLM transcripts playable.
function degradeRow(row, ids) {
  const colonies = {};
  for (const id of ids) {
    const c = row.colonies[id] || {};
    const zone = c.zone || "gut";
    const presence = Object.fromEntries(ZONE_KEYS.map((z) => [z, z === zone ? (c.load || 0) : 0]));
    colonies[id] = {
      alive: c.act !== "—dead—", transmitted: c.act === "—done—",
      presence, signature: Object.fromEntries(ZONE_KEYS.map((z) => [z, 0])),
      lock: c.lock || 0, memory: c.memory || 0, sm: 0,
    };
  }
  const actions = {};
  for (const id of ids) actions[id] = (row.colonies[id] || {}).act || "—";
  actions.immune = row.immune;
  return {
    tick: row.tick,
    host: { integrity: row.host?.integrity ?? 100, toxin: row.host?.toxin ?? 0 },
    zones: undefined,            // env unknown in a bare transcript -> render hides that layer
    colonies, actions,
    log: row.log || [],
    views: undefined,            // private views not recorded -> panels show the notice
  };
}

function autoMeta(r) {
  const ids = r.frames.length ? Object.keys(r.frames[0].colonies || {}) : (r.genomes || []).map((g) => g.id);
  const meta = {};
  ids.sort().forEach((id, i) => { meta[id] = { color: PALETTE[i % PALETTE.length], label: `Strain ${id}` }; });
  return meta;
}

// ── interpolation ────────────────────────────────────────────────────────────
export function lerpFrame(replay, tick, alpha) {
  const frames = replay.frames || [];
  if (!frames.length) return null;
  const i = Math.max(0, Math.min(frames.length - 1, Math.floor(tick)));
  const a = frames[i];
  const b = frames[Math.min(frames.length - 1, i + 1)];
  if (!b || b === a || !a.zones || !b.zones) return a; // discrete-only / degraded -> snap
  const t = Math.max(0, Math.min(1, alpha));
  const lerp = (x, y) => x + (y - x) * t;

  const zones = {};
  for (const z of ZONE_KEYS) {
    const za = a.zones[z] || {}, zb = b.zones[z] || {};
    zones[z] = { ...za,
      glucose: lerp(za.glucose || 0, zb.glucose || 0),
      iron: lerp(za.iron || 0, zb.iron || 0),
      inflammation: lerp(za.inflammation || 0, zb.inflammation || 0),
      fibrosis: lerp(za.fibrosis || 0, zb.fibrosis || 0),
    };
  }
  const colonies = {};
  for (const id of Object.keys(a.colonies || {})) {
    const ca = a.colonies[id], cb = (b.colonies || {})[id] || ca;
    const presence = {};
    for (const z of ZONE_KEYS) presence[z] = lerp((ca.presence || {})[z] || 0, (cb.presence || {})[z] || 0);
    colonies[id] = { ...ca, presence, lock: lerp(ca.lock || 0, cb.lock || 0) };
  }
  return { ...a, host: { integrity: lerp(a.host.integrity, b.host.integrity), toxin: lerp(a.host.toxin, b.host.toxin) }, zones, colonies };
}

// ── derivations (never stored in the record) ────────────────────────────────
export function derive(frame) {
  if (!frame || !frame.colonies) return {};
  const totals = Object.fromEntries(ZONE_KEYS.map((z) => [z, 0]));
  for (const c of Object.values(frame.colonies)) {
    for (const z of ZONE_KEYS) totals[z] += (c.presence || {})[z] || 0;
  }
  const dominant_zone = ZONE_KEYS.reduce((b, z) => (totals[z] > totals[b] ? z : b), ZONE_KEYS[0]);
  return { dominant_zone, zoneTotals: totals };
}

// ── log parsing (single source; matches the engine's Unicode minus U+2212) ──
export function parseLog(logLines) {
  const events = [];
  for (const line of logLines || []) {
    let m;
    if ((m = line.match(/(\w+) TRANSMIT ✓ via (\w+)/))) events.push({ type: "transmit", colony: m[1], zone: m[2] });
    else if ((m = line.match(/immune strike (\w+)@(\w+) [−-]([\d.]+)/))) events.push({ type: "strike", colony: m[1], zone: m[2], damage: +m[3] });
    else if ((m = line.match(/(\w+) cleared/))) events.push({ type: "cleared", colony: m[1] });
    else if ((m = line.match(/(\w+) toxin@(\w+)/))) events.push({ type: "toxin", colony: m[1], zone: m[2] });
    else if ((m = line.match(/immune sweep (\w+)/))) events.push({ type: "sweep", zone: m[1] });
    else if ((m = line.match(/(\w+) snitch -> (\w+)@(\w+)/))) events.push({ type: "snitch", colony: m[1], target: m[2], zone: m[3] });
    else if ((m = line.match(/immune investigate (\w+) -> localised (\w+)/))) events.push({ type: "investigate", zone: m[1], colony: m[2] });
  }
  return events;
}

export function eventsAt(replay, tick) {
  const frames = replay.frames || [];
  const i = Math.max(0, Math.min(frames.length - 1, Math.floor(tick)));
  return parseLog((frames[i] || {}).log);
}
