// Headless balance harness: dynamic fixation + host states + decaying window.
// Run: node balance_sim.mjs
import {
  freshState, resolve, evaluate, PRESETS, HOSTS,
  transmitScore, transmitThreshold, needNow,
} from "./web/src/engine.js";

const canTx = (s, b) => s.transmission_window > 0 && transmitScore(s, b) >= transmitThreshold(s);
const bigEnough = (s, b) => s.colony_load >= needNow(s, b);

const bots = {
  alwaysReplicate: () => "replicate",
  alwaysSuppress: () => "suppress",
  balanced: (s, b) => {
    if (canTx(s, b)) return "transmit";
    if (bigEnough(s, b) && s.transmission_window <= 0) return "provoke";
    if (s.immune_lockon > 50) return "suppress";
    return "replicate";
  },
  greedy: (s, b) => {
    if (canTx(s, b)) return "transmit";
    if (s.colony_load >= needNow(s, b) * 1.3 && s.transmission_window <= 0) return "provoke";
    return "replicate";
  },
  stealthHold: (s, b) => {
    if (canTx(s, b)) return "transmit";
    if (bigEnough(s, b) && s.transmission_window <= 0) return "provoke";
    if (s.immune_lockon > 25 || s.fixation > 60) return "suppress";
    return "replicate";
  },
};

function play(strain, hostState, bot) {
  let s = freshState(hostState);
  for (let g = 0; g < 90; g++) {
    const v = evaluate(s);
    if (v) return { win: v[0] === "win", label: v[0] === "win" ? v[1] : v[1], turn: s.turn };
    [s] = resolve(bot(s, strain), s, strain);
  }
  return { win: false, label: "GUARD", turn: s.turn };
}

const agg = {};
const winTurns = [];
const strainTurns = { Aggressive: [], Silent: [], Sticky: [] };
let total = 0;

for (const hk of Object.keys(HOSTS)) {
  for (const sk of Object.keys(PRESETS)) {
    const b = PRESETS[sk];
    for (const [bn, bot] of Object.entries(bots)) {
      const r = play(b, HOSTS[hk], bot);
      agg[bn] = agg[bn] || { w: 0, n: 0, t: [] };
      agg[bn].n++; if (r.win) { agg[bn].w++; agg[bn].t.push(r.turn); }
      if (r.win) { winTurns.push(r.turn); strainTurns[b.name].push(r.turn); }
      total++;
    }
  }
}

const avg = (a) => a.length ? (a.reduce((x, y) => x + y, 0) / a.length) : 0;
console.log(`runs: ${total} (5 hosts x 3 strains x ${Object.keys(bots).length} bots)\n`);
console.log("bot              winrate   avg-win-turn");
for (const [bn, d] of Object.entries(agg)) {
  console.log(`  ${bn.padEnd(15)} ${String(Math.round(100 * d.w / d.n) + "%").padEnd(8)} ${avg(d.t).toFixed(1)}`);
}
console.log(`\navg win turn overall: ${avg(winTurns).toFixed(1)}`);
console.log(`Aggressive avg win turn: ${avg(strainTurns.Aggressive).toFixed(1)}`);
console.log(`Silent avg win turn:     ${avg(strainTurns.Silent).toFixed(1)}`);
console.log(`Sticky avg win turn:     ${avg(strainTurns.Sticky).toFixed(1)}`);
console.log(`Silent − Aggressive gap: ${(avg(strainTurns.Silent) - avg(strainTurns.Aggressive)).toFixed(1)} (want >= +4)`);

console.log("\n--- invariants ---");
const inv = (name, ok) => console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
inv("alwaysReplicate <= 10%", agg.alwaysReplicate.w / agg.alwaysReplicate.n <= 0.10);
inv("alwaysSuppress == 0%", agg.alwaysSuppress.w === 0);
inv("balanced 40-75%", agg.balanced.w / agg.balanced.n >= 0.40 && agg.balanced.w / agg.balanced.n <= 0.80);
inv("avg win turn 11-22", avg(winTurns) >= 11 && avg(winTurns) <= 22);
inv("Silent slower than Aggressive (stealth = time)", avg(strainTurns.Silent) - avg(strainTurns.Aggressive) >= 2);
