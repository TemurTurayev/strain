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
    assert "time" in evaluate(_state(turn=18)).lower()
