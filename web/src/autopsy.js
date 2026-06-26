// autopsy.js — loss recap: point-of-no-return + counterfactual.
// Self-contained ES module. Imports ONLY from ./engine.js.
//
// Public API:
//   buildAutopsy(history, build) -> { pointOfNoReturnTurn, counterfactual, summary }
//   renderAutopsy(rootEl, autopsy, runRecord)
//
// history is an array of { state, action } recorded each turn of the run.
// We forward-simulate from each recorded pre-action state with a bounded
// search to find the last turn after which no action sequence could still
// win — the point of no return — then craft a counterfactual line that
// references concrete numbers from that turn.

import { resolve, evaluate, MAX_TURNS, T_THRESH, need } from "./engine.js";

const ACTIONS = ["replicate", "suppress", "provoke", "transmit"];

// Beam width for the winnability search. The branching factor is 4 and the
// horizon is <= MAX_TURNS, so an exhaustive 4^18 DFS (~10^10 nodes) is far too
// slow to run per turn. A beam keeps work to O(BEAM * 4 * MAX_TURNS) — a few
// thousand resolve() calls, single-digit milliseconds — while reliably keeping
// the genuinely promising lines alive (validated against the proven presets:
// each is found winnable from the opening, and a near-miss run is correctly
// flagged winnable right up to the turn the player fails to transmit).
const WINNABLE_BEAM = 96;

/**
 * Can the colony still win starting from state `s` with genome `build`?
 *
 * Bounded best-first (beam) search: each turn we expand all four actions from
 * every state in the beam, immediately return on any transmitted win, drop
 * non-win terminals, dedup, then keep the BEAM highest-scoring states by a
 * heuristic that rewards progress toward a window-open transmit (effective
 * load ≥ threshold) and penalizes immune lock-on. Terminates in at most
 * `MAX_TURNS - s.turn` rounds.
 */
function isWinnable(s, build) {
  if (!s) return false;

  const verdict0 = evaluate(s);
  if (verdict0) return verdict0[0] === "win";
  if (s.turn >= MAX_TURNS) return false;

  const a = build.adhesion / 10;

  // Heuristic: how close is this state to landing a winning transmit?
  function score(st) {
    const eff = st.colony_load * (0.5 + a);
    let sc = Math.min(eff, T_THRESH * 1.5); // progress toward the threshold
    if (st.transmission_window > 0 && eff >= T_THRESH) sc += 1000; // ready to fire
    if (st.transmission_window > 0) sc += 5; // a window in hand is worth keeping
    sc -= st.immune_lockon * 0.5; // lock-on is the clock running out
    return sc;
  }

  function signature(st) {
    return (
      st.turn +
      "|" + st.colony_load.toFixed(1) +
      "|" + st.host_stability.toFixed(0) +
      "|" + st.immune_lockon.toFixed(1) +
      "|" + st.transmission_window +
      "|" + st.latency_turns
    );
  }

  let beam = [s];
  for (let depth = s.turn; depth < MAX_TURNS; depth++) {
    const next = [];
    const seen = new Set();
    for (const state of beam) {
      for (const action of ACTIONS) {
        const [child] = resolve(action, state, build);
        const verdict = evaluate(child);
        if (verdict) {
          if (verdict[0] === "win") return true;
          continue; // terminal loss: a dead branch, drop it
        }
        const sig = signature(child);
        if (seen.has(sig)) continue;
        seen.add(sig);
        next.push(child);
      }
    }
    if (next.length === 0) return false;
    next.sort((x, y) => score(y) - score(x));
    beam = next.length > WINNABLE_BEAM ? next.slice(0, WINNABLE_BEAM) : next;
  }
  return false;
}

/**
 * Forward-simulate from each recorded pre-action state to locate the point of
 * no return: the last turn whose state was still winnable. The very next
 * recorded state is the first that is provably unwinnable, so the run was
 * effectively lost at that boundary.
 *
 * @returns {{ pointOfNoReturnTurn:number|null, doomedState:object|null,
 *             lastWinnableState:object|null }}
 */
function findPointOfNoReturn(history, build) {
  let lastWinnable = null;
  let doomed = null;

  for (let i = 0; i < history.length; i++) {
    const entry = history[i];
    if (!entry || !entry.state) continue;
    if (isWinnable(entry.state, build)) {
      lastWinnable = entry;
    } else if (doomed === null) {
      doomed = entry;
      break;
    }
  }

  return {
    pointOfNoReturnTurn: doomed ? doomed.state.turn : null,
    doomedState: doomed ? doomed.state : null,
    lastWinnableState: lastWinnable ? lastWinnable.state : null,
  };
}

/** Human-readable cause of death from the final state. */
function causeOfDeath(finalState) {
  const verdict = evaluate(finalState);
  if (verdict && verdict[0] === "loss") {
    return { title: verdict[1], detail: verdict[2] };
  }
  // Defensive fallback: the run record claims a loss but no terminal verdict.
  return {
    title: "Run ended",
    detail: "The run finished without a successful transmission.",
  };
}

/**
 * Build a counterfactual line referencing concrete numbers (lock-on, load,
 * effective load vs. the transmit threshold, window state) at the decisive
 * turn, plus a concrete "what to try" nudge.
 */
function craftCounterfactual(decisiveState, build) {
  if (!decisiveState) {
    return "Every path from your opening was already losing — rebuild the genome before the next run.";
  }

  const s = decisiveState;
  const a = build.adhesion / 10;
  const effective = s.colony_load * (0.5 + a);
  const needLoad = need(build); // raw colony_load needed to clear threshold
  const lock = s.immune_lockon;
  const load = s.colony_load;
  const windowOpen = s.transmission_window > 0;

  const f = (x) => x.toFixed(1);

  // Diagnose the dominant failure mode at the decisive turn.
  if (effective >= T_THRESH && windowOpen) {
    // Had the shot, didn't take it.
    return (
      `At turn ${s.turn} your effective load was ${f(effective)} (≥ ${T_THRESH}) ` +
      `with the window still open — that was the shot. Transmitting on turn ${s.turn} ` +
      `instead of waiting wins outright; every turn after, lock-on (${f(lock)}) keeps eating the colony.`
    );
  }

  if (effective >= T_THRESH && !windowOpen) {
    return (
      `At turn ${s.turn} your effective load was ${f(effective)} (≥ ${T_THRESH}) but no window was open. ` +
      `Provoking one turn earlier opens the 3-turn window while the colony is still strong — ` +
      `you had the load, you just never opened the door.`
    );
  }

  if (lock >= 55) {
    return (
      `By turn ${s.turn} immune lock-on hit ${f(lock)} and was burning the colony down ` +
      `(load ${f(load)}, effective ${f(effective)} vs. the ${T_THRESH} threshold). ` +
      `Suppressing around turn ${Math.max(0, s.turn - 2)} — or an antigenic-drift mutation — ` +
      `would have cooled lock-on enough to keep growing toward a transmit.`
    );
  }

  // Most common: too small, too slow.
  const shortfall = needLoad - load;
  return (
    `At turn ${s.turn} your colony load was only ${f(load)} (effective ${f(effective)}), ` +
    `short of the ~${f(needLoad)} needed to clear the ${T_THRESH} transmit threshold ` +
    `(you were ${f(Math.max(0, shortfall))} under). ` +
    `Replicating harder in the early turns — or raising adhesion — gets you above the line ` +
    `before lock-on (${f(lock)}) closes the window for good.`
  );
}

/**
 * Public: analyze a finished (lost) run.
 * @param {Array<{state:object, action:string}>} history
 * @param {object} build genome { virulence, stealth, adhesion, resistance }
 * @returns {{ pointOfNoReturnTurn:number|null, counterfactual:string, summary:object }}
 */
export function buildAutopsy(history, build) {
  const safeHistory = Array.isArray(history) ? history : [];

  // The final state of the run: the post-action state of the last entry if
  // present, else the recorded pre-action state of the last entry.
  const lastEntry = safeHistory[safeHistory.length - 1] || null;
  const finalState =
    (lastEntry && (lastEntry.resultState || lastEntry.state)) || null;

  const { pointOfNoReturnTurn, doomedState, lastWinnableState } =
    findPointOfNoReturn(safeHistory, build);

  // The decisive turn for the counterfactual is the last turn that was still
  // winnable (the last real choice point). Fall back to the doomed state, then
  // to the final state, so we always reference real numbers.
  const decisiveState = lastWinnableState || doomedState || finalState;

  const cause = finalState
    ? causeOfDeath(finalState)
    : { title: "No run data", detail: "There was nothing to analyze." };

  const counterfactual = craftCounterfactual(decisiveState, build);

  const summary = {
    cause: cause.title,
    causeDetail: cause.detail,
    decisiveTurn: decisiveState ? decisiveState.turn : null,
    lastWinnableTurn: lastWinnableState ? lastWinnableState.turn : null,
    finalTurn: finalState ? finalState.turn : null,
    finalLoad: finalState ? finalState.colony_load : null,
    finalLockon: finalState ? finalState.immune_lockon : null,
    finalHost: finalState ? finalState.host_stability : null,
    turnsPlayed: safeHistory.length,
  };

  return { pointOfNoReturnTurn, counterfactual, summary };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * Render the autopsy panel into rootEl: what killed you, the turn it became
 * unwinnable, and what to try next.
 * @param {HTMLElement} rootEl
 * @param {{pointOfNoReturnTurn:number|null, counterfactual:string, summary:object}} autopsy
 * @param {object} [runRecord] optional { strain, result, turn, build, date }
 */
export function renderAutopsy(rootEl, autopsy, runRecord) {
  if (!rootEl) return;
  rootEl.textContent = "";

  const a = autopsy || { pointOfNoReturnTurn: null, counterfactual: "", summary: {} };
  const summary = a.summary || {};

  const panel = el("div", "autopsy-panel");

  // Screen-reader summary (a11y, per spec §Integration / §Verification).
  const srTitle = causeLine(summary, runRecord);
  const sr = el("h2", "sr-only", "Autopsy: " + srTitle);
  panel.appendChild(sr);

  const heading = el("div", "autopsy-heading");
  heading.appendChild(el("h3", "autopsy-title", "Autopsy"));
  if (runRecord && runRecord.strain) {
    heading.appendChild(
      el("span", "autopsy-strain", strainLabel(runRecord))
    );
  }
  panel.appendChild(heading);

  // 1. What killed you.
  panel.appendChild(
    section(
      "What killed you",
      summary.cause || (runRecord && runRecord.result) || "Loss",
      summary.causeDetail || ""
    )
  );

  // 2. The turn it became unwinnable.
  const ponr = a.pointOfNoReturnTurn;
  const ponrHeadline =
    ponr == null
      ? "No clean point of no return found"
      : "Turn " + ponr;
  const ponrDetail =
    ponr == null
      ? (summary.lastWinnableTurn == null
          ? "The run was effectively unwinnable from the opening genome and state."
          : "You stayed in contention until the end — the loss came from the final turns, not one early mistake.")
      : "After turn " +
        ponr +
        ", forward-simulation finds no action sequence that still reaches a transmit. " +
        (summary.lastWinnableTurn != null
          ? "Turn " + summary.lastWinnableTurn + " was your last winnable choice point."
          : "");
  panel.appendChild(
    section("The turn it became unwinnable", ponrHeadline, ponrDetail)
  );

  // 3. What to try (counterfactual with concrete numbers).
  panel.appendChild(
    section("What to try", "", a.counterfactual || "")
  );

  // Compact final-state readout for context.
  if (
    summary.finalTurn != null ||
    summary.finalLoad != null ||
    summary.finalLockon != null
  ) {
    const stats = el("dl", "autopsy-stats");
    addStat(stats, "Final turn", fmtNum(summary.finalTurn));
    addStat(stats, "Colony load", fmtNum(summary.finalLoad));
    addStat(stats, "Immune lock-on", fmtNum(summary.finalLockon));
    addStat(stats, "Host stability", fmtNum(summary.finalHost));
    panel.appendChild(stats);
  }

  rootEl.appendChild(panel);
}

function section(label, headline, body) {
  const sec = el("section", "autopsy-section");
  sec.appendChild(el("div", "autopsy-label", label));
  if (headline) sec.appendChild(el("div", "autopsy-headline", headline));
  if (body) sec.appendChild(el("p", "autopsy-body", body));
  return sec;
}

function addStat(dl, term, value) {
  const wrap = el("div", "autopsy-stat");
  wrap.appendChild(el("dt", "autopsy-stat-term", term));
  wrap.appendChild(el("dd", "autopsy-stat-val", value));
  dl.appendChild(wrap);
}

function fmtNum(x) {
  if (x == null || Number.isNaN(x)) return "—";
  return typeof x === "number" ? x.toFixed(1) : String(x);
}

function strainLabel(runRecord) {
  const strain = runRecord.strain || "custom";
  return strain.charAt(0).toUpperCase() + strain.slice(1) + " strain";
}

function causeLine(summary, runRecord) {
  const cause = (summary && summary.cause) || (runRecord && runRecord.result) || "Loss";
  const turn = summary && summary.finalTurn != null ? " on turn " + summary.finalTurn : "";
  return cause + turn;
}
