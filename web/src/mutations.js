// mutations.js — in-run breakthrough mutation offers + modal.
//
// Self-contained ES module. Imports ONLY from ./engine.js.
//
// Contract (§Module contracts):
//   offerMutations(state) → array of 2 distinct MUTATIONS entries when
//     mutationOfferTurn(state.turn), else [].
//   mountMutationModal(rootEl, choices, onPick) → render a normal-flow faux
//     overlay (NEVER position:fixed) into rootEl presenting each choice with
//     name + desc plus a "skip" option; calls onPick(mutation) for a pick or
//     onPick(null) for skip, then clears the host.
//
// The choices vary by state.turn so successive offers are not identical.

import { MUTATIONS, mutationOfferTurn } from "./engine.js";

// ---------------------------------------------------------------------------
// Offer selection
// ---------------------------------------------------------------------------

// Deterministic-but-varied index pick. We rotate a base offset by the turn so
// the pair shown at turn 5 differs from turn 10, turn 15, etc., while still
// drawing two *distinct* entries from MUTATIONS. A small random jitter keeps it
// from being fully predictable across runs without ever colliding the two.
function pickTwoIndices(turn, count) {
  // Rotating base offset keyed on the turn → varies the pair turn-to-turn.
  const base = (Math.floor(turn / 5) * 2 + Math.floor(Math.random() * count)) % count;
  // Co-prime-ish stride (relative to count) so the second pick is always
  // distinct from the first regardless of count, and also drifts by turn.
  let stride = 1 + ((turn / 5 + Math.floor(Math.random() * (count - 1))) % (count - 1));
  stride = ((stride - 1) % (count - 1)) + 1; // keep in [1, count-1]
  const first = base;
  const second = (base + stride) % count;
  return [first, second];
}

/**
 * offerMutations(state) → two distinct MUTATIONS entries on an offer turn, else [].
 * @param {{turn:number}} state
 * @returns {Array<object>}
 */
export function offerMutations(state) {
  if (!state || !mutationOfferTurn(state.turn)) return [];
  const count = MUTATIONS.length;
  if (count < 2) return count === 1 ? [MUTATIONS[0]] : [];

  const [i, j] = pickTwoIndices(state.turn, count);
  const a = MUTATIONS[i];
  const b = MUTATIONS[j];
  // pickTwoIndices guarantees i !== j; this is a defensive fallback only.
  if (a === b) {
    const k = (i + 1) % count;
    return [a, MUTATIONS[k]];
  }
  return [a, b];
}

// ---------------------------------------------------------------------------
// Modal (normal-flow faux overlay — never position:fixed)
// ---------------------------------------------------------------------------

function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function makeChoiceButton(mutation) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mut-choice";
  btn.setAttribute("data-mut", mutation.id);

  const name = document.createElement("div");
  name.className = "mut-name";
  name.textContent = mutation.name;

  const desc = document.createElement("div");
  desc.className = "mut-desc";
  desc.textContent = mutation.desc;

  btn.appendChild(name);
  btn.appendChild(desc);
  return btn;
}

/**
 * mountMutationModal(rootEl, choices, onPick)
 * Renders a faux-overlay modal in normal document flow (never position:fixed).
 * Calls onPick(mutation) when a choice is taken, or onPick(null) on skip.
 * The host is cleared after a selection so the play flow can resume.
 *
 * @param {HTMLElement} rootEl   host element (the #mut-modal container)
 * @param {Array<object>} choices  mutations from offerMutations(state)
 * @param {(m:object|null)=>void} onPick
 */
export function mountMutationModal(rootEl, choices, onPick) {
  if (!rootEl) return;
  clearNode(rootEl);

  // Nothing to offer → ensure host is empty and report a skip-equivalent.
  if (!Array.isArray(choices) || choices.length === 0) {
    if (typeof onPick === "function") onPick(null);
    return;
  }

  let resolved = false;
  const finish = (mutation) => {
    if (resolved) return;
    resolved = true;
    clearNode(rootEl); // dismiss the faux overlay
    if (typeof onPick === "function") onPick(mutation || null);
  };

  // Backdrop is an in-flow block (margin-based spacing from CSS), NOT fixed.
  const backdrop = document.createElement("div");
  backdrop.className = "mut-backdrop";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "false");
  backdrop.setAttribute("aria-label", "Breakthrough mutation");

  const heading = document.createElement("h2");
  heading.className = "sr-only";
  heading.textContent = "Choose a breakthrough mutation";

  const title = document.createElement("div");
  title.className = "mut-title";
  title.textContent = "Breakthrough mutation";

  const sub = document.createElement("p");
  sub.className = "mut-desc";
  sub.textContent = "Adapt the strain, or skip and keep your current genome.";

  const list = document.createElement("div");
  list.className = "mut-choices";

  for (const mutation of choices) {
    const btn = makeChoiceButton(mutation);
    btn.addEventListener("click", () => finish(mutation));
    list.appendChild(btn);
  }

  const skip = document.createElement("button");
  skip.type = "button";
  skip.className = "mut-choice mut-skip";
  skip.setAttribute("data-mut", "skip");
  const skipName = document.createElement("div");
  skipName.className = "mut-name";
  skipName.textContent = "Skip";
  const skipDesc = document.createElement("div");
  skipDesc.className = "mut-desc";
  skipDesc.textContent = "Keep your genome unchanged this turn.";
  skip.appendChild(skipName);
  skip.appendChild(skipDesc);
  skip.addEventListener("click", () => finish(null));

  backdrop.appendChild(heading);
  backdrop.appendChild(title);
  backdrop.appendChild(sub);
  backdrop.appendChild(list);
  list.appendChild(skip);

  rootEl.appendChild(backdrop);
}
