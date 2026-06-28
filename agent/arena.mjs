// arena.mjs — the agent arena. Pit controllers against the same fixed set of
// (strain, host) scenarios and score them by win-rate and how fast they win.
// This is the benchmark surface from the original vision: agents compete, and
// you can see whose decision-making survives best.
//
//   node agent/arena.mjs                       (heuristic only)
//   node agent/arena.mjs --llm=gemini,gpt      (add frontier-model agents — slow)
//   node agent/arena.mjs --llm=gemini --strains=sticky   (limit scenarios for speed)
import { playGame } from "./runner.mjs";
import { heuristic } from "./adapters/heuristic.mjs";
import { makeCliAdapter } from "./adapters/cli.mjs";
import { PRESETS, HOSTS, HOST_KEYS } from "../web/src/engine.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; })
);

const competitors = { heuristic };
if (args.llm) for (const p of String(args.llm).split(",")) competitors["llm:" + p] = makeCliAdapter({ provider: p });

const strainKeys = args.strains ? String(args.strains).split(",") : Object.keys(PRESETS);
const hostKeys = args.hosts ? String(args.hosts).split(",") : HOST_KEYS;
const scenarios = [];
for (const sk of strainKeys) for (const hk of hostKeys) scenarios.push({ strain: PRESETS[sk], host: HOSTS[hk] });

console.log(`arena: ${Object.keys(competitors).length} agent(s) × ${scenarios.length} scenarios\n`);
const board = [];
for (const [name, adapter] of Object.entries(competitors)) {
  let wins = 0, n = 0; const turns = [];
  for (const sc of scenarios) {
    const r = await playGame({ strain: sc.strain, host: sc.host, adapter });
    n++; if (r.outcome === "win") { wins++; turns.push(r.turn); }
  }
  const avg = turns.length ? turns.reduce((a, b) => a + b, 0) / turns.length : Infinity;
  board.push({ name, winrate: Math.round((100 * wins) / n), wins, n, avgWinTurn: turns.length ? avg.toFixed(1) : "—" });
}
// rank: higher win-rate first, then faster wins
board.sort((a, b) => b.winrate - a.winrate || parseFloat(a.avgWinTurn) - parseFloat(b.avgWinTurn));

console.log("rank  agent           winrate   wins   avg-win-turn");
board.forEach((r, i) =>
  console.log(`  ${i + 1}.  ${r.name.padEnd(14)} ${(r.winrate + "%").padEnd(8)} ${(r.wins + "/" + r.n).padEnd(6)} ${r.avgWinTurn}`)
);
