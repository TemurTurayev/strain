// Headless balance harness for the dynamic-fixation clock. Run: node balance_sim.mjs
import { freshState, resolve, evaluate, T_THRESH, PRESETS } from "./web/src/engine.js";

const eff = (s, b) => s.colony_load * (0.5 + b.adhesion / 10);

function play(strain, bot) {
  let s = freshState();
  for (let guard = 0; guard < 80; guard++) {
    const v = evaluate(s);
    if (v) return { outcome: v[0] === "win" ? "WIN" : v[1], turn: s.turn };
    [s] = resolve(bot(s, strain), s, strain);
  }
  return { outcome: "GUARD", turn: s.turn };
}

const bots = {
  alwaysReplicate: () => "replicate",
  alwaysSuppress: () => "suppress",
  // grow to enough effective load, open a window, transmit; cool down if lock spikes
  balanced: (s, b) => {
    if (s.transmission_window > 0 && eff(s, b) >= T_THRESH) return "transmit";
    if (eff(s, b) >= T_THRESH && s.transmission_window <= 0) return "provoke";
    if (s.immune_lockon > 50) return "suppress";
    return "replicate";
  },
  // greedier: overgrow before opening the window
  greedy: (s, b) => {
    if (s.transmission_window > 0 && eff(s, b) >= T_THRESH) return "transmit";
    if (eff(s, b) >= T_THRESH * 1.3 && s.transmission_window <= 0) return "provoke";
    return "replicate";
  },
  // stealthy: suppress aggressively to stay quiet, then a late break-out
  silentGreedy: (s, b) => {
    if (s.transmission_window > 0 && eff(s, b) >= T_THRESH) return "transmit";
    if (eff(s, b) >= T_THRESH && s.transmission_window <= 0) return "provoke";
    if (s.immune_lockon > 30 || s.fixation > 55) return "suppress";
    return "replicate";
  },
};

let winsByBot = {};
for (const sk of Object.keys(PRESETS)) {
  const b = PRESETS[sk];
  console.log(`== ${b.name} (V${b.virulence} S${b.stealth} A${b.adhesion} R${b.resistance}) ==`);
  for (const [bn, bot] of Object.entries(bots)) {
    const r = play(b, bot);
    winsByBot[bn] = (winsByBot[bn] || 0) + (r.outcome === "WIN" ? 1 : 0);
    console.log(`  ${bn.padEnd(16)} ${String(r.outcome).padEnd(16)} fixation-end t${r.turn}`);
  }
}
console.log("\nwins across the 3 strains, by bot:");
for (const [bn, w] of Object.entries(winsByBot)) console.log(`  ${bn.padEnd(16)} ${w}/3`);
