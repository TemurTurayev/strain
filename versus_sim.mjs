// versus_sim.mjs — balance harness for the asymmetric Colony vs Immune mode.
// Plays every colony bot against every immune bot and reports the outcome
// matrix + aggregate balance + the council's invariants. Run: node versus_sim.mjs
import {
  freshVersus, observeVersus, resolveTick, evaluateVersus,
  defaultImmunePolicy, defaultColonyPolicy, MAX_TICKS,
} from "./web/src/versus.mjs";

// ---- colony bots ----
const colonyBots = {
  Greedy: (o) => {
    if (o.transmission_window >= o.window_threshold && o.colony_load >= o.load_threshold) return "transmit";
    if (o.colony_load >= 55 && o.transmission_window < o.window_threshold) return "provoke";
    return "replicate";
  },
  Stealth: (o) => {
    if (o.transmission_window >= o.window_threshold && o.colony_load >= o.load_threshold) return "transmit";
    if (o.colony_load >= o.load_threshold && o.transmission_window < o.window_threshold && o.immune_lockon < 45) return "provoke";
    if (o.immune_lockon > 38) return "suppress";
    return "replicate";
  },
  Rush: (o) => {
    if (o.transmission_window >= o.window_threshold && o.colony_load >= o.load_threshold) return "transmit";
    if (o.colony_load >= 35 && o.transmission_window < o.window_threshold) return "provoke";
    return "replicate";
  },
  Adaptive: defaultColonyPolicy,
  BlindTransmit: (o) => { // provoke then spam transmit, ignoring whether the window holds
    if (o.transmission_window >= o.window_threshold && o.colony_load >= o.load_threshold) return "transmit";
    if (o.transmission_window < o.window_threshold && o.colony_load >= 30) return "provoke";
    return "replicate";
  },
};

// ---- immune bots ----
const immuneBots = {
  Default: defaultImmunePolicy,
  Aggro: (o) => (o.immune_lockon < 35 ? "scan" : (o.immune_energy >= 4 && o.colony_load > 70 ? "fever" : o.immune_energy >= 3 ? "strike" : "scan")),
  Contain: (o) => (o.transmission_window >= 25 && o.immune_energy >= 2 ? "contain" : o.inflammation > 55 ? "tolerize" : "scan"),
  HostSafe: (o) => (o.inflammation > 50 || o.host_stability < 55 ? "tolerize" : o.transmission_window >= 30 && o.immune_energy >= 2 ? "contain" : "scan"),
  Adaptive: (o) => {
    if (o.host_stability <= 45 || o.inflammation >= 65) return "tolerize";
    if (o.transmission_window >= 28 && o.immune_energy >= 2) return "contain";
    if (o.colony_load >= 60 && o.immune_lockon >= 35 && o.immune_energy >= 3) return "strike";
    return "scan";
  },
};

const build = { virulence: 5, stealth: 5, adhesion: 5, resistance: 5 };
function match(colonyBot, immuneBot) {
  let s = freshVersus(build);
  for (let i = 0; i < MAX_TICKS + 2; i++) {
    if (s.outcome) break;
    const ca = colonyBot(observeVersus(s, "colony"));
    const ia = immuneBot(observeVersus(s, "immune"));
    [s] = resolveTick(s, ca, ia);
  }
  const out = s.outcome || evaluateVersus(s) || { winner: "immune", reason: "timeout" };
  return { winner: out.winner, reason: out.reason, tick: s.tick, hostDeath: s.host_stability <= 0 };
}

let cWins = 0, iWins = 0, draws = 0, hostDeaths = 0, total = 0;
const rows = [];
for (const [cn, cb] of Object.entries(colonyBots)) {
  const row = [cn.padEnd(13)];
  for (const [inm, ib] of Object.entries(immuneBots)) {
    const r = match(cb, ib);
    total++;
    if (r.winner === "colony") cWins++; else if (r.winner === "immune") iWins++; else draws++;
    if (r.hostDeath) hostDeaths++;
    row.push((r.winner === "colony" ? "C" : r.winner === "immune" ? "I" : "D") + "·t" + r.tick);
  }
  rows.push(row);
}

console.log("matrix (rows = colony bot, cols = immune bot; C=colony win, I=immune win, D=draw/host-death)\n");
console.log("colony \\ immune  " + Object.keys(immuneBots).map((x) => x.padEnd(8)).join(""));
for (const row of rows) console.log("  " + row[0] + " " + row.slice(1).map((x) => x.padEnd(8)).join(""));

console.log(`\naggregate over ${total} matchups: colony ${Math.round(100*cWins/total)}% · immune ${Math.round(100*iWins/total)}% · draw ${Math.round(100*draws/total)}%`);
console.log(`host-death matches: ${Math.round(100*hostDeaths/total)}% (want < 12%)`);

console.log("\n--- invariants ---");
const inv = (n, ok) => console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}`);
inv("not a blowout (each side 25-75%)", cWins/total >= 0.25 && cWins/total <= 0.75 && iWins/total >= 0.25 && iWins/total <= 0.75);
inv("host-death < 12%", hostDeaths/total < 0.12);
const blindVsContain = match(colonyBots.BlindTransmit, immuneBots.Contain);
inv("Contain beats BlindTransmit", blindVsContain.winner === "immune");
const adaptiveMirror = match(colonyBots.Adaptive, immuneBots.Adaptive);
inv("Adaptive mirror is decided (not host-death)", adaptiveMirror.winner !== "draw");
console.log(`  (Adaptive colony vs Adaptive immune -> ${adaptiveMirror.winner} on tick ${adaptiveMirror.tick})`);
