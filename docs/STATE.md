# STRAIN — project state / handoff

Repo: `/Users/temur/Desktop/strain` (git). Owner wants a **full, playable game he
enjoys** + the original vision: **AI agents play it through one protocol**, and a
multi-faction **hidden-information ecosystem** where Consilium models play factions.
Develop autonomously; consult Consilium (the council/agents) for design; don't ask
the user trivial questions; he doesn't care about other players' opinions yet.

## Four modes, one `observe(state) -> action` protocol

1. **Solo** (browser game) — `web/` (ES modules, no build). Steer a microbe colony
   to transmit before immune **fixation** (cost-of-visibility clock) hits 100. Has:
   dynamic fixation, action preview, 5 host states, decaying transmission window,
   symbiotic win, 12 mutations, dark "microscope" canvas (mitosis, immune hunters),
   watched per-turn beat, speed 1×/2×/4×, auto-play, tension hum, autopsy. Balance
   verified via `balance_sim.mjs`. **Solo is polished/balanced — protect it.**
2. **Agent arena** — `agent/` : `engine.observe()` protocol; `runner.mjs` +
   `adapters/{heuristic,cli}.mjs` (cli = LLM via Consilium); `play.mjs`, `arena.mjs`
   (leaderboard). LLM agents verified playing & winning solo.
3. **Versus** (asymmetric) — `web/src/versus.mjs` (SEPARATE from solo). Colony vs
   Immune, immune has 5 actions (scan/contain/strike/fever/tolerize) + `immune_energy`;
   simultaneous ticks; host death = mutual loss. `versus_sim.mjs` (balance harness,
   first cut ~36% colony / 64% immune — NEEDS tuning to ~50/50). `agent/versus.mjs`
   = agent-vs-agent (heuristic or LLM per side). Verified Gemini-colony beat GPT-immune.
4. **Ecosystem** (multi-faction, HIDDEN INFO) — `web/src/ecosystem.mjs` +
   `agent/ecosystem.mjs`. **v2 (tissue-graph, council-balanced).** Now played across
   a 4-ZONE GRAPH (gut/blood/lung/lymph, adjacency + 2 transmit exits gut/lung).
   Core vars: per-zone `presence`, metabolism `glucose/iron/oxygen`, `immune_lock`
   (recognition), `immune_memory` (soft-enrage w/ cap 80), `quorum` (gates transmit
   75 / toxin 35), per-zone `signature`, `toxin_load`, `host_integrity`, per-zone
   `inflammation`. Colony actions: feed/move:zone/hide/toxin/scout:zone/snitch:zone/
   transmit. Immune: sweep:zone/scan:ID/strike:ID/contain:zone/investigate:zone/
   tolerize — all zone-aware. INTEL LAYER: Signaling Molecules fund scout (recon a
   neighbour) and snitch (frame a rival -> immune tip); immune must `investigate` a
   tip to trust it (true=+30 lock localise, false=wasted energy → no blind trust).
   Anti-camping: mass at an exit leaks detection BEFORE transmit; biomass is
   intrinsically detectable. Balance harness `eco_sim.mjs`: **43% colony / 57% immune
   / 0% host-death**, gut 25% / lung 26% (no dominant archetype). Solo/versus untouched.

## Run
```
# solo: serve web/ with no-cache: python3 web/serve_nocache.py  -> http://localhost:5188
node agent/play.mjs --adapter=llm --provider=gemini      # agent plays solo
node agent/arena.mjs --llm=gemini,codex,claude           # solo agent leaderboard
node agent/versus.mjs --colony=llm:gemini --immune=llm:codex   # asymmetric agent vs agent
node agent/ecosystem.mjs --A=llm:gemini --B=llm:codex --immune=llm:claude  # 3-faction hidden-info
node balance_sim.mjs ; node versus_sim.mjs ; node eco_sim.mjs   # balance harnesses
```
Consilium binary: `/Users/temur/Desktop/Claude/consilium/target/release/consilium`
(`consilium run --provider gemini|codex|claude "<prompt>"`). The cli adapter uses it.

## IN FLIGHT (resume after compaction)
Enrichment roadmap `docs/plans/2026-06-27-enrichment-roadmap.md` — progress:
- ✅ (1) tissue graph 4 nodes — DONE (commit 62a065f)
- ✅ (2) core variables 1–12 — DONE (commit 62a065f, council-balanced)
- ✅ (3) intel/scouting scout/snitch/investigate — DONE (commit 66a3494)
- ☐ (4) environment 2nd layer: pH/temperature, innate/adaptive/regulatory immune
  cells, immune_exhaustion (roadmap vars 13–19). Add as VISIBLE modifiers on
  existing actions, not new buttons. (oxygen niche already in via preferredO2.)
- ☐ (5) mutation_load + biofilms (stealth-vs-armor builds; roadmap vars 20, 8).
- Also pending: tune versus to ~50/50; **no browser UI for ecosystem yet** (it's
  headless + agent only — a "watch model matches live" canvas is the big optional next).
Principle: depth via indicators that change the value of existing actions.

## Notes
- `web/package.json` is `type:module`; agent `.mjs` import `../web/src/*.js`.
- Module imports in `index.html`/`main.js` carry `?v=2` (cache-bust). Bump if a cached
  module ever goes stale (no-cache server normally handles it).
- Security hook blocks the shell-exec call pattern; use execFile named differently
  (see `agent/adapters/cli.mjs`).
- Full design history: `DESIGN.md`, `docs/plans/`. Memory: `project_bio_arena_game.md`.
