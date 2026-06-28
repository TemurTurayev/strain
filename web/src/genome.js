// genome.js — build / draft screen for Strain.
//
// Self-contained ES module. Imports ONLY from ./engine.js.
// Responsibilities:
//   - defaultBuild(presetKey)  → an immutable working genome for a preset
//   - validateBuild(build)     → true iff sum === GENOME_BUDGET and each stat 1..10
//   - mountBuildScreen(rootEl, onStart) → render selectable preset cards AND a
//        custom genome allocator (per-stat +/- steppers, live points-remaining,
//        conservation enforced) plus a start button that calls onStart(build).
//
// No DOM ids are invented here that conflict with the §DOM contract: this module
// only writes inside the rootEl it is handed (#build-root) and clears it first.

import { PRESETS, GENOME_BUDGET, ORGANISM_TYPES, ORGANISM_TYPE_KEYS } from "./engine.js?v=3";

// The four allocatable genome stats, in display order.
const STATS = [
  { key: "virulence", label: "Virulence", abbr: "vir" },
  { key: "stealth", label: "Stealth", abbr: "ste" },
  { key: "adhesion", label: "Adhesion", abbr: "adh" },
  { key: "resistance", label: "Resistance", abbr: "res" },
];

const STAT_MIN = 1;
const STAT_MAX = 10;

// ---------------------------------------------------------------------------
// Pure helpers (exported contract)
// ---------------------------------------------------------------------------

/**
 * Build an immutable working genome from a preset key.
 * Falls back to the first preset if the key is unknown.
 * Shape matches what main.js / engine.resolve expect:
 *   { key, name, virulence, stealth, adhesion, resistance }
 */
export function defaultBuild(presetKey) {
  const preset = PRESETS[presetKey] || PRESETS[Object.keys(PRESETS)[0]];
  return {
    key: preset.key,
    name: preset.name,
    virulence: preset.virulence,
    stealth: preset.stealth,
    adhesion: preset.adhesion,
    resistance: preset.resistance,
  };
}

/**
 * A build is valid iff every stat is an integer in [1, 10] and the four stats
 * sum to exactly GENOME_BUDGET (the conservation law).
 */
export function validateBuild(build) {
  if (!build || typeof build !== "object") return false;
  let sum = 0;
  for (const { key } of STATS) {
    const v = build[key];
    if (typeof v !== "number" || !Number.isInteger(v)) return false;
    if (v < STAT_MIN || v > STAT_MAX) return false;
    sum += v;
  }
  return sum === GENOME_BUDGET;
}

// Sum of the four allocatable stats on a build.
function statSum(build) {
  let sum = 0;
  for (const { key } of STATS) sum += build[key] || 0;
  return sum;
}

// ---------------------------------------------------------------------------
// Small DOM builder (no framework, palette-token styled)
// ---------------------------------------------------------------------------

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const k in attrs) {
    const val = attrs[k];
    if (val == null || val === false) continue;
    if (k === "text") node.textContent = val;
    else if (k === "class") node.className = val;
    else node.setAttribute(k, val);
  }
  for (const child of children) {
    if (child == null) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// ---------------------------------------------------------------------------
// mountBuildScreen
// ---------------------------------------------------------------------------

/**
 * Render the build screen into rootEl. Lets the player either pick one of the
 * three proven presets OR allocate a custom genome under the conservation law,
 * then start the run via onStart(build).
 *
 * @param {HTMLElement} rootEl  container to fill (its contents are replaced)
 * @param {(build:object)=>void} onStart  called with a validated working genome
 */
export function mountBuildScreen(rootEl, onStart) {
  if (!rootEl) return;
  clear(rootEl);

  // Working custom genome — starts as a balanced 5/5/5/5 (sum 20 = budget).
  let custom = { virulence: 5, stealth: 5, adhesion: 5, resistance: 5 };
  // Which preset (if any) is currently selected. null while editing custom.
  let selectedPresetKey = null;
  // Organism type — orthogonal to the genome budget. Defaults to the baseline.
  let selectedType = ORGANISM_TYPE_KEYS[0]; // "bacterium"

  // --- Organism-type section (the new axis: bacterium / virus / fungus) ------
  const typeCards = [];
  const typeGrid = el("div", { class: "preset-grid type-grid", id: "type-grid", role: "radiogroup", "aria-label": "Organism type" });
  for (const key of ORGANISM_TYPE_KEYS) {
    const t = ORGANISM_TYPES[key];
    const card = el(
      "button",
      { type: "button", class: "preset type-card", role: "radio", "aria-checked": "false", "aria-label": "Select organism type " + t.name },
      [
        el("div", { class: "preset-name" }, [el("span", { class: "type-glyph", text: t.glyph + " " }), t.name]),
        el("div", { class: "preset-blurb", text: t.blurb }),
      ]
    );
    card.dataset.type = key;
    card.addEventListener("click", () => selectType(key));
    typeCards.push(card);
    typeGrid.appendChild(card);
  }

  // --- Presets section ------------------------------------------------------
  const presetCards = [];
  const presetGrid = el("div", { class: "preset-grid", id: "preset-grid", role: "radiogroup", "aria-label": "Proven strains" });

  for (const key in PRESETS) {
    const p = PRESETS[key];
    const stats = el("div", { class: "preset-stats" }, [
      el("span", { text: "vir " + p.virulence }),
      el("span", { text: "ste " + p.stealth }),
      el("span", { text: "adh " + p.adhesion }),
      el("span", { text: "res " + p.resistance }),
    ]);
    const card = el(
      "button",
      {
        type: "button",
        class: "preset",
        role: "radio",
        "aria-checked": "false",
        "aria-label": "Select " + p.name + " strain",
      },
      [
        el("div", { class: "preset-name", text: p.name }),
        el("div", { class: "preset-blurb", text: p.blurb }),
        stats,
      ]
    );
    card.dataset.key = key;
    card.addEventListener("click", () => selectPreset(key));
    presetCards.push(card);
    presetGrid.appendChild(card);
  }

  // --- Custom allocator section --------------------------------------------
  const remainingValue = el("strong", { id: "genome-remaining", text: "0" });
  const remainingReadout = el("p", { class: "genome-remaining-readout" }, [
    "Points remaining: ",
    remainingValue,
  ]);

  const statRows = {}; // key → { valueEl, dec, inc }

  function makeStatRow(stat) {
    const valueEl = el("span", {
      class: "genome-stat-val",
      id: "genome-val-" + stat.key,
      "aria-live": "polite",
    });
    const dec = el("button", {
      type: "button",
      class: "stepper",
      "aria-label": "Decrease " + stat.label.toLowerCase(),
    }, ["−"]);
    const inc = el("button", {
      type: "button",
      class: "stepper",
      "aria-label": "Increase " + stat.label.toLowerCase(),
    }, ["+"]);

    dec.addEventListener("click", () => step(stat.key, -1));
    inc.addEventListener("click", () => step(stat.key, +1));

    statRows[stat.key] = { valueEl, dec, inc };

    return el("div", { class: "genome-stat-row" }, [
      el("span", { class: "genome-stat-label", text: stat.label }),
      el("div", { class: "genome-stepper-group" }, [dec, valueEl, inc]),
    ]);
  }

  const allocator = el("div", { class: "genome-allocator", "aria-label": "Custom genome" }, [
    el("h2", { class: "genome-heading", text: "Or build a custom genome" }),
    el("p", { class: "genome-help", text: "Spend exactly " + GENOME_BUDGET + " points across four traits. Each trait ranges from 1 to 10." }),
    ...STATS.map(makeStatRow),
    remainingReadout,
  ]);

  // --- Start button ---------------------------------------------------------
  const startBtn = el("button", {
    type: "button",
    class: "btn btn-primary",
    id: "btn-start-run",
  }, ["Start run"]);
  startBtn.addEventListener("click", onStartClick);

  const startRow = el("div", { class: "menu-actions genome-start-row" }, [startBtn]);

  // --- Assemble -------------------------------------------------------------
  rootEl.appendChild(el("h2", { class: "genome-heading", text: "Organism type" }));
  rootEl.appendChild(el("p", { class: "genome-help", text: "What kind of microbe are you? Each plays differently — a virus races but leaves a latent reservoir; a fungus is slow but nearly impossible to clear." }));
  rootEl.appendChild(typeGrid);
  rootEl.appendChild(el("h2", { class: "genome-heading", text: "Proven strains" }));
  rootEl.appendChild(presetGrid);
  rootEl.appendChild(allocator);
  rootEl.appendChild(startRow);

  // --- State transitions ----------------------------------------------------

  // Read the build that will be started: a chosen preset, or the custom genome.
  // The organism type rides along on every build (orthogonal to the genome).
  function currentBuild() {
    if (selectedPresetKey) return { ...defaultBuild(selectedPresetKey), type: selectedType };
    return {
      key: "custom",
      name: "Custom strain",
      type: selectedType,
      virulence: custom.virulence,
      stealth: custom.stealth,
      adhesion: custom.adhesion,
      resistance: custom.resistance,
    };
  }

  function selectPreset(key) {
    selectedPresetKey = key;
    render();
  }

  function selectType(key) {
    if (ORGANISM_TYPES[key]) selectedType = key;
    render();
  }

  // Adjust a custom stat by +1 / −1, enforcing 1..10 and the budget ceiling.
  function step(key, delta) {
    // Touching the allocator deselects any chosen preset.
    selectedPresetKey = null;

    const next = (custom[key] || 0) + delta;
    if (next < STAT_MIN || next > STAT_MAX) return;
    // Conservation: never let the sum exceed the budget on an increase.
    if (delta > 0 && statSum(custom) + delta > GENOME_BUDGET) return;

    custom = { ...custom, [key]: next };
    render();
  }

  function onStartClick() {
    const build = currentBuild();
    if (!validateBuild(build)) return; // guarded; button is disabled when invalid
    onStart(build);
  }

  // Reflect all state into the DOM.
  function render() {
    // Organism-type cards selected state.
    for (const card of typeCards) {
      const isSel = card.dataset.type === selectedType;
      card.classList.toggle("selected", isSel);
      card.setAttribute("aria-checked", isSel ? "true" : "false");
    }

    // Preset cards selected state.
    for (const card of presetCards) {
      const isSel = card.dataset.key === selectedPresetKey;
      card.classList.toggle("selected", isSel);
      card.setAttribute("aria-checked", isSel ? "true" : "false");
    }

    // Allocator values + stepper enable/disable.
    const sum = statSum(custom);
    const remaining = GENOME_BUDGET - sum;
    for (const stat of STATS) {
      const row = statRows[stat.key];
      const v = custom[stat.key];
      row.valueEl.textContent = String(v);
      row.dec.disabled = v <= STAT_MIN;
      row.inc.disabled = v >= STAT_MAX || remaining <= 0;
    }

    // Points-remaining readout, tinted when off-budget.
    remainingValue.textContent = String(remaining);
    remainingReadout.classList.toggle("is-over", remaining < 0);
    remainingReadout.classList.toggle("is-under", remaining > 0);
    remainingReadout.classList.toggle("is-balanced", remaining === 0);

    // Dim the allocator when a preset is the active choice, for clarity.
    allocator.classList.toggle("is-inactive", selectedPresetKey != null);

    // Start button validity.
    const build = currentBuild();
    const ok = validateBuild(build);
    startBtn.disabled = !ok;
    startBtn.setAttribute("aria-disabled", ok ? "false" : "true");
    const typeName = ORGANISM_TYPES[selectedType]?.name || "Bacterium";
    startBtn.textContent = selectedPresetKey
      ? "Start " + typeName + " — " + (PRESETS[selectedPresetKey]?.name || "strain")
      : "Start custom " + typeName;
  }

  render();
}
