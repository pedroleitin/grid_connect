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

/* Uniform-grid spatial hash of the pins (poles) so a joint only tests the pins
   near it instead of all of them. Cell size = the largest pole radius, so any
   pole that could contain a joint sits in the joint's own cell or an adjacent
   one — a 3x3 neighbourhood query finds every relevant pole. This makes
   collision O(joints) instead of O(joints * pins) without changing the result.
   Built once per frame; the hot loop in stepRope never allocates. */
export function buildPoleGrid(poles) {
  const n = poles.length;
  if (!n) return { empty: true, cell: 1, minX: 0, minY: 0, gcols: 0, grows: 0, cells: [] };
  let maxR = 1, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poles) {
    if (p.r > maxR) maxR = p.r;
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const cell = maxR;
  const gcols = Math.floor((maxX - minX) / cell) + 1;
  const grows = Math.floor((maxY - minY) / cell) + 1;
  const cells = new Array(gcols * grows);
  for (let i = 0; i < n; i++) {
    const p = poles[i];
    const cx = Math.floor((p.x - minX) / cell);
    const cy = Math.floor((p.y - minY) / cell);
    const idx = cy * gcols + cx;
    (cells[idx] || (cells[idx] = [])).push(p);
  }
  return { empty: false, cell, minX, minY, gcols, grows, cells };
}

/* Advance a rope's joints one frame: ring springs + pole collisions + bounds.
   `poleGrid` is the spatial hash from buildPoleGrid. Mutates the joints in
   place. Returns the max joint speed (for calm detection). */
export function stepRope(joints, poleGrid, cfg, bounds) {
  const n = joints.length;
  if (n < 2) return 0;
  const k = STIFFNESS;
  const square = cfg.shape === 'square';
  const g = poleGrid;
  const { cell, minX, minY, gcols, grows, cells } = g;
  const cr01 = (cfg.cornerRadius ?? 36) / 100;
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
    // integrate + collide with nearby poles (3x3 hash cells) + bounds
    for (const j of joints) {
      j.x += j.vx; j.y += j.vy;
      j.vx *= DAMPING; j.vy *= DAMPING;
      if (!g.empty) {
        const cx = Math.floor((j.x - minX) / cell);
        const cy = Math.floor((j.y - minY) / cell);
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          if (gy < 0 || gy >= grows) continue;
          for (let gx = cx - 1; gx <= cx + 1; gx++) {
            if (gx < 0 || gx >= gcols) continue;
            const bucket = cells[gy * gcols + gx];
            if (!bucket) continue;
            for (let pi = 0; pi < bucket.length; pi++) {
              const p = bucket[pi];
              const ox = j.x - p.x, oy = j.y - p.y;
              if (square) {
                // rounded-square pole: flat edges at ±r, corners rounded (matches
                // the guide's rect). Push any joint inside it out to the boundary.
                const bb = p.r, crr = p.r * cr01, B = p.r - crr;
                const ccx = Math.min(Math.max(ox, -B), B);
                const ccy = Math.min(Math.max(oy, -B), B);
                const vx = ox - ccx, vy = oy - ccy;
                const vlen = Math.hypot(vx, vy);
                if (vlen > 0.001) {
                  if (vlen < crr) {           // inside the rounded band -> push out radially
                    const nx = vx / vlen, ny = vy / vlen;
                    j.x = p.x + ccx + nx * crr; j.y = p.y + ccy + ny * crr;
                    const vn = j.vx * nx + j.vy * ny;
                    if (vn < 0) { j.vx -= nx * vn; j.vy -= ny * vn; }
                  }
                } else {                     // deep inside the core rect -> nearest edge
                  const dl = ox + B, dr = B - ox, dt = oy + B, dbm = B - oy;
                  const m = Math.min(dl, dr, dt, dbm);
                  let nx = 0, ny = 0;
                  if (m === dl) { nx = -1; j.x = p.x - bb; }
                  else if (m === dr) { nx = 1; j.x = p.x + bb; }
                  else if (m === dt) { ny = -1; j.y = p.y - bb; }
                  else { ny = 1; j.y = p.y + bb; }
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

/* Two cells are connectable only if they are immediate neighbors (8-way),
   never skipping a cell. */
export function adjacentCells(a, b) {
  const dr = Math.abs(a.r - b.r), dc = Math.abs(a.c - b.c);
  return dr <= 1 && dc <= 1 && !(dr === 0 && dc === 0);
}

/* External-tangent unit normal when going from circle A (center ca, radius ra)
   to circle B (cb, rb), on the given side (+1 = left, -1 = right). The tangent
   line touches A at ca + ra*u and B at cb + rb*u; u is that shared normal. */
function tangentNormal(ca, ra, cb, rb, side) {
  const dx = cb.x - ca.x, dy = cb.y - ca.y;
  const L = Math.hypot(dx, dy) || 1e-6;
  const d = { x: dx / L, y: dy / L };
  const n = { x: -d.y, y: d.x };            // left normal
  let a = (ra - rb) / L;
  a = Math.max(-1, Math.min(1, a));
  const b = Math.sqrt(Math.max(0, 1 - a * a)) * side;
  return { x: a * d.x + b * n.x, y: a * d.y + b * n.y };
}

/* Belt-around-pulleys outline for an ordered chain of pins (Select mode).
   Given ordered centers + radii it returns a dense closed loop [{x,y}] that
   threads every pin along the path (external tangents + arcs) with rounded end
   caps — like a taut rubber band around a sequence of pulleys. Used as the seed
   ring for the Select-mode shrink-wrap: the physics then settles it tightly
   around the chained pins (following the path's bends, resolving any crossings). */
export function selectBelt(centers, radii, arcStep = 0.3) {
  // drop consecutive coincident centers (keep the larger radius)
  const C = [], R = [];
  for (let i = 0; i < centers.length; i++) {
    const p = centers[i];
    if (C.length && Math.hypot(p.x - C[C.length - 1].x, p.y - C[C.length - 1].y) < 1e-6) {
      R[R.length - 1] = Math.max(R[R.length - 1], radii[i]); continue;
    }
    C.push(p); R.push(radii[i]);
  }
  const m = C.length;
  if (m === 0) return [];
  const circle = (c, r, n = 48) => {
    const out = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) }); }
    return out;
  };
  if (m === 1) return circle(C[0], R[0]);

  const uL = [], uR = [], dir = [];
  for (let s = 0; s < m - 1; s++) {
    uL.push(tangentNormal(C[s], R[s], C[s + 1], R[s + 1], +1));
    uR.push(tangentNormal(C[s], R[s], C[s + 1], R[s + 1], -1));
    const dx = C[s + 1].x - C[s].x, dy = C[s + 1].y - C[s].y, L = Math.hypot(dx, dy) || 1e-6;
    dir.push({ x: dx / L, y: dy / L });
  }
  const pts = [];
  const ang = (u) => Math.atan2(u.y, u.x);
  const push = (c, r, a) => pts.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  const arc = (c, r, a0, a1, ccw) => {
    let da = a1 - a0;
    if (ccw) { while (da < 0) da += Math.PI * 2; } else { while (da > 0) da -= Math.PI * 2; }
    const steps = Math.max(1, Math.ceil(Math.abs(da) / arcStep));
    for (let k = 0; k <= steps; k++) push(c, r, a0 + da * (k / steps));
  };
  // short-way arc between two normals (a convex outside join)
  const joinArc = (c, r, uIn, uOut) => {
    const a0 = ang(uIn), a1 = ang(uOut);
    let da = ((a1 - a0 + Math.PI) % (Math.PI * 2)) - Math.PI;
    arc(c, r, a0, a1, da >= 0);
  };
  // cap arc from uFrom to uTo passing through the `through` direction
  const capArc = (c, r, uFrom, uTo, through) => {
    const a0 = ang(uFrom), a1 = ang(uTo), at = ang(through);
    const covers = (ccw) => {
      let da = a1 - a0; if (ccw) { while (da < 0) da += Math.PI * 2; } else { while (da > 0) da -= Math.PI * 2; }
      let dt = at - a0; while (dt < 0) dt += Math.PI * 2; while (dt > Math.PI * 2) dt -= Math.PI * 2;
      return ccw ? dt <= da + 1e-6 : (dt - Math.PI * 2) >= da - 1e-6;
    };
    arc(c, r, a0, a1, covers(true));
  };

  // LEFT side, forward: touch at vertex 0, arcs at intermediate vertices, touch at last
  push(C[0], R[0], ang(uL[0]));
  for (let i = 1; i < m - 1; i++) joinArc(C[i], R[i], uL[i - 1], uL[i]);
  push(C[m - 1], R[m - 1], ang(uL[m - 2]));
  // end cap: around the far side of the last pin
  capArc(C[m - 1], R[m - 1], uL[m - 2], uR[m - 2], dir[m - 2]);
  // RIGHT side, backward
  for (let i = m - 2; i >= 1; i--) joinArc(C[i], R[i], uR[i], uR[i - 1]);
  push(C[0], R[0], ang(uR[0]));
  // start cap: around the near side of the first pin
  capArc(C[0], R[0], uR[0], uL[0], { x: -dir[0].x, y: -dir[0].y });
  return pts;
}

/* Clean SVG: one closed Catmull-Rom <path> per rope (filled or outlined),
   plus filled circles + metaball bridges for the painted blobs. */
export function buildSVG(ropes, paint, cfg, ink) {
  const { w, h } = canvasSize(cfg.cols, cfg.rows, cfg.gap);
  let body = '';
  for (const rope of ropes) {
    const J = rope.joints;
    if (!J || J.length < 3) continue;
    // compound path: outer ring + hole rings (fill-rule evenodd carves the holes)
    const holeRings = (rope.holeJoints || []).filter((h) => h && h.length >= 3);
    let d = splinePathD(J, true);
    for (const h of holeRings) d += ' ' + splinePathD(h, true);
    body += cfg.style === 'fill'
      ? `<path d="${d}" fill="${ink}" fill-rule="evenodd" stroke="${ink}" stroke-width="4" stroke-linejoin="round"/>`
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
