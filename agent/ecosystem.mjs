// ecosystem.mjs (agent) — multi-agent, hidden-information match. Each faction
// (colony A, colony B, the immune system) is driven by its own controller that
// sees ONLY its partial observation. Heuristic or LLM (different model) per side.
//   node agent/ecosystem.mjs
//   node agent/ecosystem.mjs --A=llm:gemini --B=llm:codex --immune=llm:claude
import {
  freshEcosystem, observeEco, resolveEcoTick, evaluateEco, colonyIds,
  defaultColonyPolicy, defaultImmunePolicy, MAX_TICKS,
} from "../web/src/ecosystem.mjs";
import { askModel } from "./adapters/cli.mjs";

function parseEco(text, faction, contactIds) {
  const t = String(text || "").toLowerCase();
  const lines = t.trim().split(/\r?\n/).filter(Boolean);
  const legal = faction === "immune"
    ? ["sweep", "scan", "strike", "contain", "tolerize"]
    : ["feed", "hide", "transmit"];
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(new RegExp("\\b(" + legal.join("|") + ")\\b(?:\\s*[:=]?\\s*([a-z0-9]+))?"));
    if (m) {
      let act = m[1];
      if (faction === "immune" && ["scan", "strike", "contain"].includes(act)) {
        // find a target id mentioned on the line, else default
        const tgt = (m[2] || (contactIds.find((id) => lines[i].includes(id.toLowerCase())))) || "";
        return tgt ? act + ":" + tgt.toUpperCase() : act;
      }
      return act;
    }
  }
  return legal[0];
}

function colonyPrompt(o) {
  return [
    `You are microbe COLONY ${o.id} inside a host. You CANNOT see other colonies, but they compete with you for the host's nutrients.`,
    `Goal: be the first to reach load ${o.transmit_threshold} and TRANSMIT (escape) — before a rival transmits or the immune system clears you.`,
    "Actions: feed (grow, but raises your signature, which the immune system can detect) · hide (drop your signature & detection, but no growth) · transmit (escape if load is high enough).",
    "",
    `STATE t${o.tick}: your load ${o.me.load}, signature ${o.me.signature}, how-detected ${o.me.detected}/100. Host nutrients ${o.host.nutrients}, inflammation ${o.host.inflammation}, health ${o.host.health}. Competition for nutrients (unseen rivals): ${o.competition}.`,
    "Reply with ONLY one word: feed, hide, or transmit.",
  ].join("\n");
}

function immunePrompt(o) {
  const cs = o.contacts.length
    ? o.contacts.map((c) => `${c.id}(load~${c.est_load}, detection ${c.detection})`).join(", ")
    : "none yet";
  return [
    "You are the HOST IMMUNE SYSTEM. Hidden microbe colonies are trying to grow and escape. You can only act on colonies you have DETECTED.",
    "Goal: clear or contain every colony before any of them transmits. WARNING: if host health hits 0 it is a MUTUAL LOSS — don't over-aggress.",
    "Actions: sweep (raise detection on everything a little) · scan (or scan:ID — localize a hidden threat) · strike:ID (damage a detected contact, needs its detection >= 40) · contain:ID (slow a contact) · tolerize (heal the host, lower inflammation).",
    "",
    `STATE t${o.tick}: host health ${o.host.health}, inflammation ${o.host.inflammation}, nutrients ${o.host.nutrients}. Your energy ${o.energy}.`,
    `Detected contacts: ${cs}. Hidden threat signal (undetected colonies out there): ${o.hidden_threat}.`,
    "Reply with ONE action, e.g. 'strike:A' or 'scan' or 'tolerize'.",
  ].join("\n");
}

function makeController(spec, faction) {
  if (!spec || spec === "heuristic") return faction === "immune" ? defaultImmunePolicy : defaultColonyPolicy;
  const provider = spec.replace(/^llm:/, "");
  return async (o) => {
    const prompt = faction === "immune" ? immunePrompt(o) : colonyPrompt(o);
    const contactIds = faction === "immune" ? o.contacts.map((c) => c.id) : [];
    try { return parseEco(await askModel(provider, prompt), faction === "immune" ? "immune" : "colony", contactIds); }
    catch { return faction === "immune" ? "sweep" : "feed"; }
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
      colonies: Object.fromEntries(ids.map((id) => [id, { load: w.colonies[id].load, sig: w.colonies[id].signature, det: w.colonies[id].detection, act: actions[id] || (w.colonies[id].transmitted ? "—done—" : "—dead—") }])),
      immune: actions.immune,
    });
    w = resolveEcoTick(w, actions);
  }
  const out = w.outcome || evaluateEco(w) || { winner: "immune", reason: "timeout" };
  return { ...out, tick: w.tick, transcript };
}

// ---- CLI ----
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
  const genomes = [{ id: "A", stealth: 3 }, { id: "B", stealth: 7 }]; // A loud/fast, B stealthy
  const controllers = {
    A: makeController(args.A, "A"),
    B: makeController(args.B, "B"),
    immune: makeController(args.immune, "immune"),
  };
  console.log(`ECOSYSTEM — A(${args.A || "heuristic"}, loud) vs B(${args.B || "heuristic"}, stealthy) vs IMMUNE(${args.immune || "heuristic"})\n`);
  const r = await playEcosystem({ genomes, controllers });
  const pad = (x, n) => String(x).padStart(n);
  for (const t of r.transcript) {
    console.log(
      `t${pad(t.tick, 2)} | host h${pad(Math.round(t.host.health), 3)} n${pad(Math.round(t.host.nutrients), 3)} infl${pad(Math.round(t.host.inflammation), 2)} | ` +
      `A:load${pad(Math.round(t.colonies.A.load), 3)} det${pad(Math.round(t.colonies.A.det), 3)} ${String(t.colonies.A.act).padEnd(8)} | ` +
      `B:load${pad(Math.round(t.colonies.B.load), 3)} det${pad(Math.round(t.colonies.B.det), 3)} ${String(t.colonies.B.act).padEnd(8)} | imm:${t.immune}`
    );
  }
  console.log(`\n>>> RESULT: ${String(r.winner).toUpperCase()} — ${r.reason} (tick ${r.tick})`);
}
