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
