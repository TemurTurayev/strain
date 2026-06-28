// record.mjs — Node recorder: runs an ecosystem match (heuristic or LLM controllers)
// and emits a full EcoReplay v1 JSON to stdout for the browser viewer. Wraps the
// existing engine + the shared buildFrame from the viewer's live.js; never edits the
// engine. LLM controllers are async, so this is the async sibling of runLiveGame.
//   node agent/record.mjs --A=heuristic --B=heuristic --immune=heuristic > game.json
//   node agent/record.mjs --A=llm:gemini --B=llm:codex --immune=llm:claude > game.json
import { freshEcosystem, observeEco, resolveEcoTick, colonyIds, MAX_TICKS } from "../web/src/ecosystem.mjs";
import { buildFrame, EXPORT_CONFIG } from "../web/src/viewer/live.js";
import { makeController } from "./ecosystem.mjs";
import { defaultColonyPolicy, defaultImmunePolicy } from "../web/src/ecosystem.mjs";

const PALETTE = ["#e5484d", "#30a46c", "#e2a336", "#8e6cd9"];

export async function recordEcosystem({ genomes, controllers, seed = "rec", source = "mixed" }) {
  let w = freshEcosystem(genomes);
  const ids = colonyIds(w);
  const frames = [];
  for (let i = 0; i < MAX_TICKS + 2 && !w.outcome; i++) {
    const factionList = [...ids.filter((id) => w.colonies[id].alive && !w.colonies[id].transmitted), "immune"];
    const actions = {};
    for (const f of factionList) actions[f] = await Promise.resolve(controllers[f](observeEco(w, f)));
    const next = resolveEcoTick(w, actions);
    frames.push(buildFrame(w, actions, next.log));
    w = next;
  }
  frames.push(buildFrame(w, {}, w.log));

  const colonyMeta = {};
  ids.sort().forEach((id, k) => { colonyMeta[id] = { color: PALETTE[k % PALETTE.length], label: `Strain ${id}` }; });
  return {
    format: "eco-replay", version: 1, seed, source,
    controllers: Object.fromEntries([...ids, "immune"].map((f) => [f, "set"])),
    config: EXPORT_CONFIG, genomes, colonyMeta,
    outcome: w.outcome || { type: "contained", winner: "immune", reason: "time", tick: w.tick },
    frames,
  };
}

// ---- CLI ----
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
  const genomes = [
    { id: "A", stealth: 3, preferredO2: 80, home: "lung" },
    { id: "B", stealth: 7, preferredO2: 20, home: "gut" },
  ];
  const ctlSpec = (spec, faction) => (!spec || spec === "heuristic")
    ? (faction === "immune" ? defaultImmunePolicy : defaultColonyPolicy)
    : makeController(spec, faction);
  const controllers = {
    A: ctlSpec(args.A, "A"), B: ctlSpec(args.B, "B"), immune: ctlSpec(args.immune, "immune"),
  };
  const source = [args.A, args.B, args.immune].some((s) => String(s).startsWith("llm")) ? "llm" : "heuristic";
  const replay = await recordEcosystem({ genomes, controllers, seed: args.seed || "rec", source });
  process.stdout.write(JSON.stringify(replay));
}
