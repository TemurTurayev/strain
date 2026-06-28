export const NODE_LAYOUT = {
  blood: { x: 0.5, y: 0.5 },
  gut:   { x: 0.2, y: 0.8 },
  lung:  { x: 0.2, y: 0.2 },
  lymph: { x: 0.8, y: 0.5 }
};

export let EDGES = [];
let EXITS = ['gut', 'lung'];
let W = 0, H = 0, dpr = 1;

export function initGraph(config) {
  if (config && config.EXITS) EXITS = config.EXITS;
  EDGES = [];
  if (config && config.ADJ) {
    const seen = new Set();
    for (const z of Object.keys(config.ADJ)) {
      for (const adj of config.ADJ[z]) {
        const id1 = z < adj ? z : adj;
        const id2 = z < adj ? adj : z;
        const key = `${id1}-${id2}`;
        if (!seen.has(key)) {
          seen.add(key);
          EDGES.push({ a: id1, b: id2 });
        }
      }
    }
  } else {
    // Default edges for 4-node if no ADJ
    EDGES = [
      { a: 'blood', b: 'gut' },
      { a: 'blood', b: 'lung' },
      { a: 'blood', b: 'lymph' }
    ];
  }
}

export function isExit(z) {
  return EXITS.includes(z);
}

export function fitToCanvas(canvas) {
  if (!canvas) return { W: 0, H: 0, dpr: 1 };
  dpr = Math.min(2, window.devicePixelRatio || 1);
  W = canvas.clientWidth || 800;
  H = canvas.clientHeight || 600;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  return { W, H, dpr };
}

export function zoneCenter(z) {
  const n = NODE_LAYOUT[z];
  if (!n) return { x: 0, y: 0 };
  return { x: n.x * W, y: n.y * H };
}

export function nodeAt(x, y) {
  for (const z of Object.keys(NODE_LAYOUT)) {
    const c = zoneCenter(z);
    const dx = c.x - x;
    const dy = c.y - y;
    if (Math.hypot(dx, dy) < 40) return z;
  }
  return null;
}
