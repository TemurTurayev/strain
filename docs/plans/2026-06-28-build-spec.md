# STRAIN — Build Spec v1 (Depth Layer + Arena Viewer)

Source: Consilium-reviewed design panel (4 design lenses → 2 adversarial critics → synthesis).
Both parts are scoped INDEPENDENT: depth touches `web/src/ecosystem.mjs` + `eco_sim.mjs`;
viewer touches `agent/` + new `web/src/viewer/` and NEVER edits the engine.

Verified engine facts (do not re-derive):
- strike dmg = `10 * immune_presence * (0.75 + lock/100)`
- sweep gain = `(10*ip + 0.12*sig) * (1 + mem/100) * exitMul * 0.5`
- passive lock decay `−3` floored at `memory*0.25`
- exit pre-transmit leak (resolveEcoTick step 3) = `signature+3, inflammation+2, lock += 3 + 6*(ratio−0.6)` when `presence/EXIT_THRESH >= 0.6`
- host integrity drains only from toxin + inflammation
- `observeImmune` is NOT exported — capture via `observeEco(w,"immune")`
- `w.log` is overwritten every tick; capture `resolveEcoTick(...).log` INSIDE the loop
- strike-damage log lines use Unicode minus U+2212 (`−`), not ASCII `-` — log parser must match `[−-]`

---

## PART A — DEPTH (edit `web/src/ecosystem.mjs` + `eco_sim.mjs` ONLY)

Final adopted set: `resistance`, `fibrosis`, `virulence`. CUT: sessile, virulence-misfire,
fatigue, strike-crit (all rejected by critique). Implement in order A0 → A1 → A2 → A3,
each behind a green regression gate.

### A0 — PREREQUISITE: upgrade `eco_sim.mjs` so it can DETECT dominance (do first)
The current harness runs only the default policies + 12% noise; neither ever spams
strike/toxin/sweep, so "still 43/57 after a change" is a FALSE NEGATIVE. Add:
1. **By-home winner tally.** Record each colony's seed `home`; on a colony win increment
   `winByHome[home]`. Print `gut% / lung% / blood%` of starts-that-win. Assert gut & lung
   each within 22–28%.
2. **Adversarial archetype policies** (plain fns over the same `observeEco` output):
   - `toxinSpammer`: `toxin` whenever `quorum>=QUORUM_TOXIN` and dominant zone has iron, else `feed`; `transmit` when legal.
   - `sweepSpamImmune`: always `sweep:<busiest exit>`.
   - `strikeSpamImmune`: `strike:<highest-lock contact>` whenever any contact `lock>=LOCK_TO_STRIKE`, else `scan` the hottest, else `sweep`.
3. **Matrix mode** (`node eco_sim.mjs 400 matrix`): each colony policy × each immune policy,
   print win% per cell. Assert no single colony line and no single immune line exceeds ~55% in any cell.
Ship A0 alone first; confirm baseline still ~43/57/0 and gut/lung ~25/26.

### A1 — `resistance` (per-colony, immune-owned, HIDDEN from colony) — SHIP FIRST
- Field `c.resistance`, init 0, clamp 0..0.45.
- In `strikeColony`, after `const dmg = 10 * w.zones[z].immune_presence * lockFactor;`:
  `const eff = dmg * (1 - c.resistance);` use `eff` for biomass subtraction + log.
  On a SUCCESSFUL bite only, after applying damage: `c.resistance = Math.min(0.45, c.resistance + 0.12);`
- Decay in `upkeep` colony loop (ALL colonies): `c.resistance = Math.max(0, c.resistance - 0.04);`
- UI: `observeImmune` contact gains `adapted: +(c.resistance*100).toFixed(0)+'%'`. Colony does NOT see it.
- Gate: `node eco_sim.mjs 400` → colony 41–46%, immune 54–59%, host_death <2%, gut/lung 22–28%.
  If colony >46%, lower cap to 0.35.

### A2 — `fibrosis` (per-zone, SHARED/visible terrain) — SHIP SECOND
- Field `zw.fibrosis` per zone, init 0, clamp 0..40.
- Accrual (action-driven, NEVER zone-keyed): `sweepZone` +2; successful `strikeColony` (success branch) +2 on that zone; `contain` +2.
- Effect — do NOT mutate `zw.immune_presence`; keep `ZONE_BASE[z].immune` as truth. In `upkeep`,
  after fibrosis decay: `const scarMul = clamp(1 - zw.fibrosis/80, 0.5, 1);`
  then `zw.immune_presence = ZONE_BASE[z].immune * scarMul;` (recomputed fresh each tick).
  Multiply glucose AND iron regen by the same `scarMul` (alongside the existing `regenMul`).
- Decay in `upkeep`: `zw.fibrosis = Math.max(0, zw.fibrosis - 0.5);`
- UI (shared): colony `zoneView[z]` gains `scarring: +zw.fibrosis.toFixed(0)`; `observeImmune` `zoneReads[z]` gains `fibrosis`.
- Gate: re-run 400; watch by-home gut/lung win-share, not just totals. If either exit drifts >3 pts,
  cut exit-zone sweep accrual to 1. scarMul never <0.5 → no dead node, host_death stays ~0.

### A3 — `virulence` (per-colony, colony-owned) — SHIP LAST, ONLY after A0 toxinSpammer exists
- Field `c.virulence`, init 0, clamp 0..1.
- In `toxinColony` success path only: `c.virulence = Math.min(1, c.virulence + 0.25);`
- In `feedColony`, after computing `grow`: `grow *= (1 + 0.10 * c.virulence);`
- In `upkeep` colony loop, before lock decay: `c.lock = clamp(c.lock + c.virulence * 1.2, 0, 100);`
- Decay in `upkeep`: `c.virulence = Math.max(0, c.virulence - 0.1);`
- UI: colony `me` gains `virulence: +(c.virulence*100).toFixed(0)+'%'`; immune infers only via faster-climbing lock (no field).
- Gate: harness MUST include toxinSpammer. Run 400; if colony >46% OR toxin archetype >55% in any matrix cell,
  cut kicker to 0.05 or drop the variable.

### A-guardrails (apply after every sub-change)
- Per-variable gate: `node eco_sim.mjs 400` → colony 41–46% (base 43), immune 54–59% (base 57), host_death <2% (base 0). Final pass 800–1000 games.
- No-dominant-node: by-home gut/lung each 22–28% (separate assertion).
- No-dominant-archetype: matrix mode, no colony/immune line >~55% in any cell.
- Determinism: NO new `Math.random` — all three are deterministic functions of state.
- Anti-camp patch preserved: the exit pre-transmit leak still fires; armor/none of these reduce the exit bulge leak.
- Hidden-info: `resistance` immune-only; `virulence` colony-only; `fibrosis` shared (physical terrain). No `observe*` leaks an exact opponent stat.

---

## PART B — ARENA: replay viewer (new files only; ZERO edits to `web/src/ecosystem.mjs`)

v1 = ground-truth blob board + recognition heat + immune-action FX + transmit/strike/clear events
(parsed from log) + fog-of-war reveal-truth panel toggle + a scrubber. DEFER drama/narrate/leaderboard,
recorded events[]/delta, per-chip hovers to v2.

### B1 — data contract (EcoReplay v1) — ground-truth only, derive the rest in the viewer
```
EcoReplay { format:"eco-replay", version:1, seed, source:"heuristic"|"llm"|"mixed",
  controllers:{<id>:string, immune:string},
  config:{ ZONES, ADJ, EXIT_THRESH, EXITS, QUORUM_TRANSMIT, QUORUM_TOXIN, DETECT_REVEAL,
           LOCK_TO_STRIKE, LOCK_TO_TRANSMIT, MAX_TICKS },   // copied at record time
  genomes:[{id,stealth,preferredO2,home},...],
  colonyMeta:{<id>:{color,label}},                          // viewer falls back to palette-by-sorted-id
  outcome:{type,winner,reason,tick},
  frames:[Frame,...] }

Frame {  // WORLD STATE AT START OF TICK t
  tick,
  host:{integrity,toxin},
  zones:{<z>:{glucose,iron,oxygen,immune_presence,inflammation,drainLast,sweptLast,
              contained:boolean,containTimer,is_exit,fibrosis}},   // fibrosis optional; tolerate absence
  colonies:{<id>:{alive,transmitted,presence:{<z>},signature:{<z>},lock,memory,sm,
                  resistance,virulence}},                          // raw engine fields only; resistance/virulence optional
  actions:{<id>:"<actionString>", immune:"<actionString>"},
  log:[ "<raw engine log line for this tick>", ... ],
  views:{<id>:<observeEco(w,id) verbatim>, immune:<observeEco(w,"immune") verbatim>} }
```
NOT in the record (derive in viewer): events (`parseLog(frame.log)`), deltas (subtract adjacent
frames), `quorum` (`min(100,sum(presence)*1.25)`), `dominant_zone` (argmax presence), `detection_state`
(bucket lock vs DETECT_REVEAL/LOCK_TO_STRIKE/LOCK_TO_TRANSMIT), `exit_progress` (`max over EXITS of
presence[z]/EXIT_THRESH[z]`), narration/drama/scoreboard.
`views` is the ONLY non-reconstructable data (est_load noisy, hidden_threat aggregate, contacts gate at
DETECT_REVEAL) — capture from the SAME pre-resolve `w` the policies saw.

DEGRADED MODE: the bare `playEcosystem` transcript drops in directly. `normalizeTranscript` maps each
`{tick,host,colonies:{id:{load,lock,memory,zone,act}},immune}` → partial Frame (whole `load` as one blob on
`zone`, `lock` for heat, `actions` from strings, `views` absent → panels show "private view not recorded",
zones env undefined → env layer hidden). Old/LLM transcripts still play.

Engine change required: NONE. Add a thin recorder `agent/record.mjs` wrapping the existing
`playEcosystem` loop: snapshot pre-resolve `w.zones`/`w.colonies`, capture `observeEco(w,f)` into `views`,
read `resolveEcoTick(...).log` per tick.

### B2 — file list (one responsibility + exports each; split along the frozen Frame[] boundary)
Builder 1 — DATA (no DOM; Node + browser):
- `agent/record.mjs` — Node recorder wrapping `playEcosystem`; emits EcoReplay v1; CLI writes JSON to stdout. Exports `recordEcosystem({genomes,controllers,seed})->Replay`; shares `buildFrame` with `live.js`.
- `web/src/viewer/replay.js` — pure data layer; freeze the Frame[] typedef at top; load recorded JSON OR bare transcript → canonical Frame[]; owns the single log parser (matches U+2212), interpolation, derivations. Exports `loadReplay`, `normalizeTranscript(t,meta)`, `lerpFrame(replay,tick,alpha)`, `parseLog(logLines)->Event[]`, `eventsAt(replay,tick)`, `derive(frame)`, `validateReplay(obj)`, `ZONE_KEYS`.
- `web/src/viewer/live.js` — in-browser recorder wrapping `freshEcosystem/observeEco/resolveEcoTick/defaultColonyPolicy/defaultImmunePolicy` + seeded RNG → fresh EcoReplay synchronously. Exports `runLiveGame({seed,genomes,controllers})->Replay`, `makeSeededRng(seed)`, `buildFrame(world,actions,log)`.

Builder 2 — VIEW (DOM/canvas; imports only replay.js exports):
- `web/src/viewer/graph.js` — static 4-node layout + geometry from `config.ADJ`/`EXIT_THRESH` (blood center hub; gut/lung/lymph around), hit-testing, DPR/resize mirroring `colony.js`. Exports `NODE_LAYOUT`, `EDGES`, `nodeAt(x,y)`, `zoneCenter(z)`, `isExit(z)`, `fitToCanvas(canvas)`.
- `web/src/viewer/render.js` — Canvas-2D draw of one interpolated frame + events; static layers cached on offscreen canvas like `colony.js` `bgCanvas`; palette read once on mount/resize (never getComputedStyle in RAF). Exports `mountViewer(canvas)->Viewer`, `Viewer.draw(interpFrame,events,theme)`, `Viewer.fx(event)`, `Viewer.resize()`, `Viewer.destroy()`.
- `web/src/viewer/panels.js` — DOM side panels from `frame.views` (hidden-vs-revealed); `revealTruth` toggle overlays ground-truth from `frame.colonies`; default renders only `views`. Exports `mountPanels(rootEl)->Panels`, `Panels.update(frame,{revealTruth})`, `Panels.setActiveFaction(id)`.
- `web/src/viewer/controls.js` — transport/clock: playhead (tick+alpha), play/pause/step/scrub/speed/seed, file-drop + "run live", drives rAF, fires draw/update/fx on tick-boundary events. Exports `mountControls({mountEl,viewer,panels,replay})->Controls`, `.load/.play/.pause/.seek/.setSpeed`.
- `web/src/viewer/index.js` — composition root; wires graph+render(canvas), panels, controls, live/JSON sources; assigns stable colors; `?v=` cache-bust. Exports `mountEcoViewer(rootEl)->{load,runLive,destroy}`.
- `web/eco-viewer.html` — no-build host page (sibling of `index.html`, reuse `styles.css`+`--vars`): `<canvas id=eco-graph>`, side-panel container, transport bar, file-drop zone; `import ./src/viewer/index.js?v=1`.

Builder 2 imports ONLY `lerpFrame`, `parseLog`/`eventsAt`, `derive`, `validateReplay`, `ZONE_KEYS`.
The frozen Frame[] typedef at the top of `replay.js` is the entire shared contract.

### B3 — render layers (back-to-front)
L0 host-integrity vignette + toxin scrim · L1 edges from ADJ (glow on migration) · L2 node bodies
(fill = glucose+iron richness, exit ring + threshold label on gut/lung, fibrosis as cracked overlay) ·
L3 recognition heat (∝ sum resident lock; exit pre-transmit leak = throbbing red rim when ratio>=0.6) ·
L4 inflammation stipple + containment hatch · L5 signature halos · L6 mass blobs (per colony per node,
ONE radius-encoded disc with max-radius clamp + overflow badge — NOT N packed particles; tint by
colonyMeta.color, shift red as lock crosses DETECT_REVEAL) · L7 immune-action overlay (sweep ring/scan
reticle/strike punch+shards/contain clamp/investigate magnifier/tolerize wash) · L8 event FX from parseLog
(transmit burst+streak, cleared dissolve, toxin cloud, snitch line) · L9 HUD (tick, outcome banner, legend
chips, exit readouts).
Interpolation: lerp continuous (presence/glucose/lock); apply discrete event step-changes at fixed alpha 0.5 (a strike "punches").

### B4 — playback controls
play/pause · step fwd/back one tick · scrub slider with event tick-marks · speed 0.5/1/2/4× · seed input +
"Run live (re-seed)" (in-browser via live.js) · "Load recorded JSON" file-drop/picker (EcoReplay v1 or bare
transcript) · faction focus (All / each colony / Immune) · **"Reveal truth" toggle** (overlays ground-truth on
panels — default shows only `views`) · replay-from-start / jump-to-end.
