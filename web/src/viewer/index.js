import { mountViewer } from "./render.js?v=1";
import { mountPanels } from "./panels.js?v=1";
import { mountControls } from "./controls.js?v=1";
import { initGraph } from "./graph.js?v=1";
import { runLiveGame } from "./live.js?v=1";
import { loadReplay, validateReplay, normalizeTranscript } from "./replay.js?v=1";
import { mountNarration } from "./narrate.js?v=1";

export function mountEcoViewer(rootEl) {
  const style = getComputedStyle(document.documentElement);
  const theme = {
     bgInner: style.getPropertyValue('--bg').trim() || "#1a2730",
     bgOuter: style.getPropertyValue('--surface-2').trim() || "#0a0c11",
     factionColors: {
        "A": "rgb(40, 200, 150)",
        "B": "rgb(200, 150, 40)",
        "C": "rgb(150, 40, 200)",
        "D": "rgb(200, 40, 150)"
     }
  };

  rootEl.innerHTML = `
    <div style="display: flex; flex-direction: column; height: 100vh; width: 100%; max-width: 100vw; overflow: hidden; background: var(--bg);">
       <div style="display: flex; flex: 1; min-height: 0; min-width: 0;">
          <div id="graph-container" style="flex: 3 1 0; position: relative; min-width: 0;">
             <canvas id="eco-canvas" style="width: 100%; height: 100%; display: block;"></canvas>
          </div>
          <div id="panels-container" style="flex: 1 1 0; min-width: 200px; max-width: 380px; background: var(--surface); border-left: 1px solid var(--border); display: flex; flex-direction: column; min-height: 0;">
             <div id="narration" style="flex: 1 1 55%; overflow-y: auto; padding: 12px 14px; border-bottom: 1px solid var(--border);"></div>
             <div id="faction-view" style="flex: 1 1 45%; overflow-y: auto;"></div>
          </div>
       </div>
       <div id="controls-container" style="flex: 0 0 auto; min-width: 0;">
       </div>
    </div>
  `;

  const canvas = rootEl.querySelector("#eco-canvas");
  const panelsEl = rootEl.querySelector("#faction-view");
  const narrationEl = rootEl.querySelector("#narration");
  const controlsEl = rootEl.querySelector("#controls-container");

  const viewer = mountViewer(canvas);
  viewer.draw({tick:0}, [], theme);

  let resizeTimeout;
  const ro = new ResizeObserver(() => {
     clearTimeout(resizeTimeout);
     resizeTimeout = setTimeout(() => viewer.resize(), 50);
  });
  ro.observe(rootEl.querySelector("#graph-container"));

  const panels = mountPanels(panelsEl);
  const narration = mountNarration(narrationEl, theme.factionColors);
  const controls = mountControls({ mountEl: controlsEl, viewer, panels, narration, replay: null, theme });

  initGraph({});

  function load(replay) {
     if (replay && replay.config) initGraph(replay.config);
     controls.load(replay);
  }

  function runLive(opts) {
     if (opts && (opts.seed || opts.genomes || opts.controllers)) { load(runLiveGame(opts)); return; }
     const btnLive = controlsEl.querySelector("#ctrl-live");
     if (btnLive) btnLive.click();
  }

  function destroy() {
     ro.disconnect();
     viewer.destroy();
     controls.pause();
     rootEl.innerHTML = "";
  }

  // auto-load a recorded match via ?game=<url> (shareable match links); else run a live game
  const gameUrl = new URLSearchParams(location.search).get("game");
  if (gameUrl) {
    fetch(gameUrl)
      .then((r) => r.json())
      .then((raw) => load(loadReplay(validateReplay(normalizeTranscript(raw, {})))))
      .catch((e) => { console.error("failed to auto-load game:", e); runLive(); });
  } else {
    setTimeout(() => runLive(), 100);
  }

  return { load, runLive, destroy };
}
