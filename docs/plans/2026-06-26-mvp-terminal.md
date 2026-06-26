# STRAIN MVP (terminal) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A playable terminal game proving the core loop — steer a microbe colony to transmit before a learning immune system clears it — across 3 preset strains.

**Architecture:** Pure functional core (immutable `GameState`, action resolvers return new state + causality log) + a thin terminal UI (`main.py`) with a God Mode debug view. Contract, not engine: `resolve_turn(action, state, strain) -> (new_state, log)`. No JSON configs, no class hierarchies, no abstraction layers — concrete numbers in functions, strain numbers in a dict.

**Tech Stack:** Python 3.13, stdlib only (`dataclasses`), pytest 9 for tests. No third-party runtime deps.

**Design source:** `DESIGN.md` (§3 MVP spec, §4 discipline, §5 balance-as-clay). All numbers below are **starting clay** — tuned by playtest in Task 8.

---

## File Structure

```
strain/
  DESIGN.md                      # exists
  pyproject.toml                 # pytest config + package
  game/
    __init__.py
    state.py                     # GameState (frozen) + constants + initial_state()
    strains.py                   # Strain (frozen) + 3 presets STRAINS dict
    actions.py                   # do_* resolvers + _immune_step + resolve_turn
    outcome.py                   # evaluate(state) -> Optional[str]
  main.py                        # terminal loop + God Mode debug render
  tests/
    __init__.py
    test_state.py
    test_strains.py
    test_actions.py
    test_outcome.py
  README.md
```

Responsibilities: `state.py` holds data + constants only; `strains.py` holds the 3 archetypes; `actions.py` holds all game logic (the only place numbers live); `outcome.py` holds win/lose rules; `main.py` is I/O only. Files that change together (all action math) live together in `actions.py`.

**Run tests from repo root:** `python3 -m pytest -q` (root on sys.path → `import game` works).

---

## Task 0: Scaffold

**Files:**
- Create: `pyproject.toml`, `game/__init__.py`, `tests/__init__.py`

- [ ] **Step 1: Create `pyproject.toml`**

```toml
[project]
name = "strain"
version = "0.0.1"
requires-python = ">=3.11"

[tool.pytest.ini_options]
pythonpath = ["."]
testpaths = ["tests"]
```

- [ ] **Step 2: Create empty package markers**

`game/__init__.py` and `tests/__init__.py` — both empty files.

- [ ] **Step 3: Commit**

```bash
git add pyproject.toml game/__init__.py tests/__init__.py
git commit -m "chore: scaffold strain package + pytest config"
```

---

## Task 1: GameState (`game/state.py`)

**Files:**
- Create: `game/state.py`
- Test: `tests/test_state.py`

- [ ] **Step 1: Write failing test**

```python
# tests/test_state.py
import dataclasses
import pytest
from game.state import GameState, initial_state, MAX_TURNS, TRANSMIT_THRESHOLD


def test_initial_state_values():
    s = initial_state()
    assert s.colony_load == 10.0
    assert s.host_stability == 100.0
    assert s.inflammation == 0.0
    assert s.immune_lockon == 0.0
    assert s.transmission_window == 0
    assert s.turn == 0
    assert s.transmitted is False


def test_state_is_immutable():
    s = initial_state()
    with pytest.raises(dataclasses.FrozenInstanceError):
        s.colony_load = 999.0  # type: ignore[misc]


def test_constants():
    assert MAX_TURNS == 15
    assert TRANSMIT_THRESHOLD == 60.0
```

- [ ] **Step 2: Run test, verify it fails**

Run: `python3 -m pytest tests/test_state.py -q`
Expected: FAIL (`ModuleNotFoundError: No module named 'game.state'`)

- [ ] **Step 3: Implement `game/state.py`**

```python
"""Immutable game state and tuning constants. Numbers here are starting clay."""

from __future__ import annotations

from dataclasses import dataclass

START_COLONY: float = 10.0
START_HOST: float = 100.0
MAX_TURNS: int = 15
TRANSMIT_THRESHOLD: float = 60.0
CARRYING_CAPACITY: float = 300.0


@dataclass(frozen=True, slots=True)
class GameState:
    colony_load: float
    host_stability: float
    inflammation: float
    immune_lockon: float
    transmission_window: int
    turn: int
    transmitted: bool = False


def initial_state() -> GameState:
    return GameState(
        colony_load=START_COLONY,
        host_stability=START_HOST,
        inflammation=0.0,
        immune_lockon=0.0,
        transmission_window=0,
        turn=0,
        transmitted=False,
    )
```

- [ ] **Step 4: Run test, verify it passes**

Run: `python3 -m pytest tests/test_state.py -q`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add game/state.py tests/test_state.py
git commit -m "feat: immutable GameState + constants"
```

---

## Task 2: Strains (`game/strains.py`)

**Files:**
- Create: `game/strains.py`
- Test: `tests/test_strains.py`

- [ ] **Step 1: Write failing test**

```python
# tests/test_strains.py
from game.strains import Strain, STRAINS


def test_three_presets_exist():
    assert set(STRAINS) == {"aggressive", "silent", "sticky"}


def test_aggressive_profile():
    s = STRAINS["aggressive"]
    assert s.name == "Aggressive"
    assert s.virulence == 8
    assert s.stealth == 2


def test_silent_is_stealthy():
    assert STRAINS["silent"].stealth == 8
    assert STRAINS["silent"].virulence == 2


def test_sticky_is_adhesive():
    assert STRAINS["sticky"].adhesion == 8
```

- [ ] **Step 2: Run test, verify it fails**

Run: `python3 -m pytest tests/test_strains.py -q`
Expected: FAIL (`ModuleNotFoundError: No module named 'game.strains'`)

- [ ] **Step 3: Implement `game/strains.py`**

```python
"""The three MVP strain archetypes. Stats are ints on a 1..10 scale (clay)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Strain:
    name: str
    virulence: int
    stealth: int
    adhesion: int
    resistance: int


STRAINS: dict[str, Strain] = {
    "aggressive": Strain("Aggressive", virulence=8, stealth=2, adhesion=5, resistance=5),
    "silent": Strain("Silent", virulence=2, stealth=8, adhesion=4, resistance=5),
    "sticky": Strain("Sticky", virulence=4, stealth=4, adhesion=8, resistance=5),
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `python3 -m pytest tests/test_strains.py -q`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add game/strains.py tests/test_strains.py
git commit -m "feat: three preset strains"
```

---

## Task 3: Actions — Replicate & Suppress (`game/actions.py`)

**Files:**
- Create: `game/actions.py`
- Test: `tests/test_actions.py`

- [ ] **Step 1: Write failing test**

```python
# tests/test_actions.py
import pytest
from game.state import initial_state, GameState
from game.strains import STRAINS
from game.actions import do_replicate, do_suppress


def test_replicate_grows_colony_and_inflames():
    s = initial_state()
    new, log = do_replicate(s, STRAINS["aggressive"])
    assert new.colony_load > s.colony_load
    assert new.inflammation > s.inflammation
    assert log and "Replicate" in log[0]


def test_aggressive_grows_faster_than_silent():
    s = initial_state()
    agg, _ = do_replicate(s, STRAINS["aggressive"])
    sil, _ = do_replicate(s, STRAINS["silent"])
    assert agg.colony_load > sil.colony_load


def test_suppress_cools_inflammation_and_lockon_no_growth():
    s = GameState(colony_load=50.0, host_stability=100.0, inflammation=20.0,
                  immune_lockon=30.0, transmission_window=0, turn=0)
    new, log = do_suppress(s, STRAINS["silent"])
    assert new.inflammation < s.inflammation
    assert new.immune_lockon < s.immune_lockon
    assert new.colony_load == s.colony_load  # tempo lost, no growth
    assert "Suppress" in log[0]
```

- [ ] **Step 2: Run test, verify it fails**

Run: `python3 -m pytest tests/test_actions.py -q`
Expected: FAIL (`ModuleNotFoundError: No module named 'game.actions'`)

- [ ] **Step 3: Implement Replicate + Suppress in `game/actions.py`**

```python
"""All game logic: action resolvers, passive immune step, turn dispatch.

This is the ONLY module where game numbers live (starting clay — tune by play).
Every resolver is pure: it returns a new GameState plus a causality log.
"""

from __future__ import annotations

from dataclasses import replace

from game.state import GameState, CARRYING_CAPACITY
from game.strains import Strain

Log = list[str]


def do_replicate(state: GameState, strain: Strain) -> tuple[GameState, Log]:
    v = strain.virulence / 10
    s = strain.stealth / 10
    capacity = max(0.0, 1 - state.colony_load / CARRYING_CAPACITY)
    growth = state.colony_load * 0.25 * (0.5 + v) * (1 - 0.5 * s) * capacity
    inflame = 3.0 * (0.5 + v)
    new = replace(
        state,
        colony_load=state.colony_load + growth,
        inflammation=state.inflammation + inflame,
    )
    return new, [f"Replicate → colony +{growth:.1f}, inflammation +{inflame:.1f}"]


def do_suppress(state: GameState, strain: Strain) -> tuple[GameState, Log]:
    s = strain.stealth / 10
    new_inflammation = state.inflammation * 0.3
    lockon_drop = 5.0 * (0.5 + s)
    new_lockon = max(0.0, state.immune_lockon - lockon_drop)
    new = replace(state, inflammation=new_inflammation, immune_lockon=new_lockon)
    return new, [
        f"Suppress → inflammation →{new_inflammation:.1f}, "
        f"lock-on -{lockon_drop:.1f} (tempo lost)"
    ]
```

- [ ] **Step 4: Run test, verify it passes**

Run: `python3 -m pytest tests/test_actions.py -q`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add game/actions.py tests/test_actions.py
git commit -m "feat: replicate + suppress actions"
```

---

## Task 4: Actions — Provoke & Transmit

**Files:**
- Modify: `game/actions.py`
- Modify: `tests/test_actions.py`

- [ ] **Step 1: Add failing tests**

```python
# append to tests/test_actions.py
from game.actions import do_provoke, do_transmit
from game.state import TRANSMIT_THRESHOLD


def test_provoke_opens_window_hurts_host_inflames():
    s = initial_state()
    new, log = do_provoke(s, STRAINS["aggressive"])
    assert new.transmission_window == 3
    assert new.host_stability < s.host_stability
    assert new.inflammation > s.inflammation
    assert "Provoke" in log[0]


def test_transmit_succeeds_with_open_window_and_high_load():
    s = GameState(colony_load=80.0, host_stability=100.0, inflammation=0.0,
                  immune_lockon=0.0, transmission_window=2, turn=5)
    new, log = do_transmit(s, STRAINS["sticky"])
    assert new.transmitted is True
    assert "SUCCESS" in log[0]


def test_transmit_fails_without_window():
    s = GameState(colony_load=200.0, host_stability=100.0, inflammation=0.0,
                  immune_lockon=10.0, transmission_window=0, turn=5)
    new, log = do_transmit(s, STRAINS["sticky"])
    assert new.transmitted is False
    assert new.immune_lockon > s.immune_lockon  # exposure penalty
    assert "FAILED" in log[0]
```

- [ ] **Step 2: Run, verify fail**

Run: `python3 -m pytest tests/test_actions.py -q`
Expected: FAIL (`cannot import name 'do_provoke'`)

- [ ] **Step 3: Add Provoke + Transmit to `game/actions.py`**

```python
# add imports at top of game/actions.py:
from game.state import TRANSMIT_THRESHOLD


def do_provoke(state: GameState, strain: Strain) -> tuple[GameState, Log]:
    v = strain.virulence / 10
    inflame = 8.0 * (0.5 + v)
    host_hit = 8.0 * (0.5 + v)
    new = replace(
        state,
        transmission_window=3,
        inflammation=state.inflammation + inflame,
        host_stability=state.host_stability - host_hit,
    )
    return new, [f"Provoke → window OPEN(3), host -{host_hit:.1f}, inflammation +{inflame:.1f}"]


def do_transmit(state: GameState, strain: Strain) -> tuple[GameState, Log]:
    a = strain.adhesion / 10
    effective = state.colony_load * (0.5 + a)
    if state.transmission_window > 0 and effective >= TRANSMIT_THRESHOLD:
        new = replace(state, transmitted=True)
        return new, [f"Transmit → SUCCESS (effective {effective:.1f} ≥ {TRANSMIT_THRESHOLD})"]
    penalty = 5.0
    new = replace(state, immune_lockon=min(100.0, state.immune_lockon + penalty))
    reason = "no open window" if state.transmission_window <= 0 else (
        f"load too low (effective {effective:.1f} < {TRANSMIT_THRESHOLD})"
    )
    return new, [f"Transmit → FAILED ({reason}), lock-on +{penalty:.1f}"]
```

- [ ] **Step 4: Run, verify pass**

Run: `python3 -m pytest tests/test_actions.py -q`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add game/actions.py tests/test_actions.py
git commit -m "feat: provoke + transmit actions"
```

---

## Task 5: Immune step + resolve_turn dispatch

**Files:**
- Modify: `game/actions.py`
- Modify: `tests/test_actions.py`

- [ ] **Step 1: Add failing tests**

```python
# append to tests/test_actions.py
from game.actions import resolve_turn


def test_immune_step_runs_after_action_via_resolve_turn():
    s = GameState(colony_load=100.0, host_stability=100.0, inflammation=10.0,
                  immune_lockon=50.0, transmission_window=2, turn=3)
    new, log = resolve_turn("replicate", s, STRAINS["aggressive"])
    assert new.turn == s.turn + 1                 # immune step advances turn
    assert new.immune_lockon > s.immune_lockon     # learns from inflammation
    assert new.transmission_window == 1            # window ticked down
    assert any("immune" in line for line in log)


def test_high_lockon_damages_colony():
    s = GameState(colony_load=100.0, host_stability=100.0, inflammation=0.0,
                  immune_lockon=100.0, transmission_window=0, turn=3)
    new, _ = resolve_turn("suppress", s, STRAINS["aggressive"])
    assert new.colony_load < s.colony_load


def test_resolve_turn_rejects_unknown_action():
    s = initial_state()
    with pytest.raises(ValueError):
        resolve_turn("teleport", s, STRAINS["silent"])
```

- [ ] **Step 2: Run, verify fail**

Run: `python3 -m pytest tests/test_actions.py -q`
Expected: FAIL (`cannot import name 'resolve_turn'`)

- [ ] **Step 3: Add `_immune_step` + `resolve_turn` to `game/actions.py`**

```python
def _immune_step(state: GameState, strain: Strain) -> tuple[GameState, Log]:
    r = strain.resistance / 10
    lockon_gain = state.inflammation * 0.20
    new_lockon = min(100.0, state.immune_lockon + lockon_gain)
    dmg = state.colony_load * 0.20 * (new_lockon / 100.0) * (1 - 0.5 * r)
    new = replace(
        state,
        immune_lockon=new_lockon,
        colony_load=max(0.0, state.colony_load - dmg),
        inflammation=state.inflammation * 0.7,
        transmission_window=max(0, state.transmission_window - 1),
        turn=state.turn + 1,
    )
    return new, [f"[immune] lock-on +{lockon_gain:.1f}→{new_lockon:.1f}, damage -{dmg:.1f}"]


_ACTIONS = {
    "replicate": do_replicate,
    "suppress": do_suppress,
    "provoke": do_provoke,
    "transmit": do_transmit,
}


def resolve_turn(action: str, state: GameState, strain: Strain) -> tuple[GameState, Log]:
    if action not in _ACTIONS:
        raise ValueError(f"unknown action: {action!r} (valid: {', '.join(_ACTIONS)})")
    after_action, log1 = _ACTIONS[action](state, strain)
    after_immune, log2 = _immune_step(after_action, strain)
    return after_immune, log1 + log2
```

- [ ] **Step 4: Run, verify pass**

Run: `python3 -m pytest tests/test_actions.py -q`
Expected: PASS (9 passed)

- [ ] **Step 5: Commit**

```bash
git add game/actions.py tests/test_actions.py
git commit -m "feat: passive immune step + resolve_turn dispatch"
```

---

## Task 6: Outcome (`game/outcome.py`)

**Files:**
- Create: `game/outcome.py`
- Test: `tests/test_outcome.py`

- [ ] **Step 1: Write failing test**

```python
# tests/test_outcome.py
from game.state import GameState, initial_state
from game.outcome import evaluate


def _state(**kw) -> GameState:
    base = dict(colony_load=50.0, host_stability=50.0, inflammation=0.0,
                immune_lockon=0.0, transmission_window=0, turn=5, transmitted=False)
    base.update(kw)
    return GameState(**base)


def test_no_outcome_mid_game():
    assert evaluate(initial_state()) is None


def test_win_when_transmitted():
    assert evaluate(_state(transmitted=True)) == "WIN"


def test_loss_colony_cleared():
    assert "cleared" in evaluate(_state(colony_load=0.0))


def test_loss_host_died():
    assert "host" in evaluate(_state(host_stability=0.0)).lower()


def test_loss_timeout():
    assert "time" in evaluate(_state(turn=15)).lower()
```

- [ ] **Step 2: Run, verify fail**

Run: `python3 -m pytest tests/test_outcome.py -q`
Expected: FAIL (`No module named 'game.outcome'`)

- [ ] **Step 3: Implement `game/outcome.py`**

```python
"""Win/lose rules. Pure function over GameState."""

from __future__ import annotations

from game.state import GameState, MAX_TURNS


def evaluate(state: GameState, max_turns: int = MAX_TURNS) -> str | None:
    if state.transmitted:
        return "WIN"
    if state.colony_load <= 0:
        return "LOSS: immune system cleared the colony"
    if state.host_stability <= 0:
        return "LOSS: host died before transmission"
    if state.turn >= max_turns:
        return "LOSS: ran out of time (host recovered)"
    return None
```

- [ ] **Step 4: Run, verify pass**

Run: `python3 -m pytest tests/test_outcome.py -q`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add game/outcome.py tests/test_outcome.py
git commit -m "feat: outcome evaluation"
```

---

## Task 7: Terminal UI + God Mode debug (`main.py`)

**Files:**
- Create: `main.py`

- [ ] **Step 1: Implement `main.py`**

```python
"""STRAIN — terminal MVP. God Mode debug view ON by default (balance with eyes open)."""

from __future__ import annotations

from game.state import GameState, initial_state, MAX_TURNS, TRANSMIT_THRESHOLD
from game.strains import STRAINS, Strain
from game.actions import resolve_turn
from game.outcome import evaluate

ACTIONS = ["replicate", "suppress", "provoke", "transmit"]


def render(state: GameState, strain: Strain) -> str:
    win = state.transmission_window
    window = f"OPEN ({win})" if win > 0 else "closed"
    return (
        f"\n── Turn {state.turn}/{MAX_TURNS} · Strain: {strain.name} ──\n"
        f"  Colony load .......... {state.colony_load:6.1f}   "
        f"(transmit needs effective ≥ {TRANSMIT_THRESHOLD})\n"
        f"  Host stability ....... {state.host_stability:6.1f}\n"
        f"  Immune lock-on ....... {state.immune_lockon:6.1f} / 100\n"
        f"  Transmission window .. {window}\n"
        f"  [debug] inflammation . {state.inflammation:6.1f}\n"
    )


def choose_strain() -> Strain:
    keys = list(STRAINS)
    print("Choose a strain:")
    for i, k in enumerate(keys, 1):
        s = STRAINS[k]
        print(f"  {i}. {s.name:11s} V{s.virulence} S{s.stealth} A{s.adhesion} R{s.resistance}")
    while True:
        raw = input("> ").strip().lower()
        if raw in keys:
            return STRAINS[raw]
        if raw.isdigit() and 1 <= int(raw) <= len(keys):
            return STRAINS[keys[int(raw) - 1]]
        print("Invalid. Type a number or strain name.")


def choose_action() -> str:
    print("Action: " + " · ".join(f"[{a[0]}]{a[1:]}" for a in ACTIONS) + " · [q]uit")
    while True:
        raw = input("> ").strip().lower()
        if raw in ("q", "quit"):
            return "quit"
        for a in ACTIONS:
            if raw == a or raw == a[0]:
                return a
        print("Invalid action.")


def main() -> None:
    print("=== STRAIN (MVP) ===")
    strain = choose_strain()
    state = initial_state()
    while True:
        print(render(state, strain))
        result = evaluate(state)
        if result is not None:
            print(f">>> {result} <<<")
            return
        action = choose_action()
        if action == "quit":
            print("Aborted.")
            return
        state, log = resolve_turn(action, state, strain)
        for line in log:
            print("   " + line)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Smoke-run (non-interactive)**

Run: `printf "sticky\nr\nr\np\nt\n" | python3 main.py`
Expected: prints turns, strain panel, action logs; ends with a `>>> WIN/LOSS <<<` line or continues. Must not crash.

- [ ] **Step 3: Commit**

```bash
git add main.py
git commit -m "feat: terminal UI with God Mode debug view"
```

---

## Task 8: Balance playtest pass + README

**Files:**
- Create: `README.md`
- Possibly modify: `game/actions.py`, `game/state.py` (number tuning only)

- [ ] **Step 1: Full test suite green**

Run: `python3 -m pytest -q`
Expected: PASS (all tests, ~23)

- [ ] **Step 2: Play ~20 games by hand across all 3 strains**

Goal checks (from DESIGN.md §5):
- It is possible to **both win and lose** with each strain.
- Extreme strategies ("always replicate", "always suppress") **lose more often** than mixed play.
- The three strains **play differently** (Aggressive races, Silent stalls, Sticky transmits earlier).
- After a loss you can name what you'd do differently (the §4 criterion #5).

If any check fails, tune **only numbers** in `game/actions.py` / `game/state.py` (growth rate, lock-on gain, damage, TRANSMIT_THRESHOLD, MAX_TURNS). Re-run tests after each change. Do NOT add new variables or actions (respect the two-lists rule in DESIGN.md §4.2).

- [ ] **Step 3: Write `README.md`**

```markdown
# STRAIN (MVP)

Terminal prototype: steer a microbe colony to transmit before a learning immune system clears it. See `DESIGN.md` for the full design.

## Run

    python3 main.py

## Test

    python3 -m pytest -q

## The loop
Replicate (grow, but inflame → immune learns) · Suppress (cool down, lose tempo) · Provoke (open transmission window, hurt host) · Transmit (win if window open and colony big enough). Three strains: Aggressive / Silent / Sticky.

Numbers are tuning clay — see `DESIGN.md` §5.
```

- [ ] **Step 4: Commit**

```bash
git add README.md game/
git commit -m "feat: balance pass + README; MVP playable"
```

---

## Self-Review

- **Spec coverage (DESIGN.md §3):** 4 states → `GameState` (Task 1) + `render` (Task 7). 4 actions → Tasks 3–4. 3 strains → Task 2. Contract `resolve_turn` → Task 5. Outcomes → Task 6. God Mode debug → Task 7 (`render` shows inflammation + full state). Two-lists / numbers-as-clay discipline → Task 8 guardrails. ✓
- **Deferred (DESIGN.md §3.2, §6):** no `Mutate`, no free genome budget, no graphics — correctly absent. ✓
- **Type consistency:** `GameState` fields identical across all tasks; `resolve_turn(action, state, strain)`, `evaluate(state)`, `Strain` fields (`virulence/stealth/adhesion/resistance`) consistent throughout. ✓
- **Placeholders:** none — every step has complete code or an exact command. ✓
```
