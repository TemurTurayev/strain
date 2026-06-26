# STRAIN (MVP)

Terminal prototype: steer a microbe colony to **transmit** to a new host before a **learning immune system** clears it. See [`DESIGN.md`](DESIGN.md) for the full design.

## Run

    python3 main.py

## Test

    python3 -m pytest -q

## The loop

| Action | What it does |
|---|---|
| **Replicate** | grow the colony — but inflame the host, so the immune system learns you |
| **Suppress** | cool inflammation and drop immune lock-on — but lose tempo (no growth) |
| **Provoke** | open a transmission window — but hurt the host |
| **Transmit** | win, if a window is open and the colony is big enough |

Three strains play differently:
- **Aggressive** — fast growth, loud → race to transmit before the immune system catches up.
- **Silent** — quiet and slow → the immune system barely sees you; win late but safe.
- **Sticky** — high adhesion → transmits at a lower colony load; the easiest opener.

The God Mode debug view (inflammation, lock-on, causality log) is **on by default** — balance with eyes open. All numbers are tuning clay; see [`DESIGN.md`](DESIGN.md) §5.

## Status

Phase-1 vertical slice. Deferred to later phases: free genome budget, mutations, real-time, AI agents, multiple maps/factions, graphics. See `docs/plans/`.
