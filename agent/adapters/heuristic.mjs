// heuristic.mjs — a deterministic baseline controller (no LLM). Reads only the
// observation the protocol exposes, so it's a fair reference opponent.
export function heuristic(obs) {
  if (obs.can_transmit) return "transmit";
  if (obs.colony_load >= obs.load_needed_for_window && obs.transmission_window <= 0) return "provoke";
  if (obs.immune_lockon > 50 || obs.immune_fixation > 62) return "suppress";
  return "replicate";
}
