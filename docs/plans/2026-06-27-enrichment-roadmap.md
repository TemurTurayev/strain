# STRAIN — enrichment roadmap (from agent-player feedback)

Source: a Consilium council of the models that PLAYED the game (Gemini/GPT/Claude),
critiquing as players + designers. Implement in ORDER; add depth via VISIBLE
environment indicators that change the value of existing actions — NOT 30 new buttons.

## Headline findings
- **Ecosystem is the strongest core** (hidden info + shared host = a real game).
  Solo/versus risk "calculator syndrome" (optimize toward the 100 limit) without
  environmental pressure. Fix with visible environment variables, not more buttons.
- Rename `immune_fixation` -> `recognition` / `immune_lock` (reads as immune
  certainty, not an abstract timer).
- Keep `provoke` as a deliberate risk/reward button, BUT add passive antigen leak
  on `replicate` so quiet farming also has a cost.

## TOP-5 by impact (implement in this order)
1. **Tissue graph (3–5 nodes: gut/lung/blood/skin/lymph).** FOUNDATION. Kills
   abstractness, solves immune blind-search (scan a specific node), gives microbes
   migration + blind zones, makes positioning a resource. Everything else sits on this.
2. **Explicit intel/scouting (intel tokens + `investigate`).** Heals "stealth just
   wins"; gives the immune a game BEFORE hard-detection; turns parallel farming into
   social deduction. (This is the user's "scouts/snitches".)
3. **`immune_memory` + split immune into innate/adaptive/regulatory cells.** Removes
   binary scan/strike; soft-enrage (an inevitable death timer vs a known strain).
4. **Metabolism (glucose/iron/oxygen/pH) + quorum sensing.** Niche/build choices;
   quorum creates a vulnerability window before transmit that the immune learns to read.
5. **`mutation_load` + biofilms (stealth vs armor builds).** Mutations become risky
   evolution, not free upgrades.

## Variables — CORE (add first), 0..100 unless noted
1. `zone_presence[z]` colony biomass per zone; `presence[z] += growth − immune_damage − migration_out`
2. `nutrient_glucose[z]` fast growth resource; `growth = base * glucose/(glucose+30)`
3. `nutrient_iron[z]` rare virulence resource; `toxin_gain *= iron/(iron+40)`
4. `quorum_level` mass coordination, gates strong actions; `quorum = colony_mass^1.2 / node_volume` (blocks strong actions from tiny mass -> vulnerability windows)
5. `signature` detectability; `signature = activity*0.5 + biomass*0.2 + toxin*0.7 − stealth*0.6`
6. `immune_lock[colony]` per-strain recognition; `lock += scan_success*20 + signature*0.08`, decay −3/turn
7. `immune_memory[colony]` long memory; cheaper scan + stronger strike on a known strain; `memory += 0.1*detected_signature`
8. `biofilm_integrity` armor absorbing strike, costs mobility; `biofilm += secrete*(mass/100) − strike_damage`; `transmit *= 1 − biofilm*0.004`
9. `inflammation[z]` local damage/noise, indirect pre-detect signal; `+= toxin*0.4 + damage*0.6 − suppress*0.5`
10. `immune_energy` global immune resource; `+= 12 − fever*8 − strike*15 − contain*10`, cap 100
11. `toxin_load` waste/toxins -> host death + detect; `+= provoke*15 + biomass*0.05 − clearance*8`
12. `host_integrity` host HP / death condition; `−= toxin*0.08 + inflammation*0.05 + fever*0.04`

## Variables — SECOND LAYER (environment depth)
13 `oxygen_level[z]` `growth *= 1 − abs(preferred_O2 − oxygen)/100`
14 `local_pH[z]` `pH = 7.4 − node_toxicity*0.1` (low pH: −growth, −signature)
15 `temperature[z]` `growth *= clamp(1 − (temp−37)*0.08, 0.4, 1.2)` (fever)
16 `innate_cells[z]` fast/rough immunity (sweep/fever); `+= inflammation*0.15 − exhaustion*0.1`
17 `adaptive_cells[z]` precise, active when `lock>35` (strike); `+= lock*0.08`
18 `regulatory_cells[z]` damps inflammation (tolerize/symbiosis); `+= tolerize*12 − provoke*4`
19 `immune_exhaustion` penalty for nonstop attacks; `+= action_cost*0.15 − rest*8`
20 `mutation_load` cost of mutations; `misfire_chance = mutation_load*0.4%`
21 `motility` migration; `move_success = 40 + motility − contain[z]`
22 `symbiosis_score` pacifist-win path; `+= suppress*4 + low_toxin_bonus − damage`

## Ecosystem intel/scouting (the user's "scouts/snitches") — no RTS micro
Resource: `Signaling Molecules (SM)`, generated passively at high `quorum_level`.
Intel token: `{zone, target_id?, signal_type, confidence%, age}`; signal types:
nutrient_drain / toxin_trace / biofilm_trace / motility_trace / immune_activity.

Colony actions:
- `scout(zone)` cost 5 biomass + 8 glucose; next turn -> intel on a neighbor zone;
  `P = 35 + scout_stealth + quorum*0.2 − immune_sweep*0.5 − inflammation*0.2`; risk +6 signature.
- `snitch(target)` rat out a rival: target +30 signature in a node for 1 turn; cost
  snitcher +10 signature, −reputation; reward `immune_ignore_bonus=15` for 2 turns
  ONLY if the snitch is true (immune verifies). A snitch does NOT guarantee a strike
  (keeps immune agency).
- `false_flag/shedding(zone)` shed 10% mass -> ghost cluster in a neighbor, signature
  spike; immune hits the decoy.
- `sell_intel(colony)` trade a token for nutrients / temp non-aggression (buyer may resell).
- `forge_signal(zone,type)` false trace, +35 false_signal for 2 turns, costs 8 iron;
  reveal `P = lock_on_forger*0.3 + adaptive_cells*0.2`.
- `scavenge` after a neighbor is struck, absorb remains: +nutrients, −signature (cell debris).

Immune actions (a game BEFORE hard-detect):
- `sweep(zone)` 8 energy; sees ANOMALIES not colonies (nutrient_drain/toxin_trace/
  false_signal); `detect_trace = 45 + innate_cells*0.3 − stealth*0.4`.
- `investigate(token)` 6 energy; verify a snitch/trace. True -> lock +20. False ->
  source_reputation −25, exhaustion +5. (This is the anti-snitch-abuse: immune need not trust.)
- `mark_source(colony)` temporarily don't attack a useful informant (tolerated_until
  = turn+2; resets if its toxin_load rises).

Result: emergent diplomacy — loud can frame quiet, quiet can live as an informant,
false signals become (paid) weapons, immune stops being a blindfolded tracker.

## Also
- Solo: rename fixation -> recognition; show action forecast ("replicate: +12 biomass,
  +8 signature, −3 nutrients"). Collapse 5 host states -> 3 emergent scales
  (host_integrity, inflammation, systemic_stress). Collapse 12 mutations -> 4
  categories (growth/stealth/toxicity/mobility).
- Versus: still needs tuning to ~50/50.
