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

function buildPrompt(obs) {
  const c = obs.action_fixation_cost;
  return [
    "You are an AI agent playing a turn-based survival strategy game. Read the state and choose exactly ONE action.",
    "",
    "GOAL: get a successful `transmit` (break out to a new host) before immune_fixation reaches 100, host_stability reaches 0, or colony_load reaches 0.",
    "",
    "ACTIONS:",
    "- replicate: grow colony_load, but raises inflammation (and fixation).",
    "- suppress: lowers immune_lockon, but no growth this turn.",
    "- provoke: opens the transmission_window (costs host_stability). You must do this before you can transmit.",
    "- transmit: succeeds only if transmission_window>0 AND transmit_score >= transmit_threshold. The window weakens each turn it stays open.",
    "immune_fixation is your clock and the cost of being visible: loud actions (provoke, replicate) raise it faster. At 100 you lose.",
    "",
    `STATE (turn ${obs.turn}):`,
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
  ].join("\n");
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
export async function askModel(provider, prompt, timeoutMs = 90000) {
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
