import pytest
from game.state import initial_state, GameState, TRANSMIT_THRESHOLD
from game.strains import STRAINS
from game.actions import (
    do_replicate,
    do_suppress,
    do_provoke,
    do_transmit,
    resolve_turn,
)


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
