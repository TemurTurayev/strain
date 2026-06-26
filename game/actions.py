"""All game logic: action resolvers, passive immune step, turn dispatch.

This is the ONLY module where game numbers live (starting clay — tune by play).
Every resolver is pure: it returns a new GameState plus a causality log.
"""

from __future__ import annotations

from dataclasses import replace

from game.state import GameState, CARRYING_CAPACITY, TRANSMIT_THRESHOLD
from game.strains import Strain

Log = list[str]


def do_replicate(state: GameState, strain: Strain) -> tuple[GameState, Log]:
    v = strain.virulence / 10
    s = strain.stealth / 10
    capacity = max(0.0, 1 - state.colony_load / CARRYING_CAPACITY)
    growth = state.colony_load * 0.25 * (0.5 + v) * capacity
    inflame = 3.0 * (0.5 + v) * (1 - 0.6 * s)  # stealth = quieter replication
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
