// eco_sim.mjs — headless balance harness for the tissue-graph ecosystem.
// Runs many heuristic games with randomised genomes + a little policy noise,
// reports the outcome distribution. Goal: colonies CAN win, immune CAN win,
// host-death stays rare, and no single archetype dominates.
//   node eco_sim.mjs [games]
import {
  freshEcosystem, observeEco, resolveEcoTick, colonyIds, ZONES,
  defaultColonyPolicy, defaultImmunePolicy, MAX_TICKS,
} from "./web/src/ecosystem.mjs";

const GAMES = Number(process.argv[2] || 300);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// epsilon-greedy wrapper: occasionally deviate to a random legal action for variety
function noisy(policy, legalFor) {
  return (o) => {
    if (Math.random() < 0.12) {
      const legal = legalFor(o);
      return pick(legal);
    }
    return policy(o);
  };
}
const colonyLegal = (o) => {
  const dom = o.me.dominant_zone;
  const adj = (o.zones[dom]?.adjacent) || [];
  return ["feed", "hide", "toxin", "transmit",
    ...adj.map((z) => "move:" + z), ...adj.map((z) => "scout:" + z), ...ZONES.map((z) => "snitch:" + z)];
};
const immuneLegal = (o) => [
  "tolerize",
  ...ZONES.map((z) => "sweep:" + z),
  ...ZONES.map((z) => "contain:" + z),
  ...ZONES.map((z) => "investigate:" + z),
  ...o.contacts.flatMap((c) => ["scan:" + c.id, "strike:" + c.id]),
];

const tally = { colony: 0, immune: 0, host_death: 0 };
const byTick = [];
let transmitTicks = 0, transmitCount = 0;

function playOneFull() {
  const homes = ["gut", "lung", "blood"];
  const genomes = [
    { id: "A", stealth: rnd(2, 8), preferredO2: rnd(10, 90), home: pick(homes) },
    { id: "B", stealth: rnd(2, 8), preferredO2: rnd(10, 90), home: pick(homes) },
  ];
  let w = freshEcosystem(genomes);
  const ids = colonyIds(w);
  const colCtl = noisy(defaultColonyPolicy, colonyLegal);
  const immCtl = noisy(defaultImmunePolicy, immuneLegal);
  for (let i = 0; i < MAX_TICKS + 2 && !w.outcome; i++) {
    const factionList = [...ids.filter((id) => w.colonies[id].alive && !w.colonies[id].transmitted), "immune"];
    const actions = {};
    for (const f of factionList) actions[f] = f === "immune" ? immCtl(observeEco(w, f)) : colCtl(observeEco(w, f));
    w = resolveEcoTick(w, actions);
  }
  const out = w.outcome || { type: "contained", winner: "immune" };
  return { out, tick: w.tick };
}

for (let g = 0; g < GAMES; g++) {
  const { out, tick } = playOneFull();
  if (out.type === "transmit") { tally.colony++; transmitTicks += tick; transmitCount++; }
  else if (out.type === "host_death") tally.host_death++;
  else tally.immune++;
  byTick.push(tick);
}

const pct = (n) => ((100 * n) / GAMES).toFixed(1) + "%";
const avg = (a) => (a.reduce((s, x) => s + x, 0) / a.length).toFixed(1);
console.log(`ECOSYSTEM v2 balance over ${GAMES} games (heuristic + 12% noise):`);
console.log(`  colony transmit (a colony wins): ${tally.colony}  ${pct(tally.colony)}`);
console.log(`  immune wins (cleared/contained): ${tally.immune}  ${pct(tally.immune)}`);
console.log(`  host death (mutual loss):        ${tally.host_death}  ${pct(tally.host_death)}`);
console.log(`  avg game length: ${avg(byTick)} ticks (cap ${MAX_TICKS})`);
if (transmitCount) console.log(`  avg transmit tick: ${(transmitTicks / transmitCount).toFixed(1)}`);
