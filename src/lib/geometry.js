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

/* Clean SVG: one closed Catmull-Rom <path> per rope (filled or outlined) */
export function buildSVG(ropes, cfg, ink) {
  const { w, h } = canvasSize(cfg.cols, cfg.rows, cfg.gap);
  let body = '';
  for (const rope of ropes) {
    const J = rope.joints;
    if (!J || J.length < 3) continue;
    const d = splinePathD(J, true);
    body += cfg.style === 'fill'
      ? `<path d="${d}" fill="${ink}"/>`
      : `<path d="${d}" fill="none" stroke="${ink}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${R2(w)}" height="${R2(h)}" viewBox="0 0 ${R2(w)} ${R2(h)}">\n${body}\n</svg>`;
}
