// narrate.js — a live play-by-play feed for the arena. Turns each tick's REAL engine
// log lines into readable, color-coded sentences (works for heuristic AND LLM matches,
// since it formats the recorded log rather than re-deriving any policy). Also surfaces
// the outcome banner on the final frame. DOM only; reads frames via replay.
import { ZONE_KEYS } from "./replay.js?v=1";

const ICON = { feed: "🌱", transmit: "🏁", strike: "⚔️", cleared: "💀", toxin: "☠️", sweep: "🔦", scan: "🔍", contain: "⛓️", investigate: "🕵️", snitch: "📣", scout: "👁️", hide: "🌫️", move: "↪️", tolerize: "🩹", FEVER: "🔥" };

// prettify one raw engine log line into { text, icon, who } (who = colony id or "immune")
function pretty(line) {
  let m;
  if ((m = line.match(/^(\w+) feed@(\w+) \+([\d.]+)/))) return { who: m[1], icon: ICON.feed, text: `${m[1]} grows in ${m[2]} (+${(+m[3]).toFixed(0)})` };
  if ((m = line.match(/^(\w+) TRANSMIT ✓ via (\w+)/))) return { who: m[1], icon: ICON.transmit, text: `${m[1]} TRANSMITS from ${m[2]} — it escapes the host!`, big: true };
  if ((m = line.match(/^(\w+) transmit ✗/))) return { who: m[1], icon: "🚫", text: `${m[1]} tries to escape — not ready` };
  if ((m = line.match(/^(\w+) move (\w+)->(\w+)/))) return { who: m[1], icon: ICON.move, text: `${m[1]} migrates ${m[2]} → ${m[3]}` };
  if ((m = line.match(/^(\w+) hide/))) return { who: m[1], icon: ICON.hide, text: `${m[1]} goes quiet (drops its signature)` };
  if ((m = line.match(/^(\w+) toxin@(\w+)/))) return { who: m[1], icon: ICON.toxin, text: `${m[1]} floods ${m[2]} with toxins` };
  if ((m = line.match(/^(\w+) scout (\w+)/))) return { who: m[1], icon: ICON.scout, text: `${m[1]} scouts ${m[2]}` };
  if ((m = line.match(/^(\w+) snitch -> (\w+)@(\w+)/))) return { who: m[1], icon: ICON.snitch, text: `${m[1]} snitches on ${m[2]} in ${m[3]}` };
  if ((m = line.match(/^(\w+) snitch@(\w+) \(false/))) return { who: m[1], icon: ICON.snitch, text: `${m[1]} plants a false tip in ${m[2]}` };
  if ((m = line.match(/^(\w+) cleared/))) return { who: m[1], icon: ICON.cleared, text: `${m[1]} is wiped out`, big: true };
  if ((m = line.match(/^immune sweep (\w+)/))) return { who: "immune", icon: ICON.sweep, text: `immune sweeps ${m[1]}` };
  if ((m = line.match(/^immune scan (\w+) \(\+(\d+)/))) return { who: "immune", icon: ICON.scan, text: `immune focuses on ${m[1]} (+${m[2]} recognition)` };
  if ((m = line.match(/^immune strike (\w+)@(\w+) [−-]([\d.]+)/))) return { who: "immune", icon: ICON.strike, text: `immune strikes ${m[1]} in ${m[2]} (−${(+m[3]).toFixed(0)})` };
  if ((m = line.match(/^immune strike ✗/))) return { who: "immune", icon: "⚔️", text: `immune strikes blindly — hurts the host` };
  if ((m = line.match(/^immune contain (\w+)/))) return { who: "immune", icon: ICON.contain, text: `immune quarantines ${m[1]}` };
  if ((m = line.match(/^immune investigate (\w+) -> localised (\w+)/))) return { who: "immune", icon: ICON.investigate, text: `immune acts on a tip → ${m[2]} localised in ${m[1]}` };
  if ((m = line.match(/^immune investigate (\w+) \(false/))) return { who: "immune", icon: ICON.investigate, text: `immune chases a false tip in ${m[1]} — wasted` };
  if (/^immune tolerize/.test(line)) return { who: "immune", icon: ICON.tolerize, text: `immune calms the host (heals, cools inflammation)` };
  return null;
}

const OUTCOME_TEXT = {
  transmit: (o) => `🏁 ${o.winner} transmitted — the microbe escaped to a new host`,
  cleared: () => `🛡️ Immune wins — infection ERADICATED (no reservoir left)`,
  contained: () => `🛡️ Immune wins — contained before it could spread or persist`,
  chronic: () => `🦠 CHRONIC infection — the immune system manages it but cannot eradicate it`,
  latent: () => `🌙 LATENT carrier — suppressed, but a hidden reservoir remains (it can flare later)`,
  host_death: () => `💀 Host died — everyone loses`,
};

export function mountNarration(rootEl, colonyMeta) {
  let meta = colonyMeta || {};
  function color(who) {
    if (who === "immune") return "var(--text)";
    const c = meta[who];
    return (c && (c.color || (typeof c === "string" ? c : null))) || "#9cf";
  }

  function setMeta(m) { meta = m || {}; }

  function update(replay, tick) {
    if (!rootEl || !replay) return;
    rootEl.textContent = "";
    const frames = replay.frames || [];
    const i = Math.max(0, Math.min(frames.length - 1, Math.floor(tick)));
    const isFinal = i >= frames.length - 1;

    const head = document.createElement("div");
    Object.assign(head.style, { fontWeight: "600", fontSize: "12px", color: "var(--text-2)", marginBottom: "4px", letterSpacing: ".04em" });
    head.textContent = `TICK ${frames[i]?.tick ?? i} — play-by-play`;
    rootEl.appendChild(head);

    const lines = (frames[i]?.log || []).map(pretty).filter(Boolean);
    if (!lines.length) rootEl.appendChild(line({ icon: "·", text: "(quiet tick)", who: "immune" }, color));
    for (const l of lines) rootEl.appendChild(line(l, color));

    if (isFinal && replay.outcome) {
      const o = replay.outcome;
      const banner = document.createElement("div");
      Object.assign(banner.style, { marginTop: "8px", padding: "8px 10px", borderRadius: "6px", background: "rgba(255,255,255,0.06)", fontWeight: "700", fontSize: "14px", color: "var(--text)" });
      const fn = Object.prototype.hasOwnProperty.call(OUTCOME_TEXT, o.type) ? OUTCOME_TEXT[o.type] : null;
      banner.textContent = (fn || (() => `${o.winner} — ${o.reason}`))(o);
      rootEl.appendChild(banner);
    }
  }

  return { update, setMeta };
}

function line(l, color) {
  const row = document.createElement("div");
  Object.assign(row.style, { display: "flex", gap: "7px", alignItems: "baseline", fontSize: l.big ? "14px" : "13px", fontWeight: l.big ? "700" : "400", margin: "2px 0", lineHeight: "1.35" });
  const ic = document.createElement("span"); ic.textContent = l.icon; ic.style.flex = "0 0 auto";
  const tx = document.createElement("span"); tx.textContent = l.text; tx.style.color = color(l.who);
  row.appendChild(ic); row.appendChild(tx);
  return row;
}

// for the scrubber: which ticks carry a notable event (transmit/strike/cleared/toxin)
export function eventTicks(replay) {
  const marks = [];
  (replay.frames || []).forEach((f, i) => {
    for (const ln of (f.log || [])) {
      if (/TRANSMIT ✓/.test(ln)) { marks.push({ tick: i, kind: "transmit" }); break; }
      if (/ cleared/.test(ln)) { marks.push({ tick: i, kind: "cleared" }); break; }
      if (/immune strike \w+@/.test(ln)) { marks.push({ tick: i, kind: "strike" }); break; }
      if (/ toxin@/.test(ln)) { marks.push({ tick: i, kind: "toxin" }); break; }
    }
  });
  return marks;
}

export { ZONE_KEYS };
