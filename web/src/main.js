// STRAIN — orchestrator (finished build).
//
// Wires the canonical engine and every feature module into the DOM contract:
//   menu → build (preset or custom genome) → play (bars + colony + hints +
//   actions + in-run mutations) → terminal (win panel or autopsy on loss).
//
// Module roles:
//   engine.js    → pure logic (resolve / evaluate / mutation offers / applyMutation)
//   genome.js    → mountBuildScreen(buildRoot, onStart) — preset or custom genome
//   mutations.js → offerMutations(state) + mountMutationModal(host, choices, onPick)
//   colony.js    → mountColony(canvas) / updateColony(state, build)
//   juice.js     → flash / shake / popNumber on action + immune events
//   hints.js     → hint(state, build) → { icon, text } fills #hint
//   autopsy.js   → buildAutopsy(history, build) + renderAutopsy(host, autopsy, record)
//   history.js   → saveRun(record) / bestTransmissionTurn()
//   audio.js     → initAudio() / play(name) / setMuted(bool) / isMuted()

import {
  MAX_TURNS,
  T_THRESH,
  COL_VIS,
  START_HOST,
  need,
  freshState,
  resolve,
  evaluate,
  applyMutation,
} from "./engine.js";

import { mountBuildScreen } from "./genome.js?v=2";
import { offerMutations, mountMutationModal } from "./mutations.js?v=2";
import { mountColony, updateColony, stopColony, pulse, playEnding } from "./colony.js?v=2";
import { flash, shake, popNumber } from "./juice.js?v=2";
import { hint } from "./hints.js?v=2";
import { buildAutopsy, renderAutopsy } from "./autopsy.js?v=2";
import { saveRun, bestTransmissionTurn } from "./history.js?v=2";
import { initAudio, play, setMuted, isMuted } from "./audio.js?v=2";
import { countUp, burst } from "./fx.js?v=2";
import { isFirstVisit, markSeen, openHowTo, closeHowTo } from "./tutorial.js?v=2";

// ----------------------------------------------------------------------------
// DOM lookups (per §DOM contract)
// ----------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

const screens = {
  intro: $("screen-intro"),
  menu: $("screen-menu"),
  build: $("screen-build"),
  play: $("screen-play"),
  autopsy: $("screen-autopsy"),
};

const els = {
  srSummary: $("sr-summary"),
  // menu
  newRun: $("btn-new-run"),
  bestScore: $("best-score"),
  audioToggle: $("audio-toggle"),
  // build
  buildRoot: $("build-root"),
  backMenu: $("btn-back-menu"),
  // play header
  strainTitle: $("strain-title"),
  turnNow: $("turn-now"),
  audioTogglePlay: $("audio-toggle-play"),
  // play stats
  statColony: $("stat-colony"),
  markColony: $("mark-colony"),
  valColony: $("val-colony"),
  statHost: $("stat-host"),
  valHost: $("val-host"),
  statLock: $("stat-lock"),
  valLock: $("val-lock"),
  windowPill: $("window-pill"),
  valInfl: $("val-infl"),
  fixation: $("fixation"),
  fixationFill: $("fixation-fill"),
  speedToggle: $("speed-toggle"),
  // play body
  canvas: $("colony-canvas"),
  hint: $("hint"),
  acts: $("acts"),
  mutModal: $("mut-modal"),
  log: $("log"),
  // autopsy / result
  autopsyRoot: $("autopsy-root"),
  // intro + how-to
  introContinue: $("btn-intro-continue"),
  introHowto: $("btn-intro-howto"),
  howto: $("btn-howto"),
  howtoPlay: $("btn-howto-play"),
  howtoOverlay: $("howto-overlay"),
};

// ----------------------------------------------------------------------------
// Run state (module-local; rebuilt on each new run)
// ----------------------------------------------------------------------------
let build = null; // current strain genome { key, name, virulence, stealth, adhesion, resistance, ... }
let state = null; // current engine state
let history = []; // [{ state, action }] — pre-action snapshots, consumed by autopsy.js
let awaitingMutation = false; // true while the mutation modal is blocking input
let beatActive = false; // true while a turn's consequence is playing out (input locked)
let speed = 1; // simulation speed: 1 | 2 | 4 (scales the beat duration)

const BEAT_BASE_MS = 750;
function beatDuration() { return Math.max(220, BEAT_BASE_MS / speed); }

// ----------------------------------------------------------------------------
// Screen routing
// ----------------------------------------------------------------------------
function show(name) {
  for (const key in screens) {
    screens[key].classList.toggle("active", key === name);
  }
}

// ----------------------------------------------------------------------------
// Small safe DOM builder (avoid innerHTML with interpolated values)
// ----------------------------------------------------------------------------
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const k in props) {
    if (k === "class") node.className = props[k];
    else if (k === "text") node.textContent = props[k];
    else if (k.startsWith("aria-") || k === "role" || k === "type")
      node.setAttribute(k, props[k]);
    else if (k.startsWith("data-")) node.setAttribute(k, props[k]);
    else node[k] = props[k];
  }
  for (const c of children) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// ----------------------------------------------------------------------------
// Menu
// ----------------------------------------------------------------------------
function renderMenu() {
  stopColony();
  const best = bestTransmissionTurn();
  els.bestScore.textContent = best == null ? "—" : String(best);
  setSummary("Strain. Choose a strain to begin a new run.");
  show("menu");
}

// ----------------------------------------------------------------------------
// Build / draft screen (genome.js owns the contents of #build-root)
// ----------------------------------------------------------------------------
function renderBuild() {
  stopColony();
  mountBuildScreen(els.buildRoot, startRun);
  setSummary(
    "Build screen. Pick a proven strain or allocate a custom genome of " +
      "twenty points, then start the run."
  );
  show("build");
}

// ----------------------------------------------------------------------------
// Run lifecycle
// ----------------------------------------------------------------------------
function startRun(selectedBuild) {
  build = selectedBuild;
  state = freshState();
  history = [];
  awaitingMutation = false;

  els.strainTitle.textContent = build.name || "Strain";
  clear(els.log);
  clear(els.mutModal);

  // Bind the colony visualization to its canvas for this run.
  mountColony(els.canvas);

  // Audio is created on a real user gesture (the click that started the run).
  initAudio();

  setActionsEnabled(true);
  render();
  appendLog(
    [["", "strain " + build.name + " — break out before turn " + MAX_TURNS]],
    false
  );
  show("play");
}

function onAction(action) {
  if (!state || awaitingMutation || beatActive) return;
  if (state.transmitted || evaluate(state)) return; // already terminal

  // Engine step (numbers are known immediately).
  const [next, log] = resolve(action, state, build);

  // Record the pre-action snapshot AND the resolved result so autopsy can read
  // the true terminal state (not the pre-action state of the final turn).
  history = [...history, { state, action, resultState: next }];
  state = next;

  appendLog(log, true);

  // Juice + audio reactions keyed off the action and the resolved log.
  reactToLog(action, log);

  render(); // bars ease, numbers count up, the colony plays the consequence

  // Lock input and let the beat play out; resolve the outcome once it settles.
  beatActive = true;
  setActionsEnabled(false);
  window.setTimeout(afterBeat, beatDuration());
}

function afterBeat() {
  beatActive = false;

  // Terminal check — play the finale animation, THEN show the result.
  const verdict = evaluate(state);
  if (verdict) {
    setActionsEnabled(false);
    playEnding(endingKind(verdict), () => finishRun(verdict));
    return;
  }

  // In-run breakthrough mutation: block input, show the modal, apply the pick
  // (engine.applyMutation) before the next action is allowed.
  const choices = offerMutations(state);
  if (choices.length > 0) {
    promptMutation(choices);
    return;
  }

  setActionsEnabled(true);
}

function promptMutation(choices) {
  awaitingMutation = true;
  setActionsEnabled(false);
  play("window"); // a soft cue that an adaptation is on offer

  mountMutationModal(els.mutModal, choices, (mutation) => {
    if (mutation) {
      const result = applyMutation(mutation, state, build);
      state = result.state;
      build = result.build;
      appendLog([["", "mutation → " + mutation.name + " (" + mutation.desc + ")"]], false);
    } else {
      appendLog([["", "mutation → skipped"]], false);
    }
    awaitingMutation = false;
    setActionsEnabled(true);
    render();
  });
}

function endingKind(verdict) {
  const [outcome, title] = verdict;
  if (outcome === "win") return "win";
  if (title === "Out of time") return "timeout";
  if (title === "Host collapsed") return "host";
  return "cleared";
}

function finishRun(verdict) {
  const [outcome, title, detail] = verdict;
  setActionsEnabled(false);
  stopColony();

  const record = {
    strain: build.key || build.name,
    result: outcome,
    turn: state.turn,
    build: { ...build },
    date: new Date().toISOString(),
  };
  saveRun(record);

  // Audio sting for the outcome.
  play(outcome === "win" ? "win" : "loss");

  if (outcome === "win") {
    renderWin(title, detail, record);
  } else {
    renderLoss(record);
  }
}

// ----------------------------------------------------------------------------
// Terminal screens
// ----------------------------------------------------------------------------
function resultActions() {
  const again = el("button", {
    id: "btn-again",
    class: "btn btn-primary",
    type: "button",
    text: "Play again",
  });
  const menu = el("button", {
    id: "btn-menu",
    class: "btn",
    type: "button",
    text: "Main menu",
  });
  again.addEventListener("click", renderBuild);
  menu.addEventListener("click", renderMenu);
  return el("div", { class: "menu-actions" }, [again, menu]);
}

function renderWin(title, detail, record) {
  clear(els.autopsyRoot);
  const best = bestTransmissionTurn();

  const children = [
    el("span", { class: "result-badge win", text: "Win" }),
    el("h2", { text: title }),
    el("p", { text: detail }),
    el("p", {
      class: "turn-counter",
      text: "Transmitted on turn " + record.turn + " of " + MAX_TURNS + ".",
    }),
  ];
  if (best != null) {
    children.push(
      el("p", { class: "best-score", text: "Best transmission turn: " + best })
    );
  }
  children.push(resultActions());

  els.autopsyRoot.appendChild(el("div", { class: "card result" }, children));
  setSummary("Win. " + title + ". " + detail);
  show("autopsy");
}

function renderLoss(record) {
  clear(els.autopsyRoot);

  // autopsy.js analyses the recorded pre-action history to find the point of no
  // return and craft a numbers-backed counterfactual, then renders the panel.
  const autopsy = buildAutopsy(history, build);

  const wrap = el("div", { class: "card result loss-card" });
  els.autopsyRoot.appendChild(wrap);
  renderAutopsy(wrap, autopsy, record);
  wrap.appendChild(resultActions());

  const ponr = autopsy.pointOfNoReturnTurn;
  setSummary(
    "Loss. " +
      (autopsy.summary && autopsy.summary.cause ? autopsy.summary.cause + ". " : "") +
      (ponr != null
        ? "The run became unwinnable after turn " + ponr + "."
        : "You stayed in contention to the end.")
  );
  show("autopsy");
}

// ----------------------------------------------------------------------------
// Rendering: stat bars, window pill, hint, colony, log
// ----------------------------------------------------------------------------
function render() {
  // Turn counter.
  els.turnNow.textContent = String(state.turn);

  // Colony load bar (0..COL_VIS scale) + transmit-able tick marker.
  const colonyPct = clampPct((state.colony_load / COL_VIS) * 100);
  els.statColony.style.width = colonyPct + "%";
  countUp(els.valColony, state.colony_load, { decimals: 1 });
  const markPct = clampPct((need(build) / COL_VIS) * 100);
  els.markColony.style.left = markPct + "%";

  // Host stability bar (0..START_HOST scale).
  const hostPct = clampPct((state.host_stability / START_HOST) * 100);
  els.statHost.style.width = hostPct + "%";
  countUp(els.valHost, Math.max(0, state.host_stability), { decimals: 1 });

  // Immune lock-on bar (0..100), tinting accent → warning → danger.
  const lockPct = clampPct(state.immune_lockon);
  els.statLock.style.width = lockPct + "%";
  countUp(els.valLock, state.immune_lockon, { decimals: 1 });
  els.statLock.style.background =
    state.immune_lockon >= 70
      ? "var(--danger)"
      : state.immune_lockon >= 40
      ? "var(--warning)"
      : "var(--accent)";

  // Inflammation readout.
  countUp(els.valInfl, state.inflammation, { decimals: 1 });

  // Immune fixation — the real clock. Fills one notch per turn and hits exactly
  // 100% on the turn the host corners you, so the bar never lies.
  const fix = clampPct((state.turn / MAX_TURNS) * 100);
  if (els.fixationFill) {
    els.fixationFill.style.width = fix + "%";
    els.fixationFill.style.background =
      fix >= 75 ? "var(--danger)" : fix >= 45 ? "var(--warning)" : "var(--accent)";
  }
  if (els.fixation) els.fixation.textContent = Math.round(fix) + "%";

  // Window pill (glow when open; success-tinted when a transmit would land).
  renderWindowPill();

  // Transmit only enabled while a window is open (and input isn't blocked).
  const transmitBtn = els.acts.querySelector('[data-k="transmit"]');
  if (transmitBtn) {
    transmitBtn.disabled = awaitingMutation || state.transmission_window <= 0;
    transmitBtn.title =
      state.transmission_window > 0 ? "" : "Open a window first — provoke a symptom.";
  }

  // Living colony visualization.
  updateColony(state, build);

  // Contextual hint.
  renderHint();

  updateSummary();
}

function renderWindowPill() {
  const open = state.transmission_window > 0;
  const eff = state.colony_load * (0.5 + build.adhesion / 10);
  const wouldLand = open && eff >= T_THRESH;
  els.windowPill.classList.toggle("open", open && !wouldLand);
  els.windowPill.classList.toggle("success", wouldLand);
  els.windowPill.textContent = open
    ? "Window open (" + state.transmission_window + ")"
    : "Window closed";
}

function renderHint() {
  const { icon, text } = hint(state, build);
  // The contract returns a Tabler icon name; expose it as a data attribute so a
  // future icon font can hook in, while the text itself stays the visible nudge.
  els.hint.textContent = text;
  els.hint.setAttribute("data-icon", icon);
}

// ----------------------------------------------------------------------------
// Log
// ----------------------------------------------------------------------------
function appendLog(events, separate) {
  if (separate) {
    els.log.appendChild(
      el("div", {
        class: "log-line turn-sep",
        text: "— turn " + state.turn + " —",
      })
    );
  }
  for (const [tag, text] of events) {
    els.log.appendChild(
      el("div", { class: "log-line" + (tag ? " " + tag : ""), text })
    );
  }
  els.log.scrollTop = els.log.scrollHeight;
}

// ----------------------------------------------------------------------------
// Reaction seam (juice + audio)
// ----------------------------------------------------------------------------
function reactToLog(action, log) {
  const tags = log.map((e) => e[0]);

  // Drive the colony simulation beat: visible immune strike + growth + window.
  const imLine = log.find((e) => e[0] === "im");
  if (imLine) {
    const m = imLine[1].match(/damage[^\d]*([\d.]+)/);
    const dmg = m ? parseFloat(m[1]) : 0;
    if (dmg > 0.4) pulse("damage", dmg);
  }
  const growLine = log.find((e) => e[1].indexOf("replicate") === 0);
  if (growLine) {
    const m = growLine[1].match(/colony \+([\d.]+)/);
    if (m) pulse("grow", parseFloat(m[1]));
  }
  if (action === "provoke") pulse("window");

  // Per-action audio cue.
  if (action === "replicate") play("replicate");
  else if (action === "suppress") play("suppress");
  else if (action === "provoke") play("provoke");

  // Provoking opens the transmission window — a bright cue + accent flash.
  if (action === "provoke") {
    play("window");
    flash(els.windowPill, "accent");
  }

  // Successful transmit.
  if (tags.includes("ok")) {
    flash(els.statColony, "success");
    popNumber(els.windowPill, "transmit!", "success");
    burst(els.windowPill, { color: "var(--success)", count: 20, spread: 64 });
  }

  // Failed transmit — shake the action and play a hit.
  if (tags.includes("no")) {
    const transmitBtn = els.acts.querySelector('[data-k="transmit"]');
    if (transmitBtn) shake(transmitBtn);
    play("hit");
  }

  // Immune damage line carries the colony loss; pop it on the colony bar.
  const immune = log.find((e) => e[0] === "im");
  if (immune) flash(els.statLock, "danger");
}

// ----------------------------------------------------------------------------
// Accessibility summary (sr-only h2)
// ----------------------------------------------------------------------------
function setSummary(text) {
  els.srSummary.textContent = text;
}

function updateSummary() {
  setSummary(
    "Turn " +
      state.turn +
      " of " +
      MAX_TURNS +
      ". Colony load " +
      state.colony_load.toFixed(0) +
      ", host stability " +
      Math.max(0, state.host_stability).toFixed(0) +
      ", immune lock-on " +
      state.immune_lockon.toFixed(0) +
      ". " +
      (state.transmission_window > 0
        ? "Transmission window open for " +
          state.transmission_window +
          " more turns."
        : "Transmission window closed.")
  );
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function clampPct(x) {
  return Math.max(0, Math.min(100, x));
}

function setActionsEnabled(on) {
  for (const btn of els.acts.querySelectorAll("button")) {
    btn.disabled = !on;
  }
  if (on && state) {
    const transmitBtn = els.acts.querySelector('[data-k="transmit"]');
    if (transmitBtn) transmitBtn.disabled = state.transmission_window <= 0;
  }
}

// ----------------------------------------------------------------------------
// Audio toggle (audio.js owns canonical mute; toggles mirror its state)
// ----------------------------------------------------------------------------
function refreshAudioToggles() {
  const muted = isMuted();
  const label = muted ? "Sound off" : "Toggle sound";
  const glyph = muted ? "♪̸" : "♪";
  for (const b of [els.audioToggle, els.audioTogglePlay]) {
    if (!b) continue;
    b.setAttribute("aria-label", label);
    b.setAttribute("aria-pressed", String(muted));
    b.textContent = glyph;
  }
}

function toggleAudio() {
  initAudio(); // ensure the context exists on this user gesture
  setMuted(!isMuted());
  refreshAudioToggles();
}

// ----------------------------------------------------------------------------
// Simulation speed (scales the per-turn beat)
// ----------------------------------------------------------------------------
function refreshSpeedToggle() {
  if (els.speedToggle) {
    els.speedToggle.textContent = speed + "×";
    els.speedToggle.setAttribute("aria-label", "Simulation speed " + speed + " times");
  }
}

function cycleSpeed() {
  speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
  try { localStorage.setItem("strain.speed", String(speed)); } catch { /* ignore */ }
  refreshSpeedToggle();
}

// ----------------------------------------------------------------------------
// Wiring
// ----------------------------------------------------------------------------
function openHelp() {
  openHowTo(els.howtoOverlay);
}

function init() {
  els.newRun.addEventListener("click", renderBuild);
  els.backMenu.addEventListener("click", renderMenu);

  els.acts.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-k]");
    if (!btn || btn.disabled) return;
    onAction(btn.dataset.k);
  });

  if (els.audioToggle) els.audioToggle.addEventListener("click", toggleAudio);
  if (els.audioTogglePlay)
    els.audioTogglePlay.addEventListener("click", toggleAudio);

  // Simulation speed.
  try {
    const saved = parseInt(localStorage.getItem("strain.speed"), 10);
    if (saved === 2 || saved === 4) speed = saved;
  } catch { /* ignore */ }
  if (els.speedToggle) els.speedToggle.addEventListener("click", cycleSpeed);
  refreshSpeedToggle();

  // Onboarding: intro screen + how-to overlay.
  if (els.introContinue)
    els.introContinue.addEventListener("click", () => { markSeen(); renderMenu(); });
  for (const b of [els.introHowto, els.howto, els.howtoPlay]) {
    if (b) b.addEventListener("click", openHelp);
  }
  if (els.howtoOverlay) {
    els.howtoOverlay.addEventListener("click", (e) => {
      if (e.target === els.howtoOverlay || e.target.closest("[data-howto-close]")) {
        closeHowTo(els.howtoOverlay);
      }
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeHowTo(els.howtoOverlay);
  });

  refreshAudioToggles();

  if (isFirstVisit()) {
    setSummary("Strain. A microbial survival game. Read the intro, then begin.");
    show("intro");
  } else {
    renderMenu();
  }
}

init();
