// panels.js — DOM side panels showing each faction's PRIVATE view (fog of war),
// with an optional ground-truth overlay. All replay-derived values go through
// textContent (never innerHTML), so a loaded JSON can't inject markup/script.
export function mountPanels(rootEl) {
  let activeFaction = null;

  function setActiveFaction(id) { activeFaction = id; }

  function el(tag, text, styles) {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (styles) Object.assign(e.style, styles);
    return e;
  }
  function safeJson(v) { try { return JSON.stringify(v, null, 2); } catch { return String(v); } }

  function update(frame, opts) {
    const revealTruth = opts && opts.revealTruth;
    if (!rootEl) return;
    rootEl.textContent = "";
    if (!frame) return;

    if (!frame.views) {
      rootEl.appendChild(el("div", "Private view not recorded", { padding: "20px", color: "#888" }));
      return;
    }
    const view = (activeFaction && frame.views[activeFaction]) || frame.views.immune || Object.values(frame.views)[0];
    if (!view) {
      rootEl.appendChild(el("div", "No view data", { padding: "20px", color: "#888" }));
      return;
    }

    const wrap = el("div", null, { padding: "14px", fontFamily: "ui-monospace, monospace", fontSize: "13px", color: "var(--text)" });
    wrap.appendChild(el("h4", `Faction view: ${activeFaction || "immune"}`, { margin: "0 0 8px" }));
    wrap.appendChild(el("pre", safeJson(view), { whiteSpace: "pre-wrap", wordWrap: "break-word", color: "var(--text-2)" }));

    if (revealTruth) {
      wrap.appendChild(el("h4", "Ground truth (omniscient)", { margin: "16px 0 8px" }));
      if (frame.colonies) wrap.appendChild(el("pre", safeJson(frame.colonies), { whiteSpace: "pre-wrap", wordWrap: "break-word", color: "var(--text-2)" }));
      if (frame.zones) wrap.appendChild(el("pre", safeJson(frame.zones), { whiteSpace: "pre-wrap", wordWrap: "break-word", color: "var(--text-2)" }));
    }
    rootEl.appendChild(wrap);
  }

  return { update, setActiveFaction };
}
