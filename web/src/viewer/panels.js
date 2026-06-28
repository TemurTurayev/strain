export function mountPanels(rootEl) {
  let activeFaction = null;

  function setActiveFaction(id) {
    activeFaction = id;
  }

  function update(frame, { revealTruth }) {
    if (!rootEl) return;
    if (!frame) return;
    
    rootEl.innerHTML = "";

    if (!frame.views) {
       rootEl.innerHTML = "<div style='padding: 20px; color: #888;'>Private view not recorded</div>";
       return;
    }

    let view = null;
    if (activeFaction && activeFaction !== "") {
       view = frame.views[activeFaction];
    } else {
       view = frame.views["immune"] || Object.values(frame.views)[0];
    }

    if (!view) {
       rootEl.innerHTML = "<div style='padding: 20px; color: #888;'>No view data</div>";
       return;
    }

    let html = `<div style="padding: 14px; font-family: monospace; font-size: 13px; color: var(--text);">`;
    html += `<h4 style="margin-top:0; margin-bottom: 8px;">Faction View: ${activeFaction || "Default"}</h4>`;
    
    html += `<pre style="white-space: pre-wrap; word-wrap: break-word; color: var(--text-2);">${JSON.stringify(view, null, 2)}</pre>`;
    
    if (revealTruth) {
       html += `<h4 style="margin-top: 16px; margin-bottom: 8px;">Ground Truth Overlay</h4>`;
       if (frame.colonies) {
           html += `<pre style="white-space: pre-wrap; word-wrap: break-word; color: var(--text-2);">${JSON.stringify(frame.colonies, null, 2)}</pre>`;
       }
       if (frame.zones) {
           html += `<pre style="white-space: pre-wrap; word-wrap: break-word; color: var(--text-2);">${JSON.stringify(frame.zones, null, 2)}</pre>`;
       }
    }
    
    html += `</div>`;
    rootEl.innerHTML = html;
  }

  return { update, setActiveFaction };
}
