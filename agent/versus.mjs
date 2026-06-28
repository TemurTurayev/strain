// versus.mjs (agent) — asymmetric agent-vs-agent. One agent plays the colony,
// another plays the immune system, both through the SAME observe/act protocol.
//   node agent/versus.mjs                                 (heuristic vs heuristic)
//   node agent/versus.mjs --colony=llm:gemini             (Gemini colony vs default immune)
//   node agent/versus.mjs --colony=llm:gemini --immune=llm:codex   (model vs model)
import {
  freshVersus, observeVersus, resolveTick, evaluateVersus,
  defaultColonyPolicy, defaultImmunePolicy, MAX_TICKS,
} from "../web/src/versus.mjs";
import { askModel } from "./adapters/cli.mjs";

function parseSideAction(text, legal) {
  const lines = String(text || "").trim().split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].toLowerCase().match(new RegExp("\\b(" + legal.join("|") + ")\\b"));
    if (m) return m[1];
  }
  return null;
}

function colonyPrompt(o) {
  return [
    "You are the COLONY in a two-sided survival game. Goal: get a successful `transmit` (break out to a new host).",
    "transmit succeeds only if transmission_window >= " + o.window_threshold + " AND colony_load >= " + o.load_threshold + ".",
    "Actions: replicate (grow, a little loud) · suppress (lower immune lock-on, no growth) · provoke (open the window, +inflammation, advances the immune clock) · transmit (break out if the window holds).",
    "The immune player will try to CONTAIN your window and STRIKE you. Don't provoke blindly — the window decays and immune_fixation (their clock) rising to 100 clears you.",
    "",
    `STATE t${o.tick}: colony_load ${o.colony_load}, host_stability ${o.host_stability}, immune_lockon ${o.immune_lockon}, immune_fixation ${o.immune_fixation}/100, inflammation ${o.inflammation}, transmission_window ${o.transmission_window} (need ${o.window_threshold}), immune last did ${o.last_immune_action || "—"}.`,
    "Reply with ONLY one word: replicate, suppress, provoke, or transmit.",
  ].join("\n");
}

function immunePrompt(o) {
  return [
    "You are the IMMUNE SYSTEM in a two-sided game. Goal: stop the colony from transmitting (clear it, or hold it until immune_fixation reaches 100). WARNING: if host_stability hits 0 it is a MUTUAL LOSS — do NOT kill the host.",
    "Actions: scan (raise lock-on + your fixation clock, gain energy) · contain (cut the colony's transmission_window, costs energy) · strike (damage the colony if lock-on>=30, else it hurts the host) · fever (big colony+window hit but heavy host damage — panic button) · tolerize (heal host, lower inflammation, regain energy).",
    "immune_energy gates contain/strike/fever. High inflammation or low host_stability cuts your energy regen, so don't over-aggress.",
    "",
    `STATE t${o.tick}: colony_load ${o.colony_load}, host_stability ${o.host_stability}, immune_lockon ${o.immune_lockon}, immune_fixation ${o.immune_fixation}/100, inflammation ${o.inflammation}, transmission_window ${o.transmission_window}, immune_energy ${o.immune_energy}, colony last did ${o.last_colony_action || "—"}.`,
    "Reply with ONLY one word: scan, contain, strike, fever, or tolerize.",
  ].join("\n");
}

function makeController(spec, side) {
  if (!spec || spec === "heuristic") return side === "immune" ? defaultImmunePolicy : defaultColonyPolicy;
  const provider = spec.replace(/^llm:/, "");
  const prompt = side === "immune" ? immunePrompt : colonyPrompt;
  const legal = side === "immune"
    ? ["scan", "contain", "strike", "fever", "tolerize"]
    : ["replicate", "suppress", "provoke", "transmit"];
  return async (o) => {
    try { return parseSideAction(await askModel(provider, prompt(o)), legal) || legal[0]; }
    catch { return legal[0]; }
  };
}

export async function playVersus({ build, colony, immune }) {
  let s = freshVersus(build);
  const transcript = [];
  for (let i = 0; i < MAX_TICKS + 2; i++) {
    if (s.outcome) break;
    const co = observeVersus(s, "colony"), io = observeVersus(s, "immune");
    const [ca, ia] = await Promise.all([Promise.resolve(colony(co)), Promise.resolve(immune(io))]);
    transcript.push({ tick: s.tick, ca, ia, fix: io.immune_fixation, load: io.colony_load, host: io.host_stability, win: io.transmission_window });
    [s] = resolveTick(s, ca, ia);
  }
  const out = s.outcome || evaluateVersus(s) || { winner: "immune", reason: "timeout" };
  return { ...out, tick: s.tick, transcript };
}

// ---- CLI ----
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
  const build = { virulence: 5, stealth: 5, adhesion: 5, resistance: 5 };
  const colony = makeController(args.colony, "colony");
  const immune = makeController(args.immune, "immune");
  console.log(`COLONY (${args.colony || "heuristic"}) vs IMMUNE (${args.immune || "heuristic"})\n`);
  const r = await playVersus({ build, colony, immune });
  const pad = (x, n) => String(x).padStart(n);
  for (const t of r.transcript) {
    console.log(`t${pad(t.tick, 2)} | load ${pad(Math.round(t.load), 4)} | host ${pad(Math.round(t.host), 3)} | fix ${pad(Math.round(t.fix), 3)} | win ${pad(Math.round(t.win), 3)} | colony:${t.ca.padEnd(9)} immune:${t.ia}`);
  }
  console.log(`\n>>> WINNER: ${r.winner.toUpperCase()} — ${r.reason} (tick ${r.tick})`);
}
