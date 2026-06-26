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
