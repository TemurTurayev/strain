// play.mjs — play one full game with an agent and print the decision trace.
//   node agent/play.mjs                         (heuristic agent, random host)
//   node agent/play.mjs --strain=silent --host=feverish
//   node agent/play.mjs --adapter=llm --provider=gemini   (frontier model plays)
import { playGame } from "./runner.mjs";
import { heuristic } from "./adapters/heuristic.mjs";
import { makeCliAdapter } from "./adapters/cli.mjs";
import { PRESETS, HOSTS, HOST_KEYS } from "../web/src/engine.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; })
);

const strain = PRESETS[args.strain] || PRESETS.aggressive;
const host = (args.host && HOSTS[args.host]) || HOSTS[HOST_KEYS[Math.floor(Math.random() * HOST_KEYS.length)]];
const useLlm = args.adapter === "llm";
const adapter = useLlm ? makeCliAdapter({ provider: args.provider || "gemini" }) : heuristic;

console.log(`${strain.name} · ${host.name} host · ${useLlm ? "LLM agent (" + (args.provider || "gemini") + ")" : "heuristic agent"}\n`);
const r = await playGame({ strain, host, adapter });
const pad = (x, n) => String(x).padStart(n);
for (const t of r.transcript) {
  const o = t.obs;
  console.log(
    `t${pad(t.turn, 2)} | fix ${pad(Math.round(o.immune_fixation), 3)} | load ${pad(Math.round(o.colony_load), 4)} | ` +
    `lock ${pad(Math.round(o.immune_lockon), 3)} | host ${pad(Math.round(o.host_stability), 3)} | win ${o.transmission_window} | → ${t.action}` +
    (t.reason ? "  (" + t.reason + ")" : "")
  );
}
console.log(`\n>>> ${r.outcome.toUpperCase()} — ${r.title} (turn ${r.turn})`);
