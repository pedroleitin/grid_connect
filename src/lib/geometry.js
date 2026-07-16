/* ============================================================
   Grid geometry + Catmull-Rom spline + SVG export.
   Shared between the canvas render (p5) and the export.
   ============================================================ */
export const PAD = 20;

/* Each pin has a fixed-size container (= the largest possible circle).
   The circle grows INSIDE its own container, so changing the circle size
   never moves neighbors nor resizes the canvas. Only the spacing (gap)
   changes the pitch between containers — and therefore the canvas size,
   so nothing gets clipped. Keep CELL in sync with the circle-size slider max. */
export const CELL = 200;

export function canvasSize(cols, rows, gap) {
  return {
    w: PAD * 2 + cols * CELL + (cols - 1) * gap,
    h: PAD * 2 + rows * CELL + (rows - 1) * gap,
  };
}

export function cellCenter(r, c, cfg) {
  const pitch = CELL + cfg.gap;
  return {
    x: PAD + CELL / 2 + c * pitch,
    y: PAD + CELL / 2 + r * pitch,
  };
}

/* pins (poles) = centers of all cells, each with its own radius (per-circle
   size override when present, otherwise the global cellSize) */
export function sizeOf(cfg, r, c) {
  const o = cfg.sizes && cfg.sizes.get(r + ',' + c);
  return o == null ? cfg.cellSize : o;
}

export function pins(cfg) {
  const list = [];
  const ig = cfg.ignored;
  for (let r = 0; r < cfg.rows; r++)
    for (let c = 0; c < cfg.cols; c++) {
      if (ig && ig.has(r + ',' + c)) continue;   // ignored pins don't interact
      const ct = cellCenter(r, c, cfg);
      list.push({ x: ct.x, y: ct.y, r: sizeOf(cfg, r, c) / 2 });
    }
  return list;
}

/* Catmull-Rom -> cubic Bézier segments */
export function splineSegments(pts, closed) {
  const n = pts.length;
  const get = (i) => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const segs = [];
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    segs.push({
      c1x: p1.x + (p2.x - p0.x) / 6, c1y: p1.y + (p2.y - p0.y) / 6,
      c2x: p2.x - (p3.x - p1.x) / 6, c2y: p2.y - (p3.y - p1.y) / 6,
      x: p2.x, y: p2.y,
    });
  }
  return { start: pts[0], segs };
}

const R2 = (n) => Math.round(n * 100) / 100;

/* ---- Physics rope (Rogo-style shrink-wrap) ----------------------------------
   The drawn loop becomes a closed ring of spring joints. The springs have a
   tiny rest length, so the ring wants to contract; the pins (poles) push any
   joint that enters them back out to their edge. The rope therefore snaps
   tightly around the circles it encloses, producing clean geometric shapes. */

export const REST_LENGTH = 3;   // spring rest length (px): tiny -> ring contracts
export const SUBSTEPS = 40;     // physics iterations per frame (higher = faster settle)
export const DAMPING = 0.9;     // velocity damping (settles the motion)
export const STIFFNESS = 0.12;  // fixed spring stiffness (fast, stable convergence)
export const CALM_SPEED = 0.05; // legacy default calm threshold (see calmFor)

/* Tension slider (100..200) -> settle tightness.
   The ring always converges to the tight wrap given enough time; tension controls
   HOW tight it is when the sim freezes. Higher tension = lower calm threshold = the
   sim keeps contracting longer = it hugs the circles more closely. Mapping is
   exponential so the high end reaches a near-perfect (sub-pixel) hug. */
export function calmFor(tension) {
  const u = Math.max(0, Math.min(1, (tension - 100) / 100));
  return 0.02 * Math.pow(0.0015 / 0.02, u);
}

/* Resample a drawn (open) polyline into joints spaced ~step px apart, so the
   ring is uniform regardless of how fast the user drew. Returns joint objects. */
export function seedJoints(points, step = 10) {
  if (points.length === 0) return [];
  const out = [{ x: points[0].x, y: points[0].y, vx: 0, vy: 0 }];
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    let a = points[i - 1], b = points[i];
    let seg = Math.hypot(b.x - a.x, b.y - a.y);
    while (acc + seg >= step) {
      const t = (step - acc) / seg;
      a = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      out.push({ x: a.x, y: a.y, vx: 0, vy: 0 });
      seg = Math.hypot(b.x - a.x, b.y - a.y);
      acc = 0;
    }
    acc += seg;
  }
  return out;
}

/* Advance a rope's joints one frame: ring springs + pole collisions + bounds.
   Mutates the joints in place. Returns the max joint speed (for calm detection). */
export function stepRope(joints, poles, cfg, bounds) {
  const n = joints.length;
  if (n < 2) return 0;
  const k = STIFFNESS;
  const square = cfg.shape === 'square';
  for (let s = 0; s < SUBSTEPS; s++) {
    // ring springs (closed loop: joint i <-> i+1)
    for (let i = 0; i < n; i++) {
      const a = joints[i], b = joints[(i + 1) % n];
      let dx = b.x - a.x, dy = b.y - a.y;
      let len = Math.hypot(dx, dy) || 0.0001;
      const f = (k * (len - REST_LENGTH)) / len;
      const fx = dx * f, fy = dy * f;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }
    // integrate + collide with poles + bounds
    for (const j of joints) {
      j.x += j.vx; j.y += j.vy;
      j.vx *= DAMPING; j.vy *= DAMPING;
      for (const p of poles) {
        const ox = j.x - p.x, oy = j.y - p.y;
        if (square) {
          // rounded-square pole: flat edges at ±r, corners rounded (matches the
          // guide's rect). Push any joint inside it out to the rounded boundary.
          const b = p.r, cr = p.r * ((cfg.cornerRadius ?? 36) / 100), B = p.r - cr;
          const cx = Math.min(Math.max(ox, -B), B);
          const cy = Math.min(Math.max(oy, -B), B);
          const vx = ox - cx, vy = oy - cy;
          const vlen = Math.hypot(vx, vy);
          if (vlen > 0.001) {
            if (vlen < cr) {           // inside the rounded band -> push out radially
              const nx = vx / vlen, ny = vy / vlen;
              j.x = p.x + cx + nx * cr; j.y = p.y + cy + ny * cr;
              const vn = j.vx * nx + j.vy * ny;
              if (vn < 0) { j.vx -= nx * vn; j.vy -= ny * vn; }
            }
          } else {                     // deep inside the core rect -> nearest edge
            const dl = ox + B, dr = B - ox, dt = oy + B, dbm = B - oy;
            const m = Math.min(dl, dr, dt, dbm);
            let nx = 0, ny = 0;
            if (m === dl) { nx = -1; j.x = p.x - b; }
            else if (m === dr) { nx = 1; j.x = p.x + b; }
            else if (m === dt) { ny = -1; j.y = p.y - b; }
            else { ny = 1; j.y = p.y + b; }
            const vn = j.vx * nx + j.vy * ny;
            if (vn < 0) { j.vx -= nx * vn; j.vy -= ny * vn; }
          }
        } else {
          const r = p.r;
          const d = Math.hypot(ox, oy);
          if (d < r && d > 0.001) {
            const scale = r / d;
            j.x = p.x + ox * scale; j.y = p.y + oy * scale;
            const nx = ox / d, ny = oy / d;
            const vn = j.vx * nx + j.vy * ny; // remove inward velocity (no bounce -> settles)
            if (vn < 0) { j.vx -= nx * vn; j.vy -= ny * vn; }
          }
        }
      }
      if (j.x < bounds.xMin) { j.x = bounds.xMin; j.vx *= -0.5; }
      else if (j.x > bounds.xMax) { j.x = bounds.xMax; j.vx *= -0.5; }
      if (j.y < bounds.yMin) { j.y = bounds.yMin; j.vy *= -0.5; }
      else if (j.y > bounds.yMax) { j.y = bounds.yMax; j.vy *= -0.5; }
    }
  }
  let vmax = 0;
  for (const j of joints) vmax = Math.max(vmax, Math.hypot(j.vx, j.vy));
  return vmax;
}

export function splinePathD(pts, closed) {
  if (pts.length < 2) return '';
  const { start, segs } = splineSegments(pts, closed);
  let d = `M ${R2(start.x)} ${R2(start.y)} `;
  for (const s of segs)
    d += `C ${R2(s.c1x)} ${R2(s.c1y)} ${R2(s.c2x)} ${R2(s.c2y)} ${R2(s.x)} ${R2(s.y)} `;
  if (closed) d += 'Z';
  return d.trim();
}

/* ---- Metaball connection (Paint mode) ---------------------------------------
   Smooth "blob" bridge between two circles built from cubic Béziers tangent to
   each circle. Ported from the paper.js Meta Balls example (SATO Hiroyuki).
   Returns the four contact points + Bézier handles, or null when no bridge
   should be drawn (one circle contains the other, or zero radius). */
export function metaball(c1, r1, c2, r2, v = 0.5, handleRate = 2.4) {
  const HALF_PI = Math.PI / 2;
  const dx = c2.x - c1.x, dy = c2.y - c1.y;
  const d = Math.hypot(dx, dy);
  if (r1 === 0 || r2 === 0 || d === 0 || d <= Math.abs(r1 - r2)) return null;

  let u1, u2;
  if (d < r1 + r2) {                       // circles overlap
    u1 = Math.acos((r1 * r1 + d * d - r2 * r2) / (2 * r1 * d));
    u2 = Math.acos((r2 * r2 + d * d - r1 * r1) / (2 * r2 * d));
  } else { u1 = 0; u2 = 0; }

  const angle1 = Math.atan2(dy, dx);
  const angle2 = Math.acos((r1 - r2) / d);
  const a1a = angle1 + u1 + (angle2 - u1) * v;
  const a1b = angle1 - u1 - (angle2 - u1) * v;
  const a2a = angle1 + Math.PI - u2 - (Math.PI - u2 - angle2) * v;
  const a2b = angle1 - Math.PI + u2 + (Math.PI - u2 - angle2) * v;

  const gv = (ang, len) => ({ x: Math.cos(ang) * len, y: Math.sin(ang) * len });
  const at = (c, ang, len) => ({ x: c.x + gv(ang, len).x, y: c.y + gv(ang, len).y });
  const p1a = at(c1, a1a, r1), p1b = at(c1, a1b, r1);
  const p2a = at(c2, a2a, r2), p2b = at(c2, a2b, r2);

  // handle length from the span between both ends of the bridge
  const total = r1 + r2;
  let d2 = Math.min(v * handleRate, Math.hypot(p1a.x - p2a.x, p1a.y - p2a.y) / total);
  d2 *= Math.min(1, (d * 2) / total);
  const h1 = r1 * d2, h2 = r2 * d2;

  return {
    p1a, p1b, p2a, p2b,
    ho0: at(p1a, a1a - HALF_PI, h1),   // handleOut of p1a
    hi1: at(p2a, a2a + HALF_PI, h2),   // handleIn  of p2a
    ho2: at(p2b, a2b - HALF_PI, h2),   // handleOut of p2b
    hi3: at(p1b, a1b + HALF_PI, h1),   // handleIn  of p1b
  };
}

/* SVG path for a metaball bridge (the flat ends sit inside the node circles) */
export function metaballPathD(m) {
  return `M ${R2(m.p1a.x)} ${R2(m.p1a.y)} `
    + `C ${R2(m.ho0.x)} ${R2(m.ho0.y)} ${R2(m.hi1.x)} ${R2(m.hi1.y)} ${R2(m.p2a.x)} ${R2(m.p2a.y)} `
    + `L ${R2(m.p2b.x)} ${R2(m.p2b.y)} `
    + `C ${R2(m.ho2.x)} ${R2(m.ho2.y)} ${R2(m.hi3.x)} ${R2(m.hi3.y)} ${R2(m.p1b.x)} ${R2(m.p1b.y)} Z`;
}

/* ---- Smooth (fused) connection ----------------------------------------------
   A bridge whose sides leave each node tangent to its actual boundary (circle
   OR rounded square), so the neck flows out along the shape's edge and the whole
   thing reads as one object. Returns the same shape as metaball() (four contact
   points + Bézier handles) so the renderer/export reuse the same drawing code. */

/* Exit point + unit tangent (CCW) of a ray from the node center at angle theta,
   for a circle (square=false) or a rounded square of half-size `half`. */
function nodeBoundary(cx, cy, half, square, cr01, theta) {
  const dx = Math.cos(theta), dy = Math.sin(theta);
  if (!square) {
    return { x: cx + dx * half, y: cy + dy * half, tx: -dy, ty: dx };
  }
  const h = half, cr = Math.max(0, Math.min(h, h * cr01)), inner = h - cr;
  let best = Infinity, px = dx * h, py = dy * h, nx = dx, ny = dy;
  if (Math.abs(dx) > 1e-9) {                       // vertical edges x = ±h
    for (const sx of [-1, 1]) {
      const t = (sx * h) / dx;
      if (t > 1e-9) {
        const y = t * dy;
        if (Math.abs(y) <= inner + 1e-9 && t < best) { best = t; px = sx * h; py = y; nx = sx; ny = 0; }
      }
    }
  }
  if (Math.abs(dy) > 1e-9) {                       // horizontal edges y = ±h
    for (const sy of [-1, 1]) {
      const t = (sy * h) / dy;
      if (t > 1e-9) {
        const x = t * dx;
        if (Math.abs(x) <= inner + 1e-9 && t < best) { best = t; px = x; py = sy * h; nx = 0; ny = sy; }
      }
    }
  }
  if (cr > 1e-9) {                                 // rounded corners
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const ox = sx * inner, oy = sy * inner;
      const b = dx * ox + dy * oy, c = ox * ox + oy * oy - cr * cr, disc = b * b - c;
      if (disc >= 0) {
        const t = b + Math.sqrt(disc);
        if (t > 1e-9 && t < best) {
          const x = t * dx, y = t * dy;
          if ((x - ox) * sx >= -1e-6 && (y - oy) * sy >= -1e-6) {
            best = t; px = x; py = y; nx = (x - ox) / cr; ny = (y - oy) / cr;
          }
        }
      }
    }
  }
  return { x: cx + px, y: cy + py, tx: -ny, ty: nx };
}

function neckDelta(v) {
  // neck half-angle: wider blob spread -> contacts further apart -> fatter neck
  return (Math.PI / 2) * (0.28 + 0.55 * v);
}

export function smoothBridge(c1, r1, c2, r2, cfg) {
  const square = cfg.shape === 'square';
  const cr01 = square ? (cfg.cornerRadius ?? 36) / 100 : 0;
  const v = (cfg.blob ?? 50) / 100;
  const dx = c2.x - c1.x, dy = c2.y - c1.y, d = Math.hypot(dx, dy);
  if (d === 0 || r1 === 0 || r2 === 0 || d <= Math.abs(r1 - r2)) return null;
  const phi = Math.atan2(dy, dx);
  const delta = neckDelta(v);
  const p1a = nodeBoundary(c1.x, c1.y, r1, square, cr01, phi + delta);
  const p1b = nodeBoundary(c1.x, c1.y, r1, square, cr01, phi - delta);
  const p2a = nodeBoundary(c2.x, c2.y, r2, square, cr01, phi + Math.PI - delta);
  const p2b = nodeBoundary(c2.x, c2.y, r2, square, cr01, phi + Math.PI + delta);
  const F = 0.55;   // handle length as a fraction of the side chord
  const handle = (pt, target) => {
    const len = F * Math.hypot(target.x - pt.x, target.y - pt.y);
    let hx = pt.tx, hy = pt.ty;
    if ((target.x - pt.x) * hx + (target.y - pt.y) * hy < 0) { hx = -hx; hy = -hy; }
    return { x: pt.x + hx * len, y: pt.y + hy * len };
  };
  return {
    p1a, p1b, p2a, p2b,
    ho0: handle(p1a, p2a), hi1: handle(p2a, p1a),
    ho2: handle(p2b, p1b), hi3: handle(p1b, p2b),
  };
}

/* Bridge chooser used by both the renderer and the SVG export. */
export function bridge(c1, r1, c2, r2, cfg) {
  return cfg.smoothJoins ? smoothBridge(c1, r1, c2, r2, cfg)
                         : metaball(c1, r1, c2, r2, (cfg.blob ?? 50) / 100);
}

/* Cubic Bézier point + tangent at parameter t. */
function cubicPt(P0, P1, P2, P3, t) {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
  return { x: a * P0.x + b * P1.x + c * P2.x + e * P3.x, y: a * P0.y + b * P1.y + c * P2.y + e * P3.y };
}
function cubicTan(P0, P1, P2, P3, t) {
  const u = 1 - t;
  const x = 3 * u * u * (P1.x - P0.x) + 6 * u * t * (P2.x - P1.x) + 3 * t * t * (P3.x - P2.x);
  const y = 3 * u * u * (P1.y - P0.y) + 6 * u * t * (P2.y - P1.y) + 3 * t * t * (P3.y - P2.y);
  const m = Math.hypot(x, y) || 1;
  return { x: x / m, y: y / m };
}

/* Approach A — vector junction fillets. Where 2+ connections share a pin, each
   pair of angularly-adjacent arms leaves a sharp concave notch between their
   facing edges. For every such notch we add a small closed patch that caps the
   valley: it is anchored on the pin boundary (apex) and blends tangent to both
   arms, rounding the notch into one smooth object. The patch is filled together
   with the bridges/nodes so the union stays seamless.
   Returns [{ apex, Ao, Bo, hA, hB }] — apex on the pin boundary, Ao/Bo points a
   little way out along each arm's facing edge, hA/hB the tangent Bézier handles. */
export function joinFillets(nodes, edges, cfg) {
  if (!nodes || !edges) return [];
  const amt = (cfg.joinAmt ?? 50) / 100;
  const TA = 0.04 + 0.18 * amt;   // how far out along each arm the fillet grabs
  const LK = 0.28 + 0.42 * amt;   // tangent handle length as a fraction of the chord
  const adj = new Map();   // "r,c" -> [{ key, ang }]
  for (const key of edges) {
    const [ka, kb] = key.split('|');
    const [ra, ca] = ka.split(',').map(Number);
    const [rb, cb] = kb.split(',').map(Number);
    const A = cellCenter(ra, ca, cfg), B = cellCenter(rb, cb, cfg);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka).push({ key: kb, ang: Math.atan2(B.y - A.y, B.x - A.x) });
    adj.get(kb).push({ key: ka, ang: Math.atan2(A.y - B.y, A.x - B.x) });
  }
  const out = [];
  for (const [key, arms] of adj) {
    if (arms.length < 2) continue;
    const [r, c] = key.split(',').map(Number);
    const C = cellCenter(r, c, cfg), radC = sizeOf(cfg, r, c) / 2;
    arms.sort((a, b) => a.ang - b.ang);
    const armCenter = (a) => {
      const [nr, nc] = a.key.split(',').map(Number);
      return { ct: cellCenter(nr, nc, cfg), rad: sizeOf(cfg, nr, nc) / 2 };
    };
    const nArms = arms.length;
    for (let i = 0; i < nArms; i++) {
      const a = arms[i], b = arms[(i + 1) % nArms];
      let gap = b.ang - a.ang; if (gap < 0) gap += Math.PI * 2;
      // only round a real inner corner: skip straight-through / reflex gaps, and
      // (for a lone pair) skip the wide "outer" gap that is not a notch
      if (gap >= Math.PI - 0.12) continue;
      if (nArms === 2 && i === 1) continue;   // a 2-arm pin has one notch, not two
      const na = armCenter(a), nb = armCenter(b);
      const mA = bridge(C, radC, na.ct, na.rad, cfg);
      const mB = bridge(C, radC, nb.ct, nb.rad, cfg);
      if (!mA || !mB) continue;
      // arm A's CCW-facing edge = side a (p1a -> ho0 -> hi1 -> p2a)
      const Ao = cubicPt(mA.p1a, mA.ho0, mA.hi1, mA.p2a, TA);
      let tA = cubicTan(mA.p1a, mA.ho0, mA.hi1, mA.p2a, TA);
      // arm B's CW-facing edge = side b read from the pin (p1b -> hi3 -> ho2 -> p2b)
      const Bo = cubicPt(mB.p1b, mB.hi3, mB.ho2, mB.p2b, TA);
      let tB = cubicTan(mB.p1b, mB.hi3, mB.ho2, mB.p2b, TA);
      // orient each tangent outward (away from the pin center)
      if (tA.x * (Ao.x - C.x) + tA.y * (Ao.y - C.y) < 0) { tA = { x: -tA.x, y: -tA.y }; }
      if (tB.x * (Bo.x - C.x) + tB.y * (Bo.y - C.y) < 0) { tB = { x: -tB.x, y: -tB.y }; }
      const mid = a.ang + gap / 2;
      // anchor a little inside the pin so the patch overlaps the disk (no sliver)
      const apex = { x: C.x + Math.cos(mid) * radC * 0.5, y: C.y + Math.sin(mid) * radC * 0.5 };
      const L = LK * Math.hypot(Bo.x - Ao.x, Bo.y - Ao.y);
      out.push({
        apex,
        Ao, Bo,
        hA: { x: Ao.x + tA.x * L, y: Ao.y + tA.y * L },
        hB: { x: Bo.x + tB.x * L, y: Bo.y + tB.y * L },
      });
    }
  }
  return out;
}

/* SVG path for a junction fillet patch (see joinFillets). */
export function filletPathD(f) {
  return `M ${R2(f.apex.x)} ${R2(f.apex.y)} L ${R2(f.Ao.x)} ${R2(f.Ao.y)} `
    + `C ${R2(f.hA.x)} ${R2(f.hA.y)} ${R2(f.hB.x)} ${R2(f.hB.y)} ${R2(f.Bo.x)} ${R2(f.Bo.y)} Z`;
}

/* Two cells are connectable only if they are immediate neighbors (8-way),
   never skipping a cell. */
export function adjacentCells(a, b) {
  const dr = Math.abs(a.r - b.r), dc = Math.abs(a.c - b.c);
  return dr <= 1 && dc <= 1 && !(dr === 0 && dc === 0);
}

/* Clean SVG: one closed Catmull-Rom <path> per rope (filled or outlined),
   plus filled circles + metaball bridges for the painted blobs. */
export function buildSVG(ropes, paint, cfg, ink) {
  const { w, h } = canvasSize(cfg.cols, cfg.rows, cfg.gap);
  let body = '';
  for (const rope of ropes) {
    const J = rope.joints;
    if (!J || J.length < 3) continue;
    const d = splinePathD(J, true);
    body += cfg.style === 'fill'
      ? `<path d="${d}" fill="${ink}" stroke="${ink}" stroke-width="4" stroke-linejoin="round"/>`
      : `<path d="${d}" fill="none" stroke="${ink}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  if (paint && paint.nodes && paint.nodes.size) {
    const square = cfg.shape === 'square';
    const cr01 = (cfg.cornerRadius ?? 36) / 100;
    for (const key of paint.edges) {
      const [ka, kb] = key.split('|');
      const [ra, ca] = ka.split(',').map(Number);
      const [rb, cb] = kb.split(',').map(Number);
      const m = bridge(cellCenter(ra, ca, cfg), sizeOf(cfg, ra, ca) / 2,
                       cellCenter(rb, cb, cfg), sizeOf(cfg, rb, cb) / 2, cfg);
      if (m) body += `<path d="${metaballPathD(m)}" fill="${ink}"/>`;
    }
    if (cfg.joinMode === 'fillet') {
      for (const f of joinFillets(paint.nodes, paint.edges, cfg)) {
        body += `<path d="${filletPathD(f)}" fill="${ink}"/>`;
      }
    }
    for (const key of paint.nodes) {
      const [r, c] = key.split(',').map(Number);
      const ct = cellCenter(r, c, cfg);
      const s = sizeOf(cfg, r, c);
      body += square
        ? `<rect x="${R2(ct.x - s / 2)}" y="${R2(ct.y - s / 2)}" width="${R2(s)}" height="${R2(s)}" rx="${R2((s / 2) * cr01)}" fill="${ink}"/>`
        : `<circle cx="${R2(ct.x)}" cy="${R2(ct.y)}" r="${R2(s / 2)}" fill="${ink}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${R2(w)}" height="${R2(h)}" viewBox="0 0 ${R2(w)} ${R2(h)}">\n${body}\n</svg>`;
}
