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

// ---------------------------------------------------------------------------
// Host states — one per run, visible from the start. They re-weight existing
// formulas (no new buttons), so the same strain plays differently each run.
// ---------------------------------------------------------------------------
const HOST_BASE = {
  transmitMod: 0,    // added to the transmit threshold (negative = easier)
  windowTurns: 3,    // turns a provoke keeps the window open
  inflDecay: 0.7,    // inflammation multiplier each turn (higher = lingers)
  lockGainMul: 1,    // immune lock-on growth multiplier
  dmgMul: 1,         // immune damage multiplier
  suppressMul: 1,    // suppress effectiveness multiplier
  fixLockMul: 1,     // how hard lock-on feeds fixation
  adhesionMod: 0,    // added to adhesion for transmission
  startHost: 100,    // starting host health
};
export const HOSTS = {
  healthy:        { ...HOST_BASE, key:"healthy", name:"Healthy host", blurb:"A textbook host. No quirks — pure skill check." },
  feverish:       { ...HOST_BASE, key:"feverish", name:"Feverish", inflDecay:0.82, transmitMod:-8,
                    blurb:"Runs hot: symptoms come easy (transmit −8), but inflammation lingers and keeps the immune system primed." },
  mucus:          { ...HOST_BASE, key:"mucus", name:"Mucus flow", windowTurns:2, adhesionMod:1.5,
                    blurb:"Thick mucus: you cling harder (+adhesion), but every transmission window closes one turn sooner." },
  immunocompromised:{ ...HOST_BASE, key:"immunocompromised", name:"Immunocompromised", lockGainMul:0.7, startHost:78,
                    blurb:"Weak defences — lock-on rises slowly. But the host is frail; less room to provoke before you kill it." },
  hypervigilant:  { ...HOST_BASE, key:"hypervigilant", name:"Hypervigilant", fixLockMul:1.5, suppressMul:1.4,
                    blurb:"Twitchy immune system: being seen costs more fixation — but suppressing it works much better." },
};
export const HOST_KEYS = Object.keys(HOSTS);
function host(s){ return (s && s.host) || HOST_BASE; }

function clampStat(x){ return Math.max(1, Math.min(10, x)); }
function shift(build, deltas){
  const b = { ...build };
  for (const k in deltas) b[k] = clampStat(b[k] + deltas[k]);
  return b;
}

export const MUTATIONS = [
  // permanent genome shifts (conservation: every gain is paid for)
  { id:"capsule", name:"Capsule", desc:"+2 resistance, −2 virulence", apply:b=>shift(b,{resistance:2,virulence:-2}) },
  { id:"sheen",   name:"Stealth sheen", desc:"+2 stealth, −2 virulence", apply:b=>shift(b,{stealth:2,virulence:-2}) },
  { id:"pili",    name:"Pili", desc:"+2 adhesion, −2 resistance", apply:b=>shift(b,{adhesion:2,resistance:-2}) },
  { id:"toxin",   name:"Toxin", desc:"+2 virulence, −2 stealth", apply:b=>shift(b,{virulence:2,stealth:-2}) },
  { id:"armor",   name:"Thick wall", desc:"+2 resistance, −2 adhesion", apply:b=>shift(b,{resistance:2,adhesion:-2}) },
  { id:"spikes",  name:"Adhesins", desc:"+2 adhesion, −2 stealth", apply:b=>shift(b,{adhesion:2,stealth:-2}) },
  { id:"cloak",   name:"Cloak", desc:"+2 stealth, −2 adhesion", apply:b=>shift(b,{stealth:2,adhesion:-2}) },
  { id:"virulent",name:"Virulent", desc:"+2 virulence, −2 resistance", apply:b=>shift(b,{virulence:2,resistance:-2}) },
  // one-time effects
  { id:"latency", name:"Latency", desc:"one-time: ignore immune damage for 2 turns", oneTime:true },
  { id:"drift",   name:"Antigenic drift", desc:"one-time: shed your signature (lock-on −30)", oneTime:true },
  { id:"purge",   name:"Antigen purge", desc:"one-time: fixation −15, but host −8", oneTime:true },
  { id:"bloom",   name:"Bloom", desc:"one-time: colony +20%, fixation +6", oneTime:true },
];

// ---------------------------------------------------------------------------
// Transmission helpers (centralised so UI, hints, preview, autopsy all agree).
// The window now DECAYS: full power on the turn it opens, weaker if you dawdle.
// ---------------------------------------------------------------------------
export function windowPower(window){ return ({3:1.0, 2:0.85, 1:0.66})[window] || 0; }
export function transmitThreshold(s){ return T_THRESH + (host(s).transmitMod || 0); }
export function adhesionEff(s, build){ return build.adhesion + (host(s).adhesionMod || 0); }
export function transmitScore(s, build){
  return s.colony_load * (0.5 + adhesionEff(s, build)/10) * windowPower(s.transmission_window);
}
// rough colony load needed to transmit at a freshly-opened window (for hints).
// host-aware overload: needNow(state, build); plain need(build) assumes a healthy host.
export function need(build){ return T_THRESH / (0.5 + build.adhesion/10); }
export function needNow(s, build){ return transmitThreshold(s) / (0.5 + adhesionEff(s, build)/10); }

export function freshState(hostState){
  const h = hostState || HOSTS.healthy;
  return { colony_load:START_COLONY, host_stability:h.startHost ?? START_HOST, inflammation:0,
    immune_lockon:0, transmission_window:0, turn:0, transmitted:false, latency_turns:0,
    fixation:0, suppressStreak:0, replicateStreak:0, symbiosisStreak:0, host:h };
}

// Dynamic immune fixation: the cost of VISIBILITY, not of time.
export function fixationGain(action, lockOn, inflammation, stealth, suppressStreak, replicateStreak, fixLockMul){
  const lockNorm = lockOn/100, inflNorm = inflammation/100, stealthNorm = stealth/10;
  const actionNoise = ({ replicate:1.25, suppress:0.65, provoke:1.85, transmit:1.10 })[action] || 1.0;
  const stealthShield = 1 - 0.32*stealthNorm;
  const immuneSignal = 0.55 + 0.55*lockNorm*(fixLockMul||1) + 0.35*inflNorm;
  let g = 4.15 * immuneSignal * actionNoise * stealthShield;
  g += Math.max(0, suppressStreak-1)*0.85;
  g += Math.max(0, replicateStreak-2)*0.7;
  return Math.max(2.4, Math.min(11.5, g));
}

export function resolve(action, s, build){
  s = { ...s }; const L = [];
  const h = host(s);
  const v=build.virulence/10, se=build.stealth/10, r=build.resistance/10;
  if (action === "replicate"){
    const cap = Math.max(0, 1 - s.colony_load/CARRY);
    const g = s.colony_load*0.25*(0.5+v)*cap, inf = 3*(0.5+v)*(1-0.6*se);
    s.colony_load += g; s.inflammation += inf;
    L.push(["", "replicate → colony +"+g.toFixed(1)+", inflammation +"+inf.toFixed(1)]);
  } else if (action === "suppress"){
    const ni = s.inflammation*0.3, drop = 5*(0.5+se)*(h.suppressMul||1);
    L.push(["", "suppress → inflammation →"+ni.toFixed(1)+", lock-on −"+drop.toFixed(1)+" (tempo lost)"]);
    s.inflammation = ni; s.immune_lockon = Math.max(0, s.immune_lockon-drop);
  } else if (action === "provoke"){
    const inf = 8*(0.5+v), hit = 8*(0.5+v);
    s.transmission_window = h.windowTurns; s.inflammation += inf; s.host_stability -= hit;
    L.push(["", "provoke → window open ("+h.windowTurns+"), host −"+hit.toFixed(1)+", inflammation +"+inf.toFixed(1)]);
  } else if (action === "transmit"){
    const score = transmitScore(s, build), thr = transmitThreshold(s);
    if (s.transmission_window>0 && score>=thr){ s.transmitted = true;
      L.push(["ok", "transmit → success (score "+score.toFixed(1)+" ≥ "+thr.toFixed(0)+")"]); }
    else { s.immune_lockon = Math.min(100, s.immune_lockon+5);
      const rs = s.transmission_window<=0 ? "no open window" : "load too low (score "+score.toFixed(1)+" < "+thr.toFixed(0)+")";
      L.push(["no", "transmit → failed ("+rs+"), lock-on +5"]); }
  }
  const inflThisTurn = s.inflammation;
  const gain = s.inflammation*0.20*(h.lockGainMul||1), nl = Math.min(100, s.immune_lockon+gain);
  let dmg = s.colony_load*0.20*(nl/100)*(1-0.5*r)*(h.dmgMul||1);
  if (s.latency_turns>0){ dmg = 0; s.latency_turns -= 1; }
  s.immune_lockon = nl; s.colony_load = Math.max(0, s.colony_load-dmg);
  s.inflammation = s.inflammation*(h.inflDecay||0.7);
  s.transmission_window = Math.max(0, s.transmission_window-1); s.turn += 1;
  const sStreak = action === "suppress" ? (s.suppressStreak||0)+1 : 0;
  const rStreak = action === "replicate" ? (s.replicateStreak||0)+1 : 0;
  s.suppressStreak = sStreak; s.replicateStreak = rStreak;
  const fixG = fixationGain(action, nl, inflThisTurn, build.stealth, sStreak, rStreak, h.fixLockMul);
  s.fixation = Math.min(100, (s.fixation||0) + fixG);
  // symbiosis: stay large, quiet and gentle for 3 turns and the host tolerates you
  const symbiotic = s.colony_load>50 && (s.fixation||0)<20 && s.host_stability>90;
  s.symbiosisStreak = symbiotic ? (s.symbiosisStreak||0)+1 : 0;
  L.push(["im", "immune → lock-on +"+gain.toFixed(1)+"→"+nl.toFixed(1)+", damage −"+dmg.toFixed(1)+", fixation +"+fixG.toFixed(1)]);
  return [s, L];
}

export function mutationOfferTurn(turn){ return turn>0 && turn%5===0; }

export function applyMutation(mut, s, build){
  s = { ...s }; let b = build;
  if (mut.oneTime){
    if (mut.id==="latency") s.latency_turns = 2;
    if (mut.id==="drift") s.immune_lockon = Math.max(0, s.immune_lockon-30);
    if (mut.id==="purge"){ s.fixation = Math.max(0, (s.fixation||0)-15); s.host_stability -= 8; }
    if (mut.id==="bloom"){ s.colony_load *= 1.2; s.fixation = Math.min(100, (s.fixation||0)+6); }
  } else if (mut.apply){ b = mut.apply(build); }
  return { state:s, build:b };
}

export function evaluate(s){
  if (s.transmitted) return ["win","Transmitted","Your colony broke out to a new host before the immune system finished learning you."];
  if ((s.symbiosisStreak||0) >= 3) return ["win","Symbiosis","You stayed large, quiet and gentle long enough that the host's immune system accepted the colony as part of itself. A surgical, pacifist victory."];
  if (s.colony_load<=0) return ["loss","Cleared","The immune system locked on and wiped the colony. Too loud, too soon."];
  if (s.host_stability<=0) return ["loss","Host collapsed","You killed the host before transmitting. Virulence with no exit."];
  if ((s.fixation||0) >= 100 || s.turn >= MAX_TURNS) return ["loss","Cornered","Immune fixation reached 100% — the host's adaptive response fully mapped your colony and the defences closed in and cleared it before you broke out."];
  return null;
}
