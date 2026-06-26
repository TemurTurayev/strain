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
