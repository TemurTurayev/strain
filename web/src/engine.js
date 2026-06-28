export const MAX_TURNS = 30; // hard backstop / autopsy horizon; the real clock is immune fixation
export const T_THRESH = 60;
export const CARRY = 300;
export const COL_VIS = 120;
export const START_COLONY = 10;
export const START_HOST = 100;
export const GENOME_BUDGET = 20;

export const PRESETS = {
  aggressive: { key:"aggressive", name:"Aggressive", virulence:8, stealth:2, adhesion:5, resistance:5,
    blurb:"Fast growth, loud. Race to transmit before the immune system catches up." },
  silent: { key:"silent", name:"Silent", virulence:2, stealth:8, adhesion:5, resistance:5,
    blurb:"Quiet and slow. The immune system barely sees you — win late, but safe." },
  sticky: { key:"sticky", name:"Sticky", virulence:4, stealth:4, adhesion:8, resistance:4,
    blurb:"High adhesion — transmits at a lower load. The easiest opener." },
};

function clampStat(x){ return Math.max(1, Math.min(10, x)); }
function shift(build, deltas){
  const b = { ...build };
  for (const k in deltas) b[k] = clampStat(b[k] + deltas[k]);
  return b;
}

export const MUTATIONS = [
  { id:"capsule", name:"Capsule", desc:"+2 resistance, −2 virulence", apply:b=>shift(b,{resistance:2,virulence:-2}) },
  { id:"sheen",   name:"Stealth sheen", desc:"+2 stealth, −2 virulence", apply:b=>shift(b,{stealth:2,virulence:-2}) },
  { id:"pili",    name:"Pili", desc:"+2 adhesion, −2 resistance", apply:b=>shift(b,{adhesion:2,resistance:-2}) },
  { id:"toxin",   name:"Toxin", desc:"+2 virulence, −2 stealth", apply:b=>shift(b,{virulence:2,stealth:-2}) },
  { id:"latency", name:"Latency", desc:"one-time: ignore immune damage for 2 turns", oneTime:true },
  { id:"drift",   name:"Antigenic drift", desc:"one-time: shed signature (lock-on −30)", oneTime:true },
];

export function need(build){ return T_THRESH / (0.5 + build.adhesion/10); }

export function freshState(){
  return { colony_load:START_COLONY, host_stability:START_HOST, inflammation:0,
    immune_lockon:0, transmission_window:0, turn:0, transmitted:false, latency_turns:0,
    fixation:0, suppressStreak:0, replicateStreak:0 };
}

// Dynamic immune fixation: the cost of VISIBILITY, not of time. Loud/aggressive
// play feeds the immune system faster; stealth dampens the signal; spamming one
// action is punished in the maths (streaks), not by a hand-patched floor.
export function fixationGain(action, lockOn, inflammation, stealth, suppressStreak, replicateStreak){
  const lockNorm = lockOn/100, inflNorm = inflammation/100, stealthNorm = stealth/10;
  const actionNoise = ({ replicate:1.25, suppress:0.65, provoke:1.85, transmit:1.10 })[action] || 1.0;
  const stealthShield = 1 - 0.32*stealthNorm;
  const immuneSignal = 0.55 + 0.55*lockNorm + 0.35*inflNorm;
  let g = 4.15 * immuneSignal * actionNoise * stealthShield;
  g += Math.max(0, suppressStreak-1)*0.85;  // anti "only suppress"
  g += Math.max(0, replicateStreak-2)*0.7;   // anti "only replicate"
  return Math.max(2.4, Math.min(11.5, g));
}

export function resolve(action, s, build){
  s = { ...s }; const L = [];
  const v=build.virulence/10, se=build.stealth/10, a=build.adhesion/10, r=build.resistance/10;
  if (action === "replicate"){
    const cap = Math.max(0, 1 - s.colony_load/CARRY);
    const g = s.colony_load*0.25*(0.5+v)*cap, inf = 3*(0.5+v)*(1-0.6*se);
    s.colony_load += g; s.inflammation += inf;
    L.push(["", "replicate → colony +"+g.toFixed(1)+", inflammation +"+inf.toFixed(1)]);
  } else if (action === "suppress"){
    const ni = s.inflammation*0.3, drop = 5*(0.5+se);
    L.push(["", "suppress → inflammation →"+ni.toFixed(1)+", lock-on −"+drop.toFixed(1)+" (tempo lost)"]);
    s.inflammation = ni; s.immune_lockon = Math.max(0, s.immune_lockon-drop);
  } else if (action === "provoke"){
    const inf = 8*(0.5+v), hit = 8*(0.5+v);
    s.transmission_window = 3; s.inflammation += inf; s.host_stability -= hit;
    L.push(["", "provoke → window open (3), host −"+hit.toFixed(1)+", inflammation +"+inf.toFixed(1)]);
  } else if (action === "transmit"){
    const eff = s.colony_load*(0.5+a);
    if (s.transmission_window>0 && eff>=T_THRESH){ s.transmitted = true;
      L.push(["ok", "transmit → success (effective "+eff.toFixed(1)+" ≥ "+T_THRESH+")"]); }
    else { s.immune_lockon = Math.min(100, s.immune_lockon+5);
      const rs = s.transmission_window<=0 ? "no open window" : "load too low (effective "+eff.toFixed(1)+" < "+T_THRESH+")";
      L.push(["no", "transmit → failed ("+rs+"), lock-on +5"]); }
  }
  const inflThisTurn = s.inflammation;
  const gain = s.inflammation*0.20, nl = Math.min(100, s.immune_lockon+gain);
  let dmg = s.colony_load*0.20*(nl/100)*(1-0.5*r);
  if (s.latency_turns>0){ dmg = 0; s.latency_turns -= 1; }
  s.immune_lockon = nl; s.colony_load = Math.max(0, s.colony_load-dmg);
  s.inflammation = s.inflammation*0.7; s.transmission_window = Math.max(0, s.transmission_window-1); s.turn += 1;
  // dynamic fixation: accumulate the immune system's certainty about you
  const sStreak = action === "suppress" ? (s.suppressStreak||0)+1 : 0;
  const rStreak = action === "replicate" ? (s.replicateStreak||0)+1 : 0;
  s.suppressStreak = sStreak; s.replicateStreak = rStreak;
  const fixG = fixationGain(action, nl, inflThisTurn, build.stealth, sStreak, rStreak);
  s.fixation = Math.min(100, (s.fixation||0) + fixG);
  L.push(["im", "immune → lock-on +"+gain.toFixed(1)+"→"+nl.toFixed(1)+", damage −"+dmg.toFixed(1)+", fixation +"+fixG.toFixed(1)]);
  return [s, L];
}

export function mutationOfferTurn(turn){ return turn>0 && turn%5===0; }

export function applyMutation(mut, s, build){
  s = { ...s }; let b = build;
  if (mut.oneTime){
    if (mut.id==="latency") s.latency_turns = 2;
    if (mut.id==="drift") s.immune_lockon = Math.max(0, s.immune_lockon-30);
  } else if (mut.apply){ b = mut.apply(build); }
  return { state:s, build:b };
}

export function evaluate(s){
  if (s.transmitted) return ["win","Transmitted","Your colony broke out to a new host before the immune system finished learning you."];
  if (s.colony_load<=0) return ["loss","Cleared","The immune system locked on and wiped the colony. Too loud, too soon."];
  if (s.host_stability<=0) return ["loss","Host collapsed","You killed the host before transmitting. Virulence with no exit."];
  if ((s.fixation||0) >= 100 || s.turn >= MAX_TURNS) return ["loss","Cornered","Immune fixation reached 100% — the host's adaptive response fully mapped your colony and the defences closed in and cleared it before you broke out."];
  return null;
}
