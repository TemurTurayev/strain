// history.js — localStorage run history + best transmission turn.
// Self-contained ES module. Imports ONLY from ./engine.js.
//
// A run record has the shape:
//   { strain, result, turn, build, date }
// where `result` is the engine verdict string ("win" | "loss"),
// `turn` is the turn the run ended on, `build` is the genome object,
// `strain` is the preset/strain key or name, and `date` is an ISO string.
//
// Persistence is keyed under `strain.runs`. All storage access is guarded
// against malformed JSON, missing storage (e.g. private mode / no DOM), and
// non-array payloads so the game never crashes on a corrupt history.

import { MAX_TURNS } from "./engine.js?v=3";

const STORAGE_KEY = "strain.runs";

/**
 * Resolve the localStorage implementation, or null if it is unavailable.
 * Wrapped in try/catch because accessing `localStorage` can throw in some
 * privacy modes and is simply undefined outside a browser (e.g. node).
 * @returns {Storage|null}
 */
function getStore() {
  try {
    if (typeof localStorage === "undefined" || localStorage === null) return null;
    return localStorage;
  } catch (error) {
    return null;
  }
}

/**
 * Read and parse the raw runs array from storage.
 * Returns a fresh array; never throws. Any malformed or non-array payload
 * yields an empty list rather than propagating an error.
 * @returns {Array<object>}
 */
function readRaw() {
  const store = getStore();
  if (!store) return [];
  let serialized;
  try {
    serialized = store.getItem(STORAGE_KEY);
  } catch (error) {
    return [];
  }
  if (serialized == null || serialized === "") return [];
  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  // Keep only plausibly-shaped records (defensive against partial corruption).
  return parsed.filter((r) => r != null && typeof r === "object");
}

/**
 * Persist the runs array to storage. Silently no-ops if storage is missing
 * or write fails (e.g. quota exceeded), so callers never have to guard.
 * @param {Array<object>} runs
 */
function writeRaw(runs) {
  const store = getStore();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(runs));
  } catch (error) {
    // Quota or serialization failure — drop silently; history is non-critical.
  }
}

/**
 * Coerce an arbitrary turn value into a finite, in-range integer or null.
 * @param {*} value
 * @returns {number|null}
 */
function normalizeTurn(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (i < 0) return null;
  // MAX_TURNS bounds the engine's run length; clamp the upper edge defensively.
  return Math.min(i, MAX_TURNS);
}

/**
 * Build a clean, immutable record from a (possibly partial) input record.
 * Always stamps a date if one is absent. Returns a new object (no mutation).
 * @param {object} record
 * @returns {{strain: *, result: *, turn: (number|null), build: *, date: string}}
 */
function normalizeRecord(record) {
  const src = record != null && typeof record === "object" ? record : {};
  let date = typeof src.date === "string" && src.date !== "" ? src.date : "";
  if (date === "") {
    try {
      date = new Date().toISOString();
    } catch (error) {
      date = "";
    }
  }
  return {
    strain: src.strain ?? null,
    result: src.result ?? null,
    turn: normalizeTurn(src.turn),
    build: src.build ?? null,
    date,
  };
}

/**
 * Append a run to history (newest is stored last internally; loadRuns reverses).
 * Malformed input is normalized rather than rejected, so a bad call can never
 * throw from the play loop. No-op-safe when storage is unavailable.
 * @param {{strain:*, result:*, turn:*, build:*, date?:string}} record
 * @returns {object} the normalized record that was saved
 */
export function saveRun(record) {
  const normalized = normalizeRecord(record);
  const runs = readRaw();
  writeRaw([...runs, normalized]);
  return normalized;
}

/**
 * Load all stored runs, newest first.
 * @returns {Array<object>}
 */
export function loadRuns() {
  const runs = readRaw();
  // Stored append-order is oldest→newest; reverse a copy for newest-first.
  return [...runs].reverse();
}

/**
 * Lowest (best) turn among winning runs, or null if there are no wins.
 * A "win" is any record whose `result` is the engine verdict string "win".
 * @returns {number|null}
 */
export function bestTransmissionTurn() {
  const runs = readRaw();
  let best = null;
  for (const run of runs) {
    if (!run || run.result !== "win") continue;
    const turn = normalizeTurn(run.turn);
    if (turn == null) continue;
    if (best == null || turn < best) best = turn;
  }
  return best;
}
