// runner.mjs — play one full game of STRAIN driven by a pluggable controller.
// A controller (adapter) is `async (observation, ctx) => action`. This is the
// seam that lets an AI agent play the game through the state->action protocol.
import { freshState, resolve, evaluate, observe, LEGAL_ACTIONS } from "../web/src/engine.js";

export async function playGame({ strain, host, adapter, maxTurns = 60 }) {
  let s = freshState(host);
  const transcript = [];
  for (let i = 0; i < maxTurns; i++) {
    const verdict = evaluate(s);
    if (verdict) return { outcome: verdict[0], title: verdict[1], detail: verdict[2], turn: s.turn, transcript };
    const obs = observe(s, strain);
    let action, reason = "";
    try {
      const out = await adapter(obs, { strain, host });
      action = typeof out === "string" ? out : out?.action;
      reason = (typeof out === "object" && out?.reason) || "";
    } catch (e) {
      action = "replicate"; reason = "adapter error: " + (e?.message || e);
    }
    if (!LEGAL_ACTIONS.includes(action)) action = "replicate";
    transcript.push({ turn: s.turn, obs, action, reason });
    [s] = resolve(action, s, strain);
  }
  return { outcome: "loss", title: "Timeout", turn: s.turn, transcript };
}
