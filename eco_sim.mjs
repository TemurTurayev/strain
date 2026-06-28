// eco_sim.mjs — headless balance harness for the tissue-graph ecosystem.
// Runs many heuristic games with randomised genomes + a little policy noise,
// reports the outcome distribution. Goal: colonies CAN win, immune CAN win,
// host-death stays rare, and no single archetype dominates.
//   node eco_sim.mjs [games]
import {
  freshEcosystem, observeEco, resolveEcoTick, colonyIds, ZONES,
  defaultColonyPolicy, defaultImmunePolicy, MAX_TICKS,
  QUORUM_TOXIN, LOCK_TO_STRIKE, LOCK_TO_TRANSMIT, QUORUM_TRANSMIT, EXIT_THRESH, EXITS
} from "./web/src/ecosystem.mjs";

let isMatrix = false;
let GAMES = 300;
for (const arg of process.argv.slice(2)) {
  if (arg === "matrix") isMatrix = true;
  else if (!isNaN(Number(arg))) {
    const n = Math.floor(Number(arg));
    if (Number.isFinite(n) && n > 0) GAMES = n;
    else { console.error(`invalid game count "${arg}" — need a finite positive integer`); process.exit(1); }
  }
}
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

function toxinSpammer(o) {
  const dom = o.me.dominant_zone;
  const here = o.zones[dom] || {};
  if (EXITS.includes(dom) && here.mine >= EXIT_THRESH[dom] && o.me.quorum >= QUORUM_TRANSMIT && o.me.detected < LOCK_TO_TRANSMIT) {
    return "transmit";
  }
  if (o.me.quorum >= QUORUM_TOXIN && here.iron > 0) {
    return "toxin";
  }
  return "feed";
}

function sweepSpamImmune(o) {
  const exitZone = EXITS.slice().sort((a, b) => {
    const scoreA = (o.zones[a]?.anomaly || 0) + (o.zones[a]?.nutrient_drain || 0);
    const scoreB = (o.zones[b]?.anomaly || 0) + (o.zones[b]?.nutrient_drain || 0);
    return scoreB - scoreA;
  })[0];
  return "sweep:" + exitZone;
}

function strikeSpamImmune(o) {
  const ready = o.contacts.filter((c) => c.lock >= LOCK_TO_STRIKE).sort((a, b) => b.lock - a.lock)[0];
  if (ready) return "strike:" + ready.id;
  const hottest = o.contacts.sort((a, b) => b.est_load - a.est_load)[0];
  if (hottest) return "scan:" + hottest.id;
  return "sweep";
}

function playOneFull(colPolicy = defaultColonyPolicy, immPolicy = defaultImmunePolicy) {
  const homes = ["gut", "lung"]; // the only zones a colony can seed in (blood/lymph remap to gut)
  const genomes = [
    { id: "A", stealth: rnd(2, 8), preferredO2: rnd(10, 90), home: pick(homes) },
    { id: "B", stealth: rnd(2, 8), preferredO2: rnd(10, 90), home: pick(homes) },
  ];
  let w = freshEcosystem(genomes);
  const ids = colonyIds(w);
  // real seeded home (freshEcosystem remaps blood/lymph -> gut via home_ok), so a
  // genome LABELED 'blood' actually starts in 'gut'. Tally by the true seed zone.
  const seededHome = Object.fromEntries(ids.map((id) => [id, w.colonies[id].home]));
  const colCtl = noisy(colPolicy, colonyLegal);
  const immCtl = noisy(immPolicy, immuneLegal);
  for (let i = 0; i < MAX_TICKS + 2 && !w.outcome; i++) {
    const factionList = [...ids.filter((id) => w.colonies[id].alive && !w.colonies[id].transmitted), "immune"];
    const actions = {};
    for (const f of factionList) actions[f] = f === "immune" ? immCtl(observeEco(w, f)) : colCtl(observeEco(w, f));
    w = resolveEcoTick(w, actions);
  }
  const out = w.outcome || { type: "contained", winner: "immune" };
  return { out, tick: w.tick, genomes, seededHome };
}

if (isMatrix) {
  console.log(`MATRIX MODE: ${GAMES} games per cell (head-to-head archetypes)`);
  // trap policies are deliberate bad strategies — we WANT the field to beat them;
  // they verify a degenerate line doesn't secretly dominate, so exclude them when
  // judging the OPPOSING side's dominance.
  const colPolicies = [
    { name: "default", fn: defaultColonyPolicy },
    { name: "toxinSpammer", fn: toxinSpammer, trap: true },
  ];
  const immPolicies = [
    { name: "default", fn: defaultImmunePolicy },
    { name: "sweepSpam", fn: sweepSpamImmune },
    { name: "strikeSpam", fn: strikeSpamImmune },
  ];
  const grid = {}; // grid[col][imm] = { c, i }
  for (const cp of colPolicies) {
    grid[cp.name] = {};
    for (const ip of immPolicies) {
      let cWins = 0, iWins = 0;
      for (let g = 0; g < GAMES; g++) {
        const { out } = playOneFull(cp.fn, ip.fn);
        if (out.type === "transmit") cWins++;
        else if (out.type !== "host_death") iWins++;
      }
      const c = 100 * cWins / GAMES, i = 100 * iWins / GAMES;
      grid[cp.name][ip.name] = { c, i };
      console.log(`  ${cp.name.padEnd(13)} vs ${ip.name.padEnd(11)}: colony ${c.toFixed(1).padStart(5)}%, immune ${i.toFixed(1).padStart(5)}%`);
    }
  }
  // a strategy DOMINATES if it beats its whole opposing FIELD (min win-rate) >55%.
  // Judge each side only against NON-trap opponents.
  const realImm = immPolicies; // all immune policies are sane probes
  const realCol = colPolicies.filter((p) => !p.trap);
  let dom = false;
  for (const cp of colPolicies.filter((p) => !p.trap)) {
    const minC = Math.min(...realImm.map((ip) => grid[cp.name][ip.name].c));
    if (minC > 55) { dom = true; console.log(`  [DOMINANT COLONY] ${cp.name} beats every immune >55% (min ${minC.toFixed(1)})`); }
  }
  for (const ip of immPolicies) {
    const minI = Math.min(...realCol.map((cp) => grid[cp.name][ip.name].i));
    if (minI > 55) { dom = true; console.log(`  [DOMINANT IMMUNE] ${ip.name} beats every real colony >55% (min ${minI.toFixed(1)})`); }
  }
  for (const cp of colPolicies.filter((p) => p.trap)) {
    const maxC = Math.max(...realImm.map((ip) => grid[cp.name][ip.name].c));
    console.log(`  [trap ${cp.name}] max colony win ${maxC.toFixed(1)}% (should stay low — confirms it's not a hidden winner)`);
  }
  console.log(`  [no-dominant-archetype] ${dom ? "FAIL" : "PASS"}`);
} else {
  const tally = { colony: 0, immune: 0, host_death: 0 };
  const winByHome = { gut: 0, lung: 0, blood: 0 };
  const byTick = [];
  let transmitTicks = 0, transmitCount = 0;

  for (let g = 0; g < GAMES; g++) {
    const { out, tick, seededHome } = playOneFull();
    if (out.type === "transmit") {
      tally.colony++;
      transmitTicks += tick;
      transmitCount++;
      winByHome[seededHome[out.winner]]++;
    }
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
  
  if (transmitCount) {
    console.log(`  avg transmit tick: ${(transmitTicks / transmitCount).toFixed(1)}`);
    const wpct = (home) => ((100 * winByHome[home]) / transmitCount).toFixed(1) + "%";
    console.log(`  win by home: gut ${wpct("gut")}, lung ${wpct("lung")}, blood ${wpct("blood")}`);
    
    // no-dominant-node: with equal gut/lung seeding, neither exit should claim a
    // disproportionate share of colony wins. Balanced => ~50/50, tolerate 40-60%.
    const gutP = (100 * winByHome.gut) / transmitCount;
    const lungP = (100 * winByHome.lung) / transmitCount;
    const nodeOk = gutP >= 40 && gutP <= 60 && lungP >= 40 && lungP <= 60;
    console.assert(nodeOk, `Exit win-share imbalance: gut ${gutP.toFixed(1)} / lung ${lungP.toFixed(1)}`);
    console.log(`  [no-dominant-node] ${nodeOk ? "PASS" : "FAIL"} (gut ${gutP.toFixed(1)}% / lung ${lungP.toFixed(1)}%, want 40-60 each)`);
  }
}
