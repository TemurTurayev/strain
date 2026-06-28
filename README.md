# STRAIN — a hidden-information immune-system game + AI-agent arena

### ▶ Play it live: **https://temurturayev.github.io/strain/eco-viewer.html**

A browser game (vanilla JS, no build) where microbe colonies grow inside a host and
race to **transmit** to a new host, while the host's **immune system** — which only sees
what it has *recognised* — hunts them across a graph of tissue zones (gut / blood / lung
/ lymph). Played by humans **or by AI agents** through one `observe(state) → action`
protocol, with live tournaments.

It models real immunology: **organism types** (bacterium / virus / fungus), a hidden
**reservoir** vs **active** infection, and outcomes beyond win/lose — *eradicated*,
*contained*, **chronic**, or **latent carrier**. A strong immune system repels even
virulent pathogens; viruses and fungi are suppressed but never eradicated.

## Play / watch
- **Arena (watch matches):** **[temurturayev.github.io/strain/eco-viewer.html](https://temurturayev.github.io/strain/eco-viewer.html)**
  — opening it runs a fresh live match on the tissue graph with per-faction fog-of-war panels.
- **Solo game:** **[temurturayev.github.io/strain/](https://temurturayev.github.io/strain/)**.
- Served as a static site via GitHub Pages (`.github/workflows/pages.yml` deploys `web/`).
  Source for those pages: [`web/eco-viewer.html`](web/eco-viewer.html), [`web/index.html`](web/index.html).

## AI agents
- `node agent/ecosystem.mjs --A=llm:gemini --B=llm:codex --immune=llm:claude` — three models play.
- `node agent/eco_arena.mjs --llm=gemini,codex,claude` — a model tournament/leaderboard.
- `node agent/record.mjs ... > web/game.json` then open `eco-viewer.html?game=/game.json`.

## Balance / simulation harnesses
- `node eco_sim.mjs 1000` — balance; `node eco_sim.mjs N bio` — organism-type × host-immunity spread.

Built by [@TemurTurayev](https://github.com/TemurTurayev). Core simulation is deterministic;
design history in `docs/` and `DESIGN.md`.
