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
   `agent/ecosystem.mjs`. Several colonies share one host, compete invisibly for
   nutrients, race to transmit; immune can't see a colony until it detects it
   (sweep/scan), then contain/strike contacts. Per-faction partial `observeEco`.
   Verified 3-model game (Gemini A loud / GPT B stealthy / Claude immune): stealthy B
   slipped past the immune chasing loud A and won. **v1 — balance is rough.**

## Run
```
# solo: serve web/ with no-cache: python3 web/serve_nocache.py  -> http://localhost:5188
node agent/play.mjs --adapter=llm --provider=gemini      # agent plays solo
node agent/arena.mjs --llm=gemini,codex,claude           # solo agent leaderboard
node agent/versus.mjs --colony=llm:gemini --immune=llm:codex   # asymmetric agent vs agent
node agent/ecosystem.mjs --A=llm:gemini --B=llm:codex --immune=llm:claude  # 3-faction hidden-info
node balance_sim.mjs ; node versus_sim.mjs               # balance harnesses
```
Consilium binary: `/Users/temur/Desktop/Claude/consilium/target/release/consilium`
(`consilium run --provider gemini|codex|claude "<prompt>"`). The cli adapter uses it.

## IN FLIGHT (resume after compaction)
- **NEXT TASK: implement the enrichment roadmap** at
  `docs/plans/2026-06-27-enrichment-roadmap.md` (from the agent-players' feedback —
  ranked variables + tissue graph + intel/scouting design, with formulas). Order:
  (1) tissue graph 3–5 nodes, (2) core variables 1–12, (3) explicit intel/scouting
  (scout/snitch/investigate — the user's "scouts/snitches"), (4) environment layer,
  (5) mutation_load + biofilms. Add depth via VISIBLE env indicators, not new buttons.
  This is the user's "more variables → casual-simulation depth" ask. Enrich
  `ecosystem.mjs` first (it's the strongest mode), keep solo/versus intact.
- Also pending: tune versus to ~50/50; optional browser UI for versus/ecosystem.

## Notes
- `web/package.json` is `type:module`; agent `.mjs` import `../web/src/*.js`.
- Module imports in `index.html`/`main.js` carry `?v=2` (cache-bust). Bump if a cached
  module ever goes stale (no-cache server normally handles it).
- Security hook blocks the shell-exec call pattern; use execFile named differently
  (see `agent/adapters/cli.mjs`).
- Full design history: `DESIGN.md`, `docs/plans/`. Memory: `project_bio_arena_game.md`.
