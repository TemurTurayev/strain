// eco_arena.mjs — ECOSYSTEM TOURNAMENT + leaderboard. Runs a set of players (heuristic
// archetypes OR LLMs) through every role assignment (which two are colonies, which is
// the immune system), tallies win-rates per role, and ranks them by ELO. This is the
// "arena for AI agents" payoff: who plays the hidden-information game best, and in which
// seat. Heuristic players are instant; LLM players are slow (one Consilium call/faction/tick).
//   node agent/eco_arena.mjs                          # heuristic archetype tournament (instant)
//   node agent/eco_arena.mjs --games=3                # more games per role assignment
//   node agent/eco_arena.mjs --llm=gemini,codex,claude --games=1   # model tournament (slow)
import { playEcosystem, makeController } from "./ecosystem.mjs";
import { defaultColonyPolicy, defaultImmunePolicy } from "../web/src/ecosystem.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
const GAMES = Math.max(1, Math.floor(Number(args.games) || 4));

// ---- heuristic archetype players (instant) --------------------------------
function toxinRush(o) {
  const dom = o.me.dominant_zone, here = o.zones[dom] || {};
  if (here.is_exit && here.mine >= (o.exits?.[dom] || 70) && o.me.quorum >= o.quorum_to_transmit) return "transmit";
  if (o.me.quorum >= o.quorum_to_toxin && here.iron > 0) return "toxin";
  return "feed";
}
function vigilantImmune(o) {
  const noisy = Object.entries(o.zones).filter(([, z]) => z.is_exit).sort((a, b) => (b[1].anomaly + b[1].nutrient_drain) - (a[1].anomaly + a[1].nutrient_drain))[0];
  const ready = o.contacts.filter((c) => c.lock >= o.lock_to_strike).sort((a, b) => b.est_load - a.est_load)[0];
  if (ready && o.energy >= 3) return "strike:" + ready.id;
  return "sweep:" + (noisy ? noisy[0] : "gut");
}

// ---- build the player roster ----------------------------------------------
function roster() {
  if (args.llm) {
    const provs = String(args.llm).split(",").map((s) => s.trim()).filter(Boolean);
    return provs.map((p) => ({ name: p, kind: "llm", spec: "llm:" + p }));
  }
  return [
    { name: "balanced", kind: "fn", colony: defaultColonyPolicy, immune: defaultImmunePolicy },
    { name: "toxin-rush", kind: "fn", colony: toxinRush, immune: vigilantImmune },
    { name: "vigilant", kind: "fn", colony: defaultColonyPolicy, immune: vigilantImmune },
  ];
}

function controllerFor(player, role) {
  if (player.kind === "llm") return makeController(player.spec, role === "immune" ? "immune" : role);
  return role === "immune" ? player.immune : player.colony;
}

async function main() {
  const players = roster();
  const stat = Object.fromEntries(players.map((p) => [p.name, { colW: 0, colN: 0, immW: 0, immN: 0 }]));
  console.log(`ECO ARENA — ${players.length} players, ${GAMES} game(s) per role assignment${args.llm ? " (LLM — slow)" : " (heuristic)"}\n`);

  // every assignment: ordered (colonyA, colonyB) distinct + a distinct immune
  const assignments = [];
  for (const ai of players) for (const bi of players) for (const im of players) {
    if (ai.name === bi.name) continue;            // two distinct colonies
    if (im.name === ai.name || im.name === bi.name) continue; // immune distinct from both
    if (ai.name > bi.name) continue;              // unordered colony pair (A,B)==(B,A)
    assignments.push([ai, bi, im]);
  }

  for (const [A, B, IM] of assignments) {
    for (let g = 0; g < GAMES; g++) {
      const rnd = (a, b) => a + Math.random() * (b - a);
      const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
      const genomes = [
        { id: "A", stealth: rnd(2, 8), preferredO2: rnd(10, 90), home: pick(["gut", "lung"]) },
        { id: "B", stealth: rnd(2, 8), preferredO2: rnd(10, 90), home: pick(["gut", "lung"]) },
      ];
      const controllers = { A: controllerFor(A, "A"), B: controllerFor(B, "B"), immune: controllerFor(IM, "immune") };
      const r = await playEcosystem({ genomes, controllers });
      const colonyWinner = r.winner === "A" ? A : r.winner === "B" ? B : null;
      // each colony is scored vs the immune it faced; the immune scores a win only when
      // it stops BOTH (no colony transmitted).
      for (const C of [A, B]) {
        stat[C.name].colN++;
        if (colonyWinner && colonyWinner.name === C.name) stat[C.name].colW++;
      }
      stat[IM.name].immN++;
      if (!colonyWinner) stat[IM.name].immW++;
      if (args.llm) console.log(`  ${A.name}/${B.name} vs ${IM.name} -> ${r.winner} (${r.reason}, t${r.tick})`);
    }
  }

  // rank by OVERALL skill = average of as-colony and as-immune win-rates (each player
  // is tested in both seats, so this rewards all-round mastery of the hidden-info game).
  const board = players.map((p) => {
    const colWR = stat[p.name].colN ? (100 * stat[p.name].colW / stat[p.name].colN) : 0;
    const immWR = stat[p.name].immN ? (100 * stat[p.name].immW / stat[p.name].immN) : 0;
    return { name: p.name, colWR, immWR, overall: (colWR + immWR) / 2 };
  }).sort((a, b) => b.overall - a.overall);

  console.log("\n  rank  player          overall  as-colony  as-immune");
  console.log("  ────  ──────────────  ───────  ─────────  ─────────");
  board.forEach((b, i) => console.log(
    `  ${String(i + 1).padEnd(4)}  ${b.name.padEnd(14)}  ${(b.overall.toFixed(0) + "%").padStart(6)}   ${(b.colWR.toFixed(0) + "%").padStart(8)}   ${(b.immWR.toFixed(0) + "%").padStart(8)}`
  ));
}

main();
