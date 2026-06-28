// ecosystem.mjs (agent) — multi-agent, hidden-information match across the tissue
// graph. Each faction (colony A, colony B, the immune system) is driven by its own
// controller that sees ONLY its partial observation. Heuristic or LLM per side.
//   node agent/ecosystem.mjs
//   node agent/ecosystem.mjs --A=llm:gemini --B=llm:codex --immune=llm:claude
import {
  freshEcosystem, observeEco, resolveEcoTick, evaluateEco, colonyIds,
  defaultColonyPolicy, defaultImmunePolicy, totalLoad, dominantZone,
  ZONES, EXITS, MAX_TICKS,
} from "../web/src/ecosystem.mjs";
import { askModel } from "./adapters/cli.mjs";

// ---- parsing ---------------------------------------------------------------
const COLONY_ACTS = ["feed", "move", "hide", "toxin", "scout", "snitch", "transmit"];
const IMMUNE_ACTS = ["sweep", "scan", "strike", "contain", "investigate", "tolerize"];

function parseEco(text, faction, contactIds) {
  const t = String(text || "").toLowerCase();
  const lines = t.trim().split(/\r?\n/).filter(Boolean);
  const legal = faction === "immune" ? IMMUNE_ACTS : COLONY_ACTS;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const m = line.match(new RegExp("\\b(" + legal.join("|") + ")\\b(?:\\s*[:=]?\\s*([a-z0-9]+))?"));
    if (!m) continue;
    const act = m[1];
    let arg = m[2] || "";
    if (faction === "colony" && (act === "move" || act === "scout" || act === "snitch")) {
      const z = arg && ZONES.includes(arg) ? arg : ZONES.find((zz) => line.includes(zz));
      return z ? act + ":" + z : (act === "move" ? "feed" : act + ":" + (ZONES.find((zz) => line.includes(zz)) || "blood"));
    }
    if (faction === "immune" && (act === "sweep" || act === "contain" || act === "investigate")) {
      const z = arg && ZONES.includes(arg) ? arg : ZONES.find((zz) => line.includes(zz));
      return z ? act + ":" + z : act + ":" + (ZONES.find((zz) => line.includes(zz)) || "blood");
    }
    if (faction === "immune" && (act === "scan" || act === "strike")) {
      const id = (arg && contactIds.find((c) => c.toLowerCase() === arg)) || contactIds.find((c) => line.includes(c.toLowerCase()));
      return id ? act + ":" + id : act;
    }
    return act;
  }
  return faction === "immune" ? "sweep" : "feed";
}

// ---- prompts ---------------------------------------------------------------
function colonyPrompt(o) {
  const zlines = Object.entries(o.zones).map(([z, zw]) => {
    const tags = [zw.is_exit ? `EXIT(need ${zw.exit_threshold})` : null, zw.contained ? "QUARANTINED" : null].filter(Boolean).join(" ");
    return `  ${z}: you ${zw.mine}, glucose ${zw.glucose}, iron ${zw.iron}, oxygen ${zw.oxygen}, immune ${zw.immune_pressure}x, inflam ${zw.inflammation}${zw.signature !== undefined ? `, your-signal ${zw.signature}` : ""} ${tags}`.trimEnd();
  }).join("\n");
  return [
    `You are microbe COLONY ${o.id} inside a host. You CANNOT see rival colonies, but they drain the same nutrients (competition now: ${o.competition}).`,
    `GOAL: pile biomass to an EXIT zone (gut needs ${o.exits.gut}, lung needs ${o.exits.lung}) and transmit once presence there >= its threshold AND quorum >= ${o.quorum_to_transmit} AND you're not too recognised.`,
    `YOU: total_load ${o.me.total_load}, quorum ${o.me.quorum}/${o.quorum_to_transmit}, recognised(lock) ${o.me.detected}/100, dominant zone ${o.me.dominant_zone}, prefers O2 ${o.me.preferred_oxygen}. Host integrity ${o.host.integrity}, toxin ${o.host.toxin}.`,
    "ZONES you can sense (mass grows where glucose is high and oxygen suits you; blood is rich+iron but a kill-zone; lymph is a memory trap):",
    zlines,
    `Signaling Molecules (SM) ${o.me.sm} — fund espionage.${o.scout_intel ? ` SCOUT INTEL: zone ${o.scout_intel.zone} has rival_presence ~${o.scout_intel.rival_presence}.` : ""}`,
    "Actions: feed (grow in your dominant zone, but loud) · move:<zone> (migrate ~40% of your mass to an ADJACENT zone) · hide (drop signature, no growth) · toxin (poison the zone + rivals, costs iron & 10 of your own mass, very loud) · scout:<zone> (spend SM to recon a neighbour's rival presence) · snitch:<zone> (spend SM to frame a rival there — the immune gets a tip and the rival's signature spikes) · transmit (escape).",
    "WARNING: a bulge sitting at an exit leaks detection BEFORE you escape — and the bigger you get the faster you're recognised; don't camp the threshold forever.",
    "Reply with ONE action, e.g. 'feed', 'move:blood', 'scout:lung', 'snitch:gut', or 'transmit'.",
  ].join("\n");
}

function immunePrompt(o) {
  const zlines = Object.entries(o.zones).map(([z, zw]) =>
    `  ${z}: anomaly ${zw.anomaly}, inflam ${zw.inflammation}, drain ${zw.nutrient_drain}, immune ${zw.immune_presence}x${zw.is_exit ? " EXIT" : ""}${zw.contained ? " QUARANTINED" : ""}`
  ).join("\n");
  const cs = o.contacts.length
    ? o.contacts.map((c) => `${c.id}(lock ${c.lock}, ~load ${c.est_load}, in [${c.zones.join(",")}], memory ${c.memory})`).join("; ")
    : "none localised yet";
  return [
    "You are the HOST IMMUNE SYSTEM. Hidden microbe colonies grow and try to escape. You only act on what you've localised; everything else shows up as per-zone ANOMALIES.",
    "GOAL: clear or pin every colony before any transmits. If host integrity hits 0 it's a MUTUAL LOSS — don't over-aggress.",
    `HOST integrity ${o.host.integrity}, toxin ${o.host.toxin}. Your energy ${o.energy} (scan 1, contain 2, strike 3, investigate 4; sweep/tolerize regen it — you CAN'T act without the energy). Hidden-threat (undetected mass): ${o.hidden_threat}.`,
    "ZONE readings:",
    zlines,
    `Localised contacts: ${cs}.`,
    `Tips (a colony snitched on a rival): ${o.tips && o.tips.length ? o.tips.map((t) => t.zone + "(age " + t.age + ")").join(", ") : "none"}.`,
    `Actions: sweep:<zone> (build recognition on whatever is there; 1.35x at exits — your main detector) · scan:<ID> (focus a contact) · strike:<ID> (needs lock>=${o.lock_to_strike}; hits hardest where immune is strong) · contain:<zone> (quarantine, arms next tick) · investigate:<zone> (act on a TIP — a true tip localises a hidden colony, +30 lock; no tip = wasted) · tolerize (heal host, cool inflammation).`,
    "TIP: a colony that grows large is recognised faster (lock rises with its mass), so watch the noisiest exits. Reply with ONE action, e.g. 'sweep:lung', 'strike:A', 'investigate:gut'.",
  ].join("\n");
}

export function makeController(spec, faction) {
  if (!spec || spec === "heuristic") return faction === "immune" ? defaultImmunePolicy : defaultColonyPolicy;
  const provider = spec.replace(/^llm:/, "");
  return async (o) => {
    const prompt = faction === "immune" ? immunePrompt(o) : colonyPrompt(o);
    const contactIds = faction === "immune" ? o.contacts.map((c) => c.id) : [];
    try { return parseEco(await askModel(provider, prompt), faction === "immune" ? "immune" : "colony", contactIds); }
    catch { return faction === "immune" ? "sweep:blood" : "feed"; }
  };
}

export async function playEcosystem({ genomes, controllers }) {
  let w = freshEcosystem(genomes);
  const ids = colonyIds(w);
  const transcript = [];
  for (let i = 0; i < MAX_TICKS + 2; i++) {
    if (w.outcome) break;
    const factionList = [...ids.filter((id) => w.colonies[id].alive && !w.colonies[id].transmitted), "immune"];
    const acts = await Promise.all(
      factionList.map((f) => Promise.resolve(controllers[f](observeEco(w, f))))
    );
    const actions = {};
    factionList.forEach((f, k) => { actions[f] = acts[k]; });
    transcript.push({
      tick: w.tick,
      host: { ...w.host },
      colonies: Object.fromEntries(ids.map((id) => {
        const c = w.colonies[id];
        return [id, {
          load: totalLoad(c), lock: c.lock, memory: c.memory, zone: dominantZone(c),
          act: actions[id] || (c.transmitted ? "—done—" : "—dead—"),
        }];
      })),
      immune: actions.immune,
    });
    w = resolveEcoTick(w, actions);
  }
  const out = w.outcome || evaluateEco(w) || { type: "contained", winner: "immune", reason: "timeout" };
  return { ...out, tick: w.tick, transcript };
}

// ---- CLI ----
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
  const genomes = [
    { id: "A", stealth: 3, preferredO2: 80, home: "lung" }, // loud aerobe, lung route
    { id: "B", stealth: 7, preferredO2: 20, home: "gut" },  // stealthy anaerobe, gut route
  ];
  const controllers = {
    A: makeController(args.A, "A"),
    B: makeController(args.B, "B"),
    immune: makeController(args.immune, "immune"),
  };
  console.log(`ECOSYSTEM — A(${args.A || "heuristic"}, lung/loud) vs B(${args.B || "heuristic"}, gut/stealth) vs IMMUNE(${args.immune || "heuristic"})\n`);
  const r = await playEcosystem({ genomes, controllers });
  const pad = (x, n) => String(x).padStart(n);
  for (const t of r.transcript) {
    const col = (c) => `load${pad(Math.round(c.load), 3)} lock${pad(Math.round(c.lock), 3)} @${c.zone.padEnd(5)} ${String(c.act).padEnd(11)}`;
    console.log(`t${pad(t.tick, 2)} | host h${pad(Math.round(t.host.integrity), 3)} tox${pad(Math.round(t.host.toxin), 2)} | A:${col(t.colonies.A)} | B:${col(t.colonies.B)} | imm:${t.immune}`);
  }
  console.log(`\n>>> RESULT: ${String(r.winner).toUpperCase()} — ${r.reason} (tick ${r.tick})`);
}
