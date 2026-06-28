// cli.mjs — LLM controller. Each turn it hands the observation to a frontier
// model (via the user's Consilium CLI, which drives Claude / GPT / Gemini) and
// parses the chosen action. This realises "replace the player with an agent
// that watches the metrics and decides".
//
// Safe by construction: uses execFile with an args array (NO shell), so the
// prompt is passed as a single argv entry and cannot be interpreted as a command.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const CONSILIUM = "/Users/temur/Desktop/Claude/consilium/target/release/consilium";

const TYPE_NOTE = {
  bacterium: "balanced baseline — no special traits.",
  virus: "fast growth, hits the host harder, and the immune system maps you faster. You leave a hidden RESERVOIR: if your colony is cleared to 0 it reactivates, so you cannot be cleanly eradicated.",
  fungus: "slow growth, but a thick wall blunts immune damage (even more when host_stability is low). You leave a hidden RESERVOIR and are very hard to clear.",
};

function buildPrompt(obs) {
  const c = obs.action_fixation_cost;
  const type = obs.organism_type || "bacterium";
  const hasReservoir = type === "virus" || type === "fungus";
  return [
    "You are an AI agent playing a turn-based survival strategy game. Read the state and choose exactly ONE action.",
    "",
    "GOAL: get a successful `transmit` (break out to a new host) before immune_fixation reaches 100, host_stability reaches 0, or colony_load reaches 0.",
    hasReservoir
      ? "Because you have a hidden reservoir, being cleared to 0 is not instant death (you reactivate) — but transmit is still the ONLY win; otherwise you merely persist (latent/chronic)."
      : null,
    "",
    "ACTIONS:",
    "- replicate: grow colony_load, but raises inflammation (and fixation).",
    "- suppress: lowers immune_lockon, but no growth this turn.",
    "- provoke: opens the transmission_window (costs host_stability). You must do this before you can transmit.",
    "- transmit: succeeds only if transmission_window>0 AND transmit_score >= transmit_threshold. The window weakens each turn it stays open.",
    "immune_fixation is your clock and the cost of being visible: loud actions (provoke, replicate) raise it faster. At 100 you lose.",
    "",
    `STATE (turn ${obs.turn}):`,
    `- organism_type: ${type} — ${TYPE_NOTE[type] || TYPE_NOTE.bacterium}`,
    hasReservoir ? `- reservoir: ${obs.reservoir} (hidden; reseeds your colony if it's cleared)` : null,
    `- colony_load: ${obs.colony_load}`,
    `- host_stability: ${obs.host_stability}`,
    `- immune_lockon: ${obs.immune_lockon}/100`,
    `- immune_fixation: ${obs.immune_fixation}/100`,
    `- transmission_window: ${obs.transmission_window > 0 ? "OPEN (" + obs.transmission_window + " turns left)" : "closed"}`,
    `- transmit_score: ${obs.transmit_score} (must be >= ${obs.transmit_threshold} to transmit)`,
    `- can_transmit_now: ${obs.can_transmit}`,
    `- colony_load needed for a freshly opened window: ${obs.load_needed_for_window}`,
    `- genome: virulence ${obs.genome.virulence}, stealth ${obs.genome.stealth}, adhesion ${obs.genome.adhesion}, resistance ${obs.genome.resistance}`,
    `- host: ${obs.host ? obs.host.name + " — " + obs.host.note : "Healthy"}`,
    `- fixation cost this turn: replicate +${c.replicate}, suppress +${c.suppress}, provoke +${c.provoke}, transmit +${c.transmit}`,
    "",
    "Reply with ONLY one word: replicate, suppress, provoke, or transmit.",
  ].filter((line) => line !== null).join("\n");
}

function parseAction(text) {
  const lines = String(text || "").trim().split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].toLowerCase().match(/\b(transmit|provoke|suppress|replicate)\b/);
    if (m) return m[1];
  }
  return null;
}

// generic: hand any prompt to a model via Consilium, return its raw text.
const PROVIDER_RE = /^[a-z0-9._-]{1,32}$/i; // defensive: keep provider a simple token

export async function askModel(provider, prompt, timeoutMs = 90000) {
  if (!PROVIDER_RE.test(String(provider))) throw new Error(`invalid provider: ${provider}`);
  const { stdout } = await runFile(CONSILIUM, ["run", "--provider", provider, prompt], {
    timeout: timeoutMs,
    maxBuffer: 1 << 20,
  });
  return stdout;
}

export { parseAction };

export function makeCliAdapter({ provider = "gemini", timeoutMs = 90000 } = {}) {
  return async function cliAdapter(obs) {
    const { stdout } = await runFile(CONSILIUM, ["run", "--provider", provider, buildPrompt(obs)], {
      timeout: timeoutMs,
      maxBuffer: 1 << 20,
    });
    return parseAction(stdout) || "replicate";
  };
}
