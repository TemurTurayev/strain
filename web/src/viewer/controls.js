import { lerpFrame, eventsAt, loadReplay, normalizeTranscript, validateReplay } from "./replay.js?v=1";
import { runLiveGame } from "./live.js?v=1";
import { eventTicks } from "./narrate.js?v=1";

export function mountControls({ mountEl, viewer, panels, narration, replay, theme }) {
  let tick = 0;
  let alpha = 0;
  let speed = 1;
  let playing = false;
  let raf = null;
  let lastTime = 0;
  let revealTruth = false;
  let fxTick = -1; // last tick whose events we spawned FX for (prevents per-frame FX flood)
  theme = theme || {}; // carries factionColors + (per loaded replay) config for the renderer

  mountEl.innerHTML = `
    <div style="display: flex; gap: 8px; align-items: center; padding: 10px 14px; background: var(--surface); border-top: 1px solid var(--border); overflow-x: auto;">
       <button class="btn" id="ctrl-play">Play</button>
       <button class="btn" id="ctrl-pause">Pause</button>
       <button class="btn" id="ctrl-prev">|&lt;</button>
       <button class="btn" id="ctrl-next">&gt;|</button>
       <input type="range" id="ctrl-scrub" min="0" max="100" value="0" style="flex: 1; min-width: 100px;" />
       <select id="ctrl-speed" style="padding: 4px; border-radius: 4px;">
         <option value="0.5">0.5x</option>
         <option value="1" selected>1x</option>
         <option value="2">2x</option>
         <option value="4">4x</option>
       </select>
       <input type="text" id="ctrl-seed" placeholder="seed" style="width: 80px; padding: 4px;" />
       <button class="btn btn-primary" id="ctrl-live">Run live</button>
       <input type="file" id="ctrl-file" accept=".json" style="display:none;" />
       <button class="btn" id="ctrl-load">Load JSON</button>
       <label style="display:flex; align-items:center; gap:4px; font-size:13px;"><input type="checkbox" id="ctrl-truth" /> Reveal Truth</label>
       <select id="ctrl-faction" style="padding: 4px; border-radius: 4px;">
          <option value="">All Factions</option>
          <option value="immune">Immune</option>
       </select>
       <button class="btn" id="ctrl-start">|&lt;&lt;</button>
       <button class="btn" id="ctrl-end">&gt;&gt;|</button>
    </div>
  `;

  const btnPlay = mountEl.querySelector("#ctrl-play");
  const btnPause = mountEl.querySelector("#ctrl-pause");
  const btnPrev = mountEl.querySelector("#ctrl-prev");
  const btnNext = mountEl.querySelector("#ctrl-next");
  const scrub = mountEl.querySelector("#ctrl-scrub");
  const selSpeed = mountEl.querySelector("#ctrl-speed");
  const inputSeed = mountEl.querySelector("#ctrl-seed");
  const btnLive = mountEl.querySelector("#ctrl-live");
  const btnLoad = mountEl.querySelector("#ctrl-load");
  const inputFile = mountEl.querySelector("#ctrl-file");
  const chkTruth = mountEl.querySelector("#ctrl-truth");
  const selFaction = mountEl.querySelector("#ctrl-faction");
  const btnStart = mountEl.querySelector("#ctrl-start");
  const btnEnd = mountEl.querySelector("#ctrl-end");

  btnPlay.onclick = () => play();
  btnPause.onclick = () => pause();
  btnPrev.onclick = () => { tick = Math.max(0, tick - 1); alpha = 0; updateFrame(); };
  btnNext.onclick = () => { tick++; alpha = 0; updateFrame(); };
  scrub.oninput = (e) => { seek(parseInt(e.target.value, 10)); };
  selSpeed.onchange = (e) => { speed = parseFloat(e.target.value); };
  
  chkTruth.onchange = (e) => { revealTruth = e.target.checked; updateFrame(); };
  selFaction.onchange = (e) => { panels.setActiveFaction(e.target.value); updateFrame(); };
  
  btnStart.onclick = () => seek(0);
  btnEnd.onclick = () => seek(1000000);

  function loadFromJsonText(text) {
     try { load(loadReplay(validateReplay(normalizeTranscript(JSON.parse(text), {})))); }
     catch (err) { console.error("Failed to load replay", err); }
  }
  function readFileInto(file) { const r = new FileReader(); r.onload = (re) => loadFromJsonText(re.target.result); r.readAsText(file); }

  btnLive.onclick = () => {
     const seed = inputSeed.value || ("s" + Date.now().toString(36));
     inputSeed.value = seed; // surface the seed so the live game is reproducible/shareable
     const gameReplay = runLiveGame({ seed, genomes: [], controllers: {} });
     if (gameReplay) load(gameReplay);
  };

  btnLoad.onclick = () => inputFile.click();
  inputFile.onchange = (e) => { const file = e.target.files[0]; if (file) readFileInto(file); };

  mountEl.addEventListener("dragover", (e) => { e.preventDefault(); });
  mountEl.addEventListener("drop", (e) => {
     e.preventDefault();
     const file = e.dataTransfer.files[0];
     if (file) readFileInto(file);
  });

  function updateFrame() {
     if (!replay) return;
     const maxTick = replay.frames ? replay.frames.length - 1 : (replay.length ? replay.length - 1 : 100);
     tick = Math.min(tick, maxTick);
     scrub.max = maxTick;
     scrub.value = tick;

     const frame = lerpFrame(replay, tick, alpha);
     const evts = eventsAt(replay, tick);

     if (frame) {
         // spawn event FX once per tick crossing (alpha>=0.5), not every animation frame
         const fxEvts = (alpha >= 0.5 && tick !== fxTick) ? (fxTick = tick, evts) : [];
         viewer.draw(frame, fxEvts, theme);
         panels.update(frame, { revealTruth });
         if (narration) { try { narration.update(replay, tick); } catch (e) { /* one bad frame must not kill the loop */ } }
     }
  }

  function maxTickOf() {
     return replay && replay.frames ? replay.frames.length - 1 : (replay && replay.length ? replay.length - 1 : 100);
  }

  function loop(ts) {
     if (!playing) return;
     const dt = (ts - lastTime) / 1000;
     lastTime = ts;

     alpha += speed * dt;
     while (alpha >= 1.0) { alpha -= 1.0; tick++; }

     const maxTick = maxTickOf();
     if (tick >= maxTick) { tick = maxTick; alpha = 0; updateFrame(); pause(); return; } // stop at the end — don't spin rAF forever

     updateFrame();
     raf = requestAnimationFrame(loop);
  }

  function play() {
     if (playing) return;
     playing = true;
     lastTime = performance.now();
     raf = requestAnimationFrame(loop);
  }

  function pause() {
     playing = false;
     if (raf) cancelAnimationFrame(raf);
  }

  function seek(newTick) {
     tick = newTick;
     alpha = 0;
     fxTick = -1;
     updateFrame();
  }

  function load(newReplay) {
     replay = newReplay;
     tick = 0;
     alpha = 0;
     fxTick = -1;
     if (replay && replay.config) theme.config = replay.config; // exit thresholds etc. for the renderer
     if (replay && replay.colonyMeta) {
        // one color source for the whole UI: derive the graph palette from the replay's
        // colonyMeta so blobs, legend, and narration all agree per match.
        theme.factionColors = Object.fromEntries(Object.entries(replay.colonyMeta).map(([id, m]) => [id, m.color]));
        if (narration) narration.setMeta(replay.colonyMeta);
     }

     if (replay && replay.frames && replay.frames[0] && replay.frames[0].colonies) {
         // build faction options via DOM (textContent) — never interpolate replay ids into innerHTML
         selFaction.textContent = "";
         const add = (value, text) => { const o = document.createElement("option"); o.value = value; o.textContent = text; selFaction.appendChild(o); };
         add("", "All factions");
         add("immune", "Immune");
         for (const id of Object.keys(replay.frames[0].colonies)) add(id, `Colony ${id}`);
     }

     // scrubber event tick-marks via a native datalist
     try {
        const marks = eventTicks(replay);
        let dl = mountEl.querySelector("#ctrl-marks");
        if (!dl) { dl = document.createElement("datalist"); dl.id = "ctrl-marks"; mountEl.appendChild(dl); scrub.setAttribute("list", "ctrl-marks"); }
        dl.textContent = "";
        for (const m of marks) { const o = document.createElement("option"); o.value = m.tick; dl.appendChild(o); }
     } catch (e) { /* non-fatal */ }

     updateFrame();
  }

  if (replay) load(replay);

  return { load, play, pause, seek, setSpeed: (s) => speed = s };
}
