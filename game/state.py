"""Immutable game state and tuning constants. Numbers here are starting clay."""

from __future__ import annotations

from dataclasses import dataclass

START_COLONY: float = 10.0
START_HOST: float = 100.0
MAX_TURNS: int = 18
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
