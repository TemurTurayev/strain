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
        try:
            raw = input("> ").strip().lower()
        except EOFError:
            raise SystemExit(0)
        if raw in keys:
            return STRAINS[raw]
        if raw.isdigit() and 1 <= int(raw) <= len(keys):
            return STRAINS[keys[int(raw) - 1]]
        print("Invalid. Type a number or strain name.")


def choose_action() -> str:
    print("Action: " + " · ".join(f"[{a[0]}]{a[1:]}" for a in ACTIONS) + " · [q]uit")
    while True:
        try:
            raw = input("> ").strip().lower()
        except EOFError:
            return "quit"
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
