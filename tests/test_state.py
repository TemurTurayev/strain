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
    assert MAX_TURNS == 18
    assert TRANSMIT_THRESHOLD == 60.0
