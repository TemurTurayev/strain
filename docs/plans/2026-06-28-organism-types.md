# STRAIN — biological-realism layer: organism types + persistence

Goal (owner, a future paediatrician): make immunity & microbes behave like real life —
a strong immune system repels even virulent pathogens; cunning weak microbes cause
NEVER-ENDING (chronic) infections; fungi & latent viruses are NOT eliminated however
strong immunity is. So outcomes must include not just "cleared" vs "transmitted" but
CHRONIC PERSISTENCE and LATENCY/REACTIVATION.

## New: organism TYPE on each colony (genome.type)
`bacterium` (default) · `virus` · `fungus`. Each re-weights existing mechanics + adds
ONE persistence rule. (No new buttons.)

### bacterium — acute, clearable, can wall off (biofilm)
- Current behaviour (grow/move/toxin/transmit).
- `biofilm`: feeding while NOT migrating builds biofilm 0..40 (`+2/sessile feed`, decays
  −1/tick, *0.5 on move). Biofilm absorbs strike: `damage *= (1 - biofilm/80)`; and slows
  escape: `transmit needs quorum >= QUORUM_TRANSMIT + biofilm*0.3`. So a dug-in biofilm
  bacterium becomes hard to clear (chronic) but sluggish to transmit (abscess/chronic
  bacterial focus).

### virus — needs host cells, but LATENT reservoir is never cleared
- Grows only where glucose high (uses host machinery); capped lower than bacteria.
- LATENCY: when a strike/clearance would drop active presence, 25% of the lost biomass
  goes to `latent` (a hidden reservoir the immune CANNOT see or hit). Active presence can
  be cleared to 0, but if `latent > 1` the colony is NOT dead — it REACTIVATES:
  `presence += latent * reactivation`, where `reactivation = 0.08 + 0.12*(1 - immune_energy/12)`
  (faster when immunity is weak), and `latent` drains as it reactivates. → herpes/HIV/VZV:
  suppressed but never eliminated; flares when immunity drops.

### fungus — slow, clearance-RESISTANT, thrives when immunity is weak
- Slow growth (`grow *= 0.7`) but clearance-resistant: strike & toxin damage `*= 0.45`,
  and active presence cannot be driven below a floor of 6 while alive (colonisation).
- Opportunistic: growth `*= (1.4 - 0.5*immune_strength*activeImmunePressure)` — i.e. it
  BLOOMS when immune pressure is low (immunocompromised host) and is merely held in check
  (not cleared) when high. Rarely transmits, rarely cleared → tends to CHRONIC. → Candida/
  Aspergillus: you suppress it, you don't eradicate it.

## New: HOST immune strength (per game, like solo's host states)
`host.immune_strength` ∈ {0.6 immunocompromised, 1.0 healthy, 1.4 robust}, set at setup.
Multiplies every zone's `immune_presence` and the immune energy regen. A robust host
clears even a virulent fast bacterium before it transmits; an immunocompromised host lets
fungi/persistent organisms overgrow (and even weak microbes can transmit). This is the
"strongest pathogen can't break a strong immune system" vs "weak microbe runs wild in a
weak host" axis.

## New OUTCOME: chronic / persistent (not a clean win or loss)
`evaluateEco` today: transmit(colony) / cleared(immune) / contained(immune) / host_death(draw).
Add **chronic**: at MAX_TICKS, if a colony is still alive that the immune structurally
CANNOT clear — a virus with `latent>2`, a fungus, or a bacterium with `biofilm>20` — and it
never transmitted, the result is `chronic` ("the host now carries a persistent infection —
the immune system manages but cannot eliminate it"). Reflects TB/H.pylori/HSV/Candida.
A purely acute organism suppressed to the limit is still `contained` (immune win). So the
immune "winning" now means *eradication*, distinct from *lifelong management*.

## Harness / balance
`eco_sim.mjs` outcome tally gains a `chronic` bucket. Targets (rough, to verify):
- vary type per colony + host immune_strength across games.
- robust host vs bacterium: immune clears more (acute eradication common).
- immunocompromised host vs fungus/virus: chronic/transmit common, eradication rare.
- no single type auto-wins; host_death stays low; chronic is a real, frequent third outcome.

## Implementation order
1. genome.type + colony fields (latent, biofilm), host.immune_strength, zone immune_presence
   scaled by immune_strength at setup (recomputed each tick from base*scarMul*strength).
2. per-type growth/clearance hooks in feedColony / strikeColony / upkeep.
3. virus latency+reactivation; fungus floor+bloom; bacterium biofilm.
4. chronic outcome in evaluateEco; harness tally; rebalance.
5. surface type + state (latent/biofilm/chronic) in observe* + the viewer.
