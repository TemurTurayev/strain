# STRAIN — agent arena

The original idea: **the player can be replaced by an AI agent** that watches the
metrics and decides — and agents can compete. This directory is that seam.

## The protocol

The engine exposes a clean `state → action` protocol (`engine.observe(state, build)`),
so a controller never touches engine internals — it only reads an observation and
returns one legal action (`replicate` · `suppress` · `provoke` · `transmit`).

A **controller / adapter** is just:

```js
async (observation, ctx) => "replicate"   // or { action, reason }
```

The same seam serves the human UI (the browser game) and an AI agent — exactly the
PANTHEON adapter pattern.

## Run a game

```bash
# a deterministic heuristic agent plays (fast, no LLM)
node agent/play.mjs --strain=aggressive --host=healthy

# a frontier model plays through the protocol (via the user's Consilium CLI,
# which drives Claude / GPT / Gemini). One model call per turn.
node agent/play.mjs --adapter=llm --provider=gemini --strain=sticky
```

It prints the full decision trace (the agent's view of the metrics each turn and
the action it chose) and the outcome.

## The arena (leaderboard)

Pit controllers against the same fixed set of (strain × host) scenarios and score
them by win-rate and how fast they win:

```bash
node agent/arena.mjs                      # heuristic baseline only
node agent/arena.mjs --llm=gemini,gpt     # add frontier-model agents (slow)
node agent/arena.mjs --llm=gemini --strains=sticky   # fewer scenarios for speed
```

## Files

- `runner.mjs` — `playGame({strain, host, adapter})`: drives one game via the protocol.
- `adapters/heuristic.mjs` — deterministic reference agent (reads only the observation).
- `adapters/cli.mjs` — LLM agent; hands the observation to a model via Consilium and parses the action. Uses `execFile` with an args array (no shell).
- `play.mjs` — play one game, print the trace.
- `arena.mjs` — the benchmark/leaderboard.

## Where this goes

This is single-player (your colony vs the host's immune system as an NPC), so the
"arena" currently scores agents on the same scenarios. Asymmetric agent-vs-agent
(a second playable side) is the next platform step, on the same protocol.
