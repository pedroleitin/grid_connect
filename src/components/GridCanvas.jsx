import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react'
import p5 from 'p5'
import {
  canvasSize, cellCenter, pins, buildPoleGrid, seedJoints, stepRope,
  splineSegments, buildSVG, calmFor, CELL, PAD, sizeOf,
  bridge, adjacentCells, selectBelt,
} from '../lib/geometry'

/* render a rope: closed Catmull-Rom spline through its physics joints */
function drawRope(g, joints, style, COL, alpha = 1, holes = null) {
  const n = joints.length
  if (n === 0) return
  const ink = g.color(COL.ink); ink.setAlpha(255 * alpha)
  if (n < 3) { g.fill(ink); g.noStroke(); g.circle(joints[0].x, joints[0].y, 8); return }
  const holeRings = (holes || []).filter((h) => h && h.length >= 3)
  if (holeRings.length) {
    // compound path (outer + holes) via the raw 2D context so we can fill
    // with the even-odd rule (carves the holes) — mirrors the SVG export.
    const ctx = g.drawingContext
    const addRing = (pts) => {
      const { start, segs } = splineSegments(pts, true)
      ctx.moveTo(start.x, start.y)
      for (const s of segs) ctx.bezierCurveTo(s.c1x, s.c1y, s.c2x, s.c2y, s.x, s.y)
      ctx.closePath()
    }
    ctx.save()
    ctx.beginPath()
    addRing(joints)
    for (const h of holeRings) addRing(h)
    const css = ink.toString()
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'
    if (style === 'fill') {
      ctx.fillStyle = css; ctx.fill('evenodd')
      ctx.strokeStyle = css; ctx.lineWidth = 4; ctx.stroke()
    } else {
      ctx.strokeStyle = css; ctx.lineWidth = 5; ctx.stroke()
    }
    ctx.restore()
    return
  }
  if (style === 'fill') { g.fill(ink); g.stroke(ink); g.strokeWeight(4); g.strokeJoin(g.ROUND) }
  else { g.noFill(); g.stroke(ink); g.strokeWeight(5); g.strokeJoin(g.ROUND); g.strokeCap(g.ROUND) }
  const { start, segs } = splineSegments(joints, true)
  g.beginShape(); g.vertex(start.x, start.y)
  for (const s of segs) g.bezierVertex(s.c1x, s.c1y, s.c2x, s.c2y, s.x, s.y)
  g.endShape(g.CLOSE)
}

/* render painted blobs: filled node circles + metaball bezier bridges (same
   solid fill, so overlaps read as one connected shape) */
function drawPaint(g, nodes, edges, cfg, COL, alpha = 1) {
  if (!nodes || nodes.size === 0) return
  const ink = g.color(COL.ink); ink.setAlpha(255 * alpha)
  g.noStroke()
  g.fill(ink)
  for (const key of edges) {
    const [ka, kb] = key.split('|')
    const [ra, ca] = ka.split(',').map(Number)
    const [rb, cb] = kb.split(',').map(Number)
    const m = bridge(cellCenter(ra, ca, cfg), sizeOf(cfg, ra, ca) / 2,
                     cellCenter(rb, cb, cfg), sizeOf(cfg, rb, cb) / 2, cfg)
    if (!m) continue
    g.beginShape()
    g.vertex(m.p1a.x, m.p1a.y)
    g.bezierVertex(m.ho0.x, m.ho0.y, m.hi1.x, m.hi1.y, m.p2a.x, m.p2a.y)
    g.vertex(m.p2b.x, m.p2b.y)
    g.bezierVertex(m.ho2.x, m.ho2.y, m.hi3.x, m.hi3.y, m.p1b.x, m.p1b.y)
    g.endShape(g.CLOSE)
  }
  g.fill(ink)
  for (const key of nodes) {
    const [r, c] = key.split(',').map(Number)
    const ct = cellCenter(r, c, cfg)
    const s = sizeOf(cfg, r, c)
    if (cfg.shape === 'square') {
      const cr01 = (cfg.cornerRadius ?? 36) / 100
      g.rect(ct.x - s / 2, ct.y - s / 2, s, s, (s / 2) * cr01)
    } else {
      g.circle(ct.x, ct.y, s)
    }
  }
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function readColors() {
  const cs = getComputedStyle(document.documentElement)
  return {
    ink: cs.getPropertyValue('--c-ink').trim() || '#111110',
    empty: cs.getPropertyValue('--c-empty').trim() || '#d7d2c7',
    accent: 'rgba(255,200,0,0.9)',
    danger: '#e0533f',
  }
}

const MIN_SCALE = 0.2
const MAX_SCALE = 5
const clampScale = (s) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s))
const MIN_DIAM = 8            // per-circle size limits
const EDIT_HANDLE_MAX = 40    // only show draggable vertex handles for loops up to this many points

// canonical key for an undirected paint link between two cells
const edgeKey = (a, b) => {
  const ka = a.r + ',' + a.c, kb = b.r + ',' + b.c
  return ka < kb ? ka + '|' + kb : kb + '|' + ka
}

// random pleasant color (fixed sat/lightness, random hue) as a hex string
// smoothstep easing for animation progress (0..1)
const easeInOut = (t) => t * t * (3 - 2 * t)
// ease-out cubic: fast start, gentle deceleration (used for the dock zoom)
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)

const GridCanvas = forwardRef(function GridCanvas({ cols, rows, cellSize, gap, shape, tension, style, cornerRadius, mode, blob, drawTool, smoothJoins, hideGuides, editMode, symmetry = 'off', theme, leftInset = 0, bottomInset = 0 }, ref) {
  const holderRef = useRef(null)   // p5 host container (pans/zooms)
  const bgRef = useRef(null)       // full-page dotted background (single seamless layer)
  const insetRef = useRef(leftInset) // left area hidden by the sidebar (for centering)
  const bottomInsetRef = useRef(bottomInset) // bottom area hidden by the history dock
  const hostRef = useRef(null)     // p5 canvas mounts here
  const p5Ref = useRef(null)
  const sizesRef = useRef(new Map())  // per-cell diameter overrides: "r,c" -> px
  const ignoredRef = useRef(new Set())  // ignored cells ("r,c"): no drawing interaction
  const cfgRef = useRef({ cols, rows, cellSize, gap, shape, tension, style, cornerRadius, blob, hideGuides, sizes: sizesRef.current, ignored: ignoredRef.current })
  const ropesRef = useRef([])       // physics ropes: { loop, joints }
  const paintNodesRef = useRef(new Set())  // painted cells "r,c" (base)
  const paintEdgesRef = useRef(new Set())  // painted links: sorted "ka|kb" (base)
  const paintMirNodesRef = useRef(new Set()) // derived symmetry mirror nodes
  const paintMirEdgesRef = useRef(new Set()) // derived symmetry mirror edges
  const paintDragRef = useRef(null)        // in-progress paint drag state
  const histRef = useRef([])        // unified undo stack: { kind, ... }
  const redoRef = useRef([])        // undone actions, for redo
  const curRef = useRef(null)       // raw stroke points (world coords) while drawing
  const simRef = useRef({ active: false })
  const modeRef = useRef(mode)      // 'draw' | 'paint' mirror for the p5 loop
  const drawToolRef = useRef(drawTool)  // 'free' | 'points' mirror for the p5 loop
  const polyRef = useRef(null)      // polygon vertices (world coords) while building, or null
  const polyCursorRef = useRef(null)   // live cursor (world) for the rubber-band segment
  const polyClosedAtRef = useRef(0)    // timestamp guard so a closing double-click won't reopen
  const selectChainRef = useRef(null)  // Select mode: ordered pins [{r,c}] being chained, or null
  const selectPreviewRef = useRef(null) // Select mode: live physics rope for the chain preview
  const lastSelDownRef = useRef(null)  // { key, t } guard so a commit double-click won't re-add
  const styleAnimRef = useRef({ from: style, t: 1 })  // crossfade between styles
  const styleCurRef = useRef(style)
  const lastGapRef = useRef(gap)
  const lastSizeRef = useRef(cellSize)
  const lastColsRef = useRef(cols)
  const lastRowsRef = useRef(rows)
  const lastSymRef = useRef(symmetry)
  const colRef = useRef({})
  const guideRef = useRef(1)  // animated pin opacity: eases to 0 when guides hidden
  const editModeRef = useRef(editMode)   // mirror for the p5 loop
  const hoverPinRef = useRef(null)        // { r, c } under the cursor in edit mode
  const hoverAnimRef = useRef(new Map())  // per-pin hover ease: "r,c" -> 0..1
  const dragPinRef = useRef(null)         // { r, c } being resized
  const paintHoverRef = useRef(null)      // { r, c } under the cursor in paint mode
  const paintSelRef = useRef(null)        // { r, c } armed pin for click-to-click connect
  const paintAnimRef = useRef(new Map())  // per-pin paint hover/select ease: "r,c" -> 0..1
  const editRopeRef = useRef(null)        // selected rope for reshaping (edit mode)
  const editDragRef = useRef(null)        // active edit drag: { kind:'move'|'vertex', rope, ... }
  const editHoverRef = useRef(false)      // cursor is over a selected rope/handle (edit mode)
  const editShiftRef = useRef(null)       // Shift+edit target: { kind:'add'|'remove', rope, ... }

  // view transform: world -> screen is  screen = world * scale + (tx, ty)
  const viewRef = useRef({ scale: 1, tx: 0, ty: 0 })
  const viewAnimRef = useRef(null)  // active view tween: { from, to, start, dur }
  const touchedRef = useRef(false)  // user panned/zoomed manually -> stop auto-fitting
  const ctrlRef = useRef(null)      // zoom controls exposed to the overlay buttons
  const panToolRef = useRef(false)  // hand tool: left-drag pans instead of drawing
  const [zoomPct, setZoomPct] = useState(100)
  const [panTool, setPanTool] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const wake = () => { simRef.current.active = true }

  const refreshHist = () => {
    setCanUndo(histRef.current.length > 0)
    setCanRedo(redoRef.current.length > 0)
  }

  // apply an action's removal (undo) or re-addition (redo)
  const applyAction = (act, add) => {
    if (act.kind === 'rope') {
      if (add) ropesRef.current.push(act.rope)
      else ropesRef.current = ropesRef.current.filter((r) => r !== act.rope)
    } else if (act.kind === 'paint') {
      // inverse actions (a removal) re-add on undo and delete on redo
      const put = act.inverse ? !add : add
      for (const k of act.nodes) put ? paintNodesRef.current.add(k) : paintNodesRef.current.delete(k)
      for (const k of act.edges) put ? paintEdgesRef.current.add(k) : paintEdgesRef.current.delete(k)
    } else if (act.kind === 'edit') {
      // restore the rope's loop (undo -> before, redo -> after) and re-seed it
      act.rope.loop = (add ? act.after : act.before).map((g) => ({ ...g }))
      const holes = add ? act.holesAfter : act.holesBefore
      if (holes !== undefined) act.rope.holes = holes ? holes.map((hl) => hl.map((g) => ({ ...g }))) : null
      reseedRope(act.rope, cfgRef.current)
    } else if (act.kind === 'hole') {
      // add a drawn hole to a rope (redo) / remove it (undo), then re-seed
      if (add) act.rope.holes = [...(act.rope.holes || []), act.hole]
      else act.rope.holes = (act.rope.holes || []).filter((h) => h !== act.hole)
      reseedRope(act.rope, cfgRef.current)
    } else if (act.kind === 'edit-chain') {
      // restore a Select rope's pin chain (undo -> before, redo -> after)
      act.rope.chain = (add ? act.after : act.before).map((k) => ({ r: k.r, c: k.c }))
      reseedRope(act.rope, cfgRef.current)
    }
  }

  const doUndo = () => {
    const act = histRef.current.pop()
    if (!act) return
    applyAction(act, false)
    redoRef.current.push(act)
    rebuildMirrors(cfgRef.current)
    wake(); refreshHist()
  }
  const doRedo = () => {
    const act = redoRef.current.pop()
    if (!act) return
    applyAction(act, true)
    histRef.current.push(act)
    rebuildMirrors(cfgRef.current)
    wake(); refreshHist()
  }

  const reseedRope = (rope, cfg) => {
    if (rope.select && rope.chain) {
      // Select mode: seed a ring around the ordered chain of pins, then let the
      // same shrink-wrap physics as Draw pull it tight around them.
      const centers = rope.chain.map((k) => cellCenter(k.r, k.c, cfg))
      const radii = rope.chain.map((k) => sizeOf(cfg, k.r, k.c) / 2)
      rope.joints = seedJoints(selectBelt(centers, radii), 10)
      return
    }
    if (!rope.loop) return
    const O = PAD + CELL / 2, pitch = CELL + cfg.gap
    const pts = rope.loop.map((g) => ({ x: O + g.gx * pitch, y: O + g.gy * pitch }))
    rope.joints = seedJoints(pts, 10)
    // hole rings (P2.0 spike): seed a contracting ring per hole loop
    if (rope.holes && rope.holes.length) {
      rope.holeJoints = rope.holes.map((hl) =>
        seedJoints(hl.map((g) => ({ x: O + g.gx * pitch, y: O + g.gy * pitch })), 10))
    } else {
      rope.holeJoints = null
    }
  }

  const reseed = (cfg) => {
    for (const rope of ropesRef.current) reseedRope(rope, cfg)
  }

  // Reflectors in loop (grid-index) space: gx maps to a column, gy to a row, so a
  // mirror is just index c -> (cols-1)-c / r -> (rows-1)-r. H mirrors left↔right,
  // V top↔bottom, Radial both (4-fold).
  const loopReflectors = (sym, cols, rows) => {
    if (!sym || sym === 'off') return []
    const fs = []
    if (sym === 'h' || sym === 'radial') fs.push((g) => ({ gx: (cols - 1) - g.gx, gy: g.gy }))
    if (sym === 'v' || sym === 'radial') fs.push((g) => ({ gx: g.gx, gy: (rows - 1) - g.gy }))
    if (sym === 'radial') fs.push((g) => ({ gx: (cols - 1) - g.gx, gy: (rows - 1) - g.gy }))
    return fs
  }

  // Cell reflectors in (r,c) space for the painted graph. Mirror a cell across the
  // grid's center axes; H mirrors columns, V rows, Radial both (4-fold).
  const cellReflectors = (sym, cols, rows) => {
    if (!sym || sym === 'off') return []
    const fs = []
    if (sym === 'h' || sym === 'radial') fs.push((r, c) => [r, (cols - 1) - c])
    if (sym === 'v' || sym === 'radial') fs.push((r, c) => [(rows - 1) - r, c])
    if (sym === 'radial') fs.push((r, c) => [(rows - 1) - r, (cols - 1) - c])
    return fs
  }

  // Symmetry as a live derived layer. Draw: the user's drawn/randomized ropes are
  // the base (no `derived` flag); mirror copies are rebuilt from them. Paint: the
  // base node/edge sets are mirrored into separate derived sets. Called whenever the
  // base set or the symmetry/grid changes, so toggling symmetry re-mirrors what's on
  // screen. Draw mirror ropes are real ropes (they shrink-wrap their own pins).
  const rebuildMirrors = (cfg) => {
    ropesRef.current = ropesRef.current.filter((r) => !r.derived)
    // paint mirrors
    const mn = new Set(), me = new Set()
    const cfs = cellReflectors(cfg.sym, cfg.cols, cfg.rows)
    if (cfs.length) {
      const ig = ignoredRef.current
      const R = cfg.rows, C = cfg.cols
      const valid = (r, c) => r >= 0 && r < R && c >= 0 && c < C && !ig.has(r + ',' + c)
      for (const f of cfs) {
        for (const k of paintNodesRef.current) {
          const [r, c] = k.split(',').map(Number)
          const [nr, nc] = f(r, c)
          if (valid(nr, nc)) { const nk = nr + ',' + nc; if (!paintNodesRef.current.has(nk)) mn.add(nk) }
        }
        for (const e of paintEdgesRef.current) {
          const [ka, kb] = e.split('|')
          const [ra, ca] = ka.split(',').map(Number)
          const [rb, cb] = kb.split(',').map(Number)
          const [na, ma] = f(ra, ca), [nb, mb] = f(rb, cb)
          if (valid(na, ma) && valid(nb, mb)) {
            const ek = edgeKey({ r: na, c: ma }, { r: nb, c: mb })
            if (!paintEdgesRef.current.has(ek)) me.add(ek)
          }
        }
      }
    }
    paintMirNodesRef.current = mn
    paintMirEdgesRef.current = me
    // draw mirrors
    const fs = loopReflectors(cfg.sym, cfg.cols, cfg.rows)
    if (!fs.length) { wake(); return }
    const base = ropesRef.current.slice()
    for (const rope of base) {
      if (rope.select && rope.chain) {
        // mirror the chain cells (same reflector order as the draw loop reflectors)
        for (const cf of cfs) {
          const chain = rope.chain.map(({ r, c }) => { const [nr, nc] = cf(r, c); return { r: nr, c: nc } })
          const m = { chain, select: true, derived: true }
          reseedRope(m, cfg)
          if (m.joints && m.joints.length >= 2) ropesRef.current.push(m)
        }
        continue
      }
      if (!rope.loop) continue
      for (const f of fs) {
        const m = { loop: rope.loop.map((g) => f(g)), derived: true }
        reseedRope(m, cfg)
        if (m.joints && m.joints.length >= 2) ropesRef.current.push(m)
      }
    }
    wake()
  }

  // Build a random drawing across the pins. `fill` (0..100) controls how much of
  // the grid is covered. `opts.single` makes it one connected element (fill drives
  // its size) instead of several; `opts.complexity` (0..100) tunes each shape from
  // compact/round (low) to irregular/branchy (high). In Draw mode each cluster of
  // cells becomes a shrink-wrap rope; in Paint mode clusters become connected
  // node/edge blobs. Replaces the current drawing.
  const randomize = (fill, opts = {}) => {
    const { single = false, channels = 50, sinuosity = 50, sym = 'off', diagonals = true, points = 5 } = opts
    const seed = (opts.seed == null ? (Math.random() * 2 ** 32) : opts.seed) >>> 0
    // seeded PRNG (mulberry32) so a given seed reproduces the same drawing
    const rng = ((a) => () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    })(seed)
    const cfg = cfgRef.current
    cfg.sym = sym
    const rows = cfg.rows, cols = cfg.cols
    const ig = ignoredRef.current
    const cells = []
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        if (!ig.has(r + ',' + c)) cells.push(r + ',' + c)
    if (!cells.length) return

    const f = Math.max(0, Math.min(1, (fill || 0) / 100))
    const total = cells.length
    const target = Math.max(1, Math.round(f * total))
    // cap a single element to a fraction of the grid so high fill yields several
    const cap = Math.max(1, Math.round(total * 0.35))
    const ch = Math.max(0, Math.min(1, (channels || 0) / 100))    // corridor density/amount
    const sin = Math.max(0, Math.min(1, (sinuosity || 0) / 100))  // corridor tortuosity

    const avail = new Set(cells)
    const key = (r, c) => r + ',' + c
    const parse = (k) => { const i = k.indexOf(','); return { r: +k.slice(0, i), c: +k.slice(i + 1) } }
    const pick = (set) => { const a = [...set]; return a[(rng() * a.length) | 0] }

    // grow a contiguous cluster from a seed up to `size` cells. Channels drives
    // branchiness: low → compact round blob (frontier nearest the centroid);
    // high → grows arms/lobes outward (frontier farthest from the centroid), which
    // the shrink-wrap renders as concave, complex shapes. Sinuosity jitters the
    // outward pick so arms wander/wind rather than shoot straight out.
    const grow = (seed, size, diag) => {
      const cluster = new Set([seed])
      const frontier = []
      const pushN = (k) => {
        const { r, c } = parse(k)
        const nb = diag
          ? [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1], [r - 1, c - 1], [r - 1, c + 1], [r + 1, c - 1], [r + 1, c + 1]]
          : [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
        for (const [nr, nc] of nb) {
          const nk = key(nr, nc)
          if (avail.has(nk) && !cluster.has(nk) && !frontier.includes(nk)) frontier.push(nk)
        }
      }
      pushN(seed)
      const s = parse(seed); let sumR = s.r, sumC = s.c, n = 1
      while (cluster.size < size && frontier.length) {
        const cr = sumR / n, cc = sumC / n
        let best = 0
        if (rng() < ch) {                                    // branch outward → arms/lobes
          let bd = -Infinity
          for (let i = 0; i < frontier.length; i++) {
            const { r, c } = parse(frontier[i])
            const d = (r - cr) ** 2 + (c - cc) ** 2
            const jitter = 1 + (rng() - 0.5) * 2 * sin       // sinuosity → wandering arms
            const sc = d * jitter
            if (sc > bd) { bd = sc; best = i }
          }
        } else {                                             // compact → round base mass
          let bd = Infinity
          for (let i = 0; i < frontier.length; i++) {
            const { r, c } = parse(frontier[i])
            const d = (r - cr) ** 2 + (c - cc) ** 2
            if (d < bd) { bd = d; best = i }
          }
        }
        const k = frontier.splice(best, 1)[0]
        cluster.add(k); pushN(k)
        const pk = parse(k); sumR += pk.r; sumC += pk.c; n++
      }
      return cluster
    }

    // partition the target coverage into one (single) or several contiguous clusters
    const makeClusters = (diag) => {
      const list = []
      if (single) {
        const cluster = grow(pick(avail), Math.min(target, total), diag)
        for (const k of cluster) avail.delete(k)
        list.push(cluster)
      } else {
        // best-candidate ("blue-noise") seeding: sample a few free cells and keep the
        // one farthest from the seeds already placed, so separate shapes spread apart
        // instead of clumping. Size mixture: the first cluster is a large "hero", the
        // rest are smaller "satellites".
        const seeds = []
        const pickSpread = () => {
          const arr = [...avail]
          if (!arr.length) return null
          if (!seeds.length) return arr[(rng() * arr.length) | 0]
          const samples = Math.min(arr.length, 8)
          let best = null, bestD = -Infinity
          for (let i = 0; i < samples; i++) {
            const cand = arr[(rng() * arr.length) | 0]
            const { r, c } = parse(cand)
            let md = Infinity
            for (const s of seeds) { const p = parse(s); const d = (r - p.r) ** 2 + (c - p.c) ** 2; if (d < md) md = d }
            if (md > bestD) { bestD = md; best = cand }
          }
          return best
        }
        let remaining = target, hero = true
        while (remaining > 0 && avail.size) {
          const s = pickSpread()
          if (s == null) break
          seeds.push(s)
          const size = hero
            ? Math.max(1, Math.min(remaining, Math.round(cap * (0.7 + 0.3 * rng()))))   // hero
            : 1 + ((rng() * Math.max(1, Math.min(remaining, cap) * 0.4)) | 0)            // satellite
          hero = false
          const cluster = grow(s, size, diag)
          for (const k of cluster) avail.delete(k)
          remaining -= cluster.size
          list.push(cluster)
        }
      }
      return list
    }

    if (modeRef.current === 'select') {
      // Select mode: scatter spread-out pins and connect them into ordered
      // chain(s) that shrink-wrap into a belt. `points` sets how many pins per
      // shape; `sinuosity` makes the connecting path wander vs run nearest-first;
      // `single` makes one shape, else several small ones spread across the grid.
      const pool = new Set(cells)
      // pick `count` spread-apart cells (best-candidate / blue-noise sampling)
      const pickPoints = (count) => {
        const chosen = []
        const arr0 = [...pool]
        if (!arr0.length) return chosen
        let first = arr0[(rng() * arr0.length) | 0]
        chosen.push(first); pool.delete(first)
        while (chosen.length < count && pool.size) {
          const arr = [...pool]
          const samples = Math.min(arr.length, 10)
          let best = null, bestD = -Infinity
          for (let i = 0; i < samples; i++) {
            const cand = arr[(rng() * arr.length) | 0]
            const { r, c } = parse(cand)
            let md = Infinity
            for (const s of chosen) { const p = parse(s); const d = (r - p.r) ** 2 + (c - p.c) ** 2; if (d < md) md = d }
            if (md > bestD) { bestD = md; best = cand }
          }
          chosen.push(best); pool.delete(best)
        }
        return chosen
      }
      // order the chosen cells into a path: nearest-neighbour when sinuosity is
      // low (clean, compact belt), jittered so it wanders when sinuosity is high
      const orderChain = (cellsK) => {
        const pts = cellsK.map(parse)
        if (pts.length <= 2) return pts
        const used = new Array(pts.length).fill(false)
        let cur = (rng() * pts.length) | 0
        used[cur] = true
        const order = [pts[cur]]
        for (let step = 1; step < pts.length; step++) {
          let best = -1, bestD = Infinity
          for (let i = 0; i < pts.length; i++) {
            if (used[i]) continue
            const d = (pts[i].r - pts[cur].r) ** 2 + (pts[i].c - pts[cur].c) ** 2
            const j = 1 + (rng() - 0.5) * 2 * sin * 3   // sinuosity → wandering order
            const sc = d * j
            if (sc < bestD) { bestD = sc; best = i }
          }
          used[best] = true; order.push(pts[best]); cur = best
        }
        return order
      }
      const ropes = []
      const emitChain = (chain) => {
        if (!chain.length) return
        const rope = { select: true, chain: chain.map((k) => ({ r: k.r, c: k.c })) }
        reseedRope(rope, cfg)
        if (rope.joints && rope.joints.length >= 2) ropes.push(rope)
      }
      const nWanted = Math.max(1, Math.min(total, points))
      if (single) {
        emitChain(orderChain(pickPoints(nWanted)))
      } else {
        // several shapes, each a handful of pins, until we've placed ~target pins
        const budget = Math.max(nWanted, target)
        let placed = 0
        while (placed < budget && pool.size) {
          const per = Math.max(2, Math.min(pool.size, nWanted))
          const picked = pickPoints(per)
          if (!picked.length) break
          emitChain(orderChain(picked))
          placed += picked.length
        }
      }
      ropesRef.current = ropes
      paintNodesRef.current.clear(); paintEdgesRef.current.clear()
    } else if (modeRef.current === 'paint') {
      const nodes = new Set(), edges = new Set()
      // adjacency for links: 8-way when diagonals on, else 4-way (H/V only)
      const linked = (a, b) => {
        const dr = Math.abs(a.r - b.r), dc = Math.abs(a.c - b.c)
        return diagonals ? adjacentCells(a, b) : (dr + dc === 1)
      }
      // Build a rich connection graph over a contiguous cluster: a spanning tree
      // grown DFS-style (serpentine chains) when sinuosity is high or BFS-style
      // (compact hubs) when low, then a fraction (channels) of the remaining
      // adjacent pairs added as extra edges to form cycles/loops.
      const buildGraph = (cluster) => {
        const arr = [...cluster]
        for (const k of arr) nodes.add(k)
        if (arr.length <= 1) return
        const adj = new Map(arr.map((k) => [k, []]))
        const pairs = []
        for (let i = 0; i < arr.length; i++)
          for (let j = i + 1; j < arr.length; j++)
            if (linked(parse(arr[i]), parse(arr[j]))) {
              adj.get(arr[i]).push(arr[j]); adj.get(arr[j]).push(arr[i]); pairs.push([arr[i], arr[j]])
            }
        const tree = new Set(), inTree = new Set([arr[0]]), stack = [arr[0]]
        while (inTree.size < arr.length && stack.length) {
          const idx = rng() < sin ? stack.length - 1 : 0   // DFS (chain) vs BFS (hub)
          const cur = stack[idx]
          const free = adj.get(cur).filter((n) => !inTree.has(n))
          if (!free.length) { stack.splice(idx, 1); continue }
          const nxt = free[(rng() * free.length) | 0]
          inTree.add(nxt); tree.add(edgeKey(parse(cur), parse(nxt))); stack.push(nxt)
        }
        for (const e of tree) edges.add(e)
        const extra = pairs
          .map(([a, b]) => edgeKey(parse(a), parse(b)))
          .filter((e) => !tree.has(e))
        for (let i = extra.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0;[extra[i], extra[j]] = [extra[j], extra[i]] }
        const nAdd = Math.round(extra.length * ch)   // channels → cycle density
        for (let i = 0; i < nAdd; i++) edges.add(extra[i])
      }
      for (const cluster of makeClusters(diagonals)) buildGraph(cluster)   // grow to match link adjacency
      // symmetry is applied live by rebuildMirrors (below), so no baking here
      paintNodesRef.current = nodes
      paintEdgesRef.current = edges
      ropesRef.current = []
    } else {
      // fill any enclosed empty cells so a cluster outlines as one solid shape
      const fillHoles = (cluster) => {
        let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity
        for (const k of cluster) { const { r, c } = parse(k); if (r < minR) minR = r; if (r > maxR) maxR = r; if (c < minC) minC = c; if (c > maxC) maxC = c }
        const within = (r, c) => r >= minR - 1 && r <= maxR + 1 && c >= minC - 1 && c <= maxC + 1
        const outside = new Set(), stack = [key(minR - 1, minC - 1)]
        outside.add(stack[0])
        while (stack.length) {
          const { r, c } = parse(stack.pop())
          for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
            const nk = key(nr, nc)
            if (within(nr, nc) && !outside.has(nk) && !cluster.has(nk)) { outside.add(nk); stack.push(nk) }
          }
        }
        for (let r = minR; r <= maxR; r++)
          for (let c = minC; c <= maxC; c++) { const k = key(r, c); if (!cluster.has(k) && !outside.has(k)) cluster.add(k) }
      }
      // Fill diagonal-only pinches (checkerboard corners) so branchy clusters
      // outline as a single clean loop. Without this the shrink-wrap tears the
      // cluster apart at the 1-point junctions where two arms touch only at a corner.
      const dePinch = (cluster) => {
        let changed = true, guard = 0
        while (changed && guard++ < 400) {
          changed = false
          for (const k of [...cluster]) {
            const { r, c } = parse(k)
            if (cluster.has(key(r + 1, c + 1)) && !cluster.has(key(r, c + 1)) && !cluster.has(key(r + 1, c))) {
              cluster.add(key(r, c + 1)); changed = true
            } else if (cluster.has(key(r + 1, c - 1)) && !cluster.has(key(r, c - 1)) && !cluster.has(key(r + 1, c))) {
              cluster.add(key(r + 1, c)); changed = true
            }
          }
        }
      }
      // Carve winding corridors (open notches) into a solid cluster to raise its
      // visual complexity. Removes cells along random inward walks while keeping the
      // solid connected and 2-manifold (no holes, no diagonal pinches) so its outline
      // stays a single loop. `budget` cells are removed at most.
      const solid = (cl, r, c) => cl.has(key(r, c))
      // a removed cell must not leave a diagonal-only touch at any of its 4 corners
      const wouldPinch = (cl, cell) => {
        const { r, c } = parse(cell)
        const at = (rr, cc) => (rr === r && cc === c ? false : solid(cl, rr, cc)) // cell treated as empty
        const blocks = [
          [[r - 1, c - 1], [r - 1, c], [r, c - 1], [r, c]],   // TL vertex
          [[r - 1, c], [r - 1, c + 1], [r, c], [r, c + 1]],   // TR vertex
          [[r, c - 1], [r, c], [r + 1, c - 1], [r + 1, c]],   // BL vertex
          [[r, c], [r, c + 1], [r + 1, c], [r + 1, c + 1]],   // BR vertex
        ]
        for (const [tl, tr, bl, br] of blocks) {
          const a = at(...tl), b = at(...tr), d = at(...bl), e = at(...br)
          if ((a && e && !b && !d) || (b && d && !a && !e)) return true
        }
        return false
      }
      const touchesEmpty = (cl, cell) => {
        const { r, c } = parse(cell)
        return !solid(cl, r - 1, c) || !solid(cl, r + 1, c) || !solid(cl, r, c - 1) || !solid(cl, r, c + 1)
      }
      const stillConnected = (cl, cell) => {
        if (cl.size <= 1) return false
        const start = cl.has(cell) ? [...cl].find((k) => k !== cell) : [...cl][0]
        if (start === undefined) return false
        const seen = new Set([start]), stack = [start]
        while (stack.length) {
          const { r, c } = parse(stack.pop())
          for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
            const nk = key(nr, nc)
            if (nk !== cell && cl.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk) }
          }
        }
        return seen.size === cl.size - 1
      }
      // Carve winding corridors into the solid. `budget` cells removed; `sin`
      // (0..1) biases each walk from straight (low → gentle notches) to turning
      // often (high → tortuous, serpentine channels).
      const carve = (cluster, budget, sin) => {
        let left = budget, guard = 0
        while (left > 0 && guard++ < budget * 30) {
          const boundary = [...cluster].filter((k) => touchesEmpty(cluster, k))
          if (!boundary.length) break
          let cur = boundary[(rng() * boundary.length) | 0]
          const walk = 3 + ((rng() * left * (0.4 + 0.6 * sin)) | 0)
          let pdir = null
          for (let s = 0; s < walk && left > 0; s++) {
            if (!cluster.has(cur) || !touchesEmpty(cluster, cur) ||
                wouldPinch(cluster, cur) || !stillConnected(cluster, cur)) break
            cluster.delete(cur); left--
            const { r, c } = parse(cur)
            let nbs = [[-1, 0], [1, 0], [0, -1], [0, 1]]
              .map(([dr, dc]) => ({ dr, dc, k: key(r + dr, c + dc) }))
              .filter((o) => cluster.has(o.k))
            if (pdir) {   // avoid immediate backtrack
              const noBack = nbs.filter((o) => !(o.dr === -pdir[0] && o.dc === -pdir[1]))
              if (noBack.length) nbs = noBack
            }
            if (!nbs.length) break
            let chosen
            if (pdir) {
              const straight = nbs.filter((o) => o.dr === pdir[0] && o.dc === pdir[1])
              const turn = nbs.filter((o) => !(o.dr === pdir[0] && o.dc === pdir[1]))
              const wantTurn = rng() < sin
              if (wantTurn && turn.length) chosen = turn[(rng() * turn.length) | 0]
              else if (!wantTurn && straight.length) chosen = straight[0]
              else chosen = nbs[(rng() * nbs.length) | 0]
            } else {
              chosen = nbs[(rng() * nbs.length) | 0]
            }
            pdir = [chosen.dr, chosen.dc]
            cur = chosen.k
          }
        }
      }

      // rectilinear outline of the cell union, as a closed loop of grid-coord points
      const outline = (cluster) => {
        const has = (r, c) => cluster.has(key(r, c))
        const edges = new Map()
        for (const k of cluster) {
          const { r, c } = parse(k)
          const TL = [c - 0.5, r - 0.5], TR = [c + 0.5, r - 0.5], BR = [c + 0.5, r + 0.5], BL = [c - 0.5, r + 0.5]
          if (!has(r - 1, c)) edges.set(TL.join(','), TR)
          if (!has(r, c + 1)) edges.set(TR.join(','), BR)
          if (!has(r + 1, c)) edges.set(BR.join(','), BL)
          if (!has(r, c - 1)) edges.set(BL.join(','), TL)
        }
        if (!edges.size) return []
        const startK = edges.keys().next().value
        const pts = []
        let curK = startK, guard = 0
        do {
          const [gx, gy] = curK.split(',').map(Number)
          pts.push({ gx, gy })
          const nxt = edges.get(curK)
          if (!nxt) break
          curK = nxt.join(',')
        } while (curK !== startK && ++guard < 1e5)
        return pts
      }

      const ropes = []
      const emit = (cluster) => {
        const pts = outline(cluster)
        if (pts.length >= 3) {
          const rope = { loop: [...pts, { ...pts[0] }] }
          reseedRope(rope, cfg)
          if (rope.joints && rope.joints.length >= 2) ropes.push(rope)
        }
      }
      for (const raw of makeClusters(false)) {
        fillHoles(raw)
        dePinch(raw)
        carve(raw, Math.round(ch * raw.size * 0.6), sin)
        fillHoles(raw)
        dePinch(raw)
        emit(raw)
      }
      ropesRef.current = ropes
      paintNodesRef.current.clear(); paintEdgesRef.current.clear()
    }

    // mirror the freshly built base ropes (Draw) for the current symmetry mode;
    // paint bakes its own symmetry above, so this is a no-op there (no ropes)
    rebuildMirrors(cfg)

    histRef.current = []; redoRef.current = []
    curRef.current = null; polyRef.current = null; polyCursorRef.current = null
    editRopeRef.current = null; editDragRef.current = null
    paintDragRef.current = null; paintSelRef.current = null; paintHoverRef.current = null
    hoverAnimRef.current.clear(); paintAnimRef.current.clear()
    wake(); refreshHist()
  }

  // sync config; re-seed on geometry change; keep the content centered
  useEffect(() => {
    editModeRef.current = editMode
    modeRef.current = mode
    drawToolRef.current = drawTool
    if (!editMode) { hoverPinRef.current = null; dragPinRef.current = null }
    if (mode !== 'paint') { paintHoverRef.current = null; paintSelRef.current = null }
    if (mode !== 'edit') { editRopeRef.current = null; editDragRef.current = null; editHoverRef.current = false }
    if (mode !== 'draw' || drawTool !== 'points') { polyRef.current = null; polyCursorRef.current = null }
    insetRef.current = leftInset
    bottomInsetRef.current = bottomInset
    if (style !== styleCurRef.current) {
      styleAnimRef.current = { from: styleCurRef.current, t: 0 }
      styleCurRef.current = style
    }
    cfgRef.current = { cols, rows, cellSize, gap, shape, tension, style, cornerRadius, blob, smoothJoins, hideGuides, sym: symmetry, sizes: sizesRef.current, ignored: ignoredRef.current }
    // geometry that changes the canvas size (cols/rows/spacing) re-fits the
    // content centered, so the grid always fits on screen and grows from the
    // middle — even after the user has panned or zoomed.
    const geomChanged =
      cols !== lastColsRef.current || rows !== lastRowsRef.current || gap !== lastGapRef.current
    // symmetry mode or the reflection axes (cols/rows) changed → rebuild mirrors
    const symOrGridChanged =
      symmetry !== lastSymRef.current || cols !== lastColsRef.current || rows !== lastRowsRef.current
    if (gap !== lastGapRef.current || cellSize !== lastSizeRef.current) {
      reseed(cfgRef.current)
      lastGapRef.current = gap
      lastSizeRef.current = cellSize
    }
    lastColsRef.current = cols
    lastRowsRef.current = rows
    if (symOrGridChanged) { rebuildMirrors(cfgRef.current); lastSymRef.current = symmetry }
    if (!touchedRef.current || geomChanged) ctrlRef.current?.fit()
    wake()
  }, [cols, rows, cellSize, gap, shape, tension, style, cornerRadius, mode, blob, drawTool, smoothJoins, hideGuides, editMode, symmetry])

  // re-read theme colors so pins/ropes recolor on light/dark switch (deferred to rAF
  // so the parent's data-theme update has committed first)
  useEffect(() => {
    const id = requestAnimationFrame(() => { colRef.current = readColors() })
    return () => cancelAnimationFrame(id)
  }, [theme])

  // the left panel (sidebar) and bottom dock changed size: recenter and refit the
  // content so it stays fully visible in the reduced viewport
  useEffect(() => {
    insetRef.current = leftInset
    bottomInsetRef.current = bottomInset
    ctrlRef.current?.fit(true)
  }, [leftInset, bottomInset])

  // create the p5 instance (once)
  useEffect(() => {
    const sketch = (p) => {
      let ro = null
      let onKeyDown = null, onKeyUp = null
      const spaceRef = { current: false }
      const shiftRef = { current: false }   // hold Shift to temporarily engage Edit sizes
      const lastEvtRef = { current: null }   // last pointermove event, to recompute hover on Shift
      const panRef = { current: null }
      const canvasEl = { current: null }
      const idleCursor = () => (spaceRef.current || panToolRef.current ? 'grab' : 'crosshair')
      // Shift in path-edit mode drives add/remove point (not the sizes override).
      const isEdit = () => editModeRef.current || (shiftRef.current && modeRef.current !== 'edit')
      // custom + / - cursors for adding / removing path points on Shift-hover
      const svgCursor = (inner) => {
        const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><circle cx='12' cy='12' r='9' fill='white' stroke='black' stroke-width='1.5'/>${inner}</svg>`
        return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12`
      }
      const CURSOR_ADD = svgCursor(`<path d='M12 7 L12 17 M7 12 L17 12' stroke='black' stroke-width='1.5'/>`) + ', copy'
      const CURSOR_DEL = svgCursor(`<path d='M7 12 L17 12' stroke='black' stroke-width='1.5'/>`) + ', not-allowed'

      // paint the single full-page dotted background so it pans/zooms with the
      // content — offset by the holder's page position so the pattern is seamless
      // across the sidebar edge and the canvas
      const applyBg = () => {
        const bg = bgRef.current, el = holderRef.current; if (!bg || !el) return
        const { scale, tx, ty } = viewRef.current
        const s = 25 * scale
        const rect = el.getBoundingClientRect()
        bg.style.backgroundSize = `${s}px ${s}px`
        bg.style.backgroundPosition = `${tx + rect.left}px ${ty + rect.top}px`
      }
      const setView = (v) => { viewRef.current = v; applyBg(); setZoomPct(Math.round(v.scale * 100)) }
      const markTouched = () => { touchedRef.current = true }

      const zoomAt = (factor, sx, sy) => {
        const v = viewRef.current
        const ns = clampScale(v.scale * factor)
        const f = ns / v.scale
        setView({ scale: ns, tx: sx - (sx - v.tx) * f, ty: sy - (sy - v.ty) * f })
      }
      const fit = (animate = false) => {
        const el = holderRef.current; if (!el) return
        const inset = insetRef.current
        const bottom = bottomInsetRef.current
        const availW = Math.max(1, el.clientWidth - inset)
        const availH = Math.max(1, el.clientHeight - bottom)
        const { w, h } = canvasSize(cfgRef.current.cols, cfgRef.current.rows, cfgRef.current.gap)
        const margin = 60
        const scale = clampScale(Math.min((availW - margin) / w, (availH - margin) / h))
        const target = { scale, tx: inset + (availW - w * scale) / 2, ty: (availH - h * scale) / 2 }
        if (animate) {
          viewAnimRef.current = { from: { ...viewRef.current }, to: target, start: performance.now(), dur: 420 }
        } else {
          viewAnimRef.current = null
          setView(target)
        }
      }
      ctrlRef.current = {
        fit,
        reset: () => { touchedRef.current = false; fit() },
        zoomIn: () => { markTouched(); zoomAt(1.2, (insetRef.current + p.width) / 2, p.height / 2) },
        zoomOut: () => { markTouched(); zoomAt(1 / 1.2, (insetRef.current + p.width) / 2, p.height / 2) },
        togglePan: () => {
          panToolRef.current = !panToolRef.current
          setPanTool(panToolRef.current)
          if (canvasEl.current && !panRef.current) canvasEl.current.style.cursor = idleCursor()
        },
      }

      p.setup = () => {
        colRef.current = readColors()
        const el0 = holderRef.current
        const w = Math.max(1, Math.floor(el0.clientWidth))
        const h = Math.max(1, Math.floor(el0.clientHeight))
        const cnv = p.createCanvas(w, h)
        p.pixelDensity(2)

        const el = cnv.elt
        canvasEl.current = el
        el.style.touchAction = 'none'
        el.style.cursor = idleCursor()

        // screen (canvas px) -> world coordinates
        const worldOf = (e) => {
          const r = el.getBoundingClientRect()
          const sx = (e.clientX - r.left) * (p.width / r.width)
          const sy = (e.clientY - r.top) * (p.height / r.height)
          const v = viewRef.current
          return { x: (sx - v.tx) / v.scale, y: (sy - v.ty) / v.scale }
        }
        const screenOf = (e) => {
          const r = el.getBoundingClientRect()
          return { sx: (e.clientX - r.left) * (p.width / r.width), sy: (e.clientY - r.top) * (p.height / r.height) }
        }

        // which pin is under a world point (nearest cell, cursor inside its container)
        const pinAt = (w) => {
          const cfg = cfgRef.current, pitch = CELL + cfg.gap, O = PAD + CELL / 2
          const c = Math.round((w.x - O) / pitch), r = Math.round((w.y - O) / pitch)
          if (c < 0 || c >= cfg.cols || r < 0 || r >= cfg.rows) return null
          const ct = cellCenter(r, c, cfg)
          if (Math.hypot(w.x - ct.x, w.y - ct.y) > CELL / 2) return null
          return { r, c }
        }
        // set a pin's diameter from the cursor distance to its center
        const resizePin = (w) => {
          const hit = dragPinRef.current; if (!hit) return
          const cfg = cfgRef.current, ct = cellCenter(hit.r, hit.c, cfg)
          // edit mode lets a circle grow up to 3x the global size slider value
          const max = Math.max(MIN_DIAM, cfg.cellSize * 3)
          const diam = Math.max(MIN_DIAM, Math.min(max, Math.hypot(w.x - ct.x, w.y - ct.y) * 2))
          sizesRef.current.set(hit.r + ',' + hit.c, diam)
          wake()
        }

        const sameCell = (a, b) => a && b && a.r === b.r && a.c === b.c

        // --- edit mode (reshape a drawn rope) ---------------------------------
        const gridToWorld = (g) => {
          const cfg = cfgRef.current, O = PAD + CELL / 2, pitch = CELL + cfg.gap
          return { x: O + g.gx * pitch, y: O + g.gy * pitch }
        }
        const worldToGrid = (w) => {
          const cfg = cfgRef.current, O = PAD + CELL / 2, pitch = CELL + cfg.gap
          return { gx: (w.x - O) / pitch, gy: (w.y - O) / pitch }
        }
        // a polygon loop whose first and last points coincide (Points tool)
        const isClosedLoop = (rope) => {
          const L = rope.loop; if (!L || L.length < 2) return false
          const a = L[0], b = L[L.length - 1]
          return Math.abs(a.gx - b.gx) < 1e-6 && Math.abs(a.gy - b.gy) < 1e-6
        }
        const pointInPoly = (pt, pts) => {
          let inside = false
          for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y
            if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi)) inside = !inside
          }
          return inside
        }
        // shortest distance from a point to a closed polyline's edges
        const distToPolyEdges = (pt, pts) => {
          let best = Infinity
          for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const ax = pts[j].x, ay = pts[j].y, bx = pts[i].x, by = pts[i].y
            const dx = bx - ax, dy = by - ay
            const len2 = dx * dx + dy * dy || 1e-9
            let t = ((pt.x - ax) * dx + (pt.y - ay) * dy) / len2
            t = Math.max(0, Math.min(1, t))
            const cx = ax + dx * t, cy = ay + dy * t
            const d = Math.hypot(pt.x - cx, pt.y - cy)
            if (d < best) best = d
          }
          return best
        }
        // topmost rope whose settled shape encloses the point (or whose outline is near it)
        const ropeAt = (w) => {
          const tol = 10 / viewRef.current.scale
          for (let i = ropesRef.current.length - 1; i >= 0; i--) {
            const rope = ropesRef.current[i]
            if (rope.derived) continue   // mirrors follow their base; not directly editable
            if (!rope.joints || rope.joints.length < 3) continue
            if (pointInPoly(w, rope.joints) || distToPolyEdges(w, rope.joints) <= tol) return rope
          }
          return null
        }
        // number of draggable handles (skip the duplicated seam of a closed loop)
        const handleCount = (rope) => {
          if (!rope.loop) return 0
          return isClosedLoop(rope) ? rope.loop.length - 1 : rope.loop.length
        }
        // loop indices to expose as draggable handles: all of them for light loops,
        // an evenly-spaced subset for dense freehand loops so they stay uncluttered.
        const handleIndices = (rope) => {
          const n = handleCount(rope)
          if (n === 0) return []
          if (n <= EDIT_HANDLE_MAX) return Array.from({ length: n }, (_, i) => i)
          const stride = Math.ceil(n / EDIT_HANDLE_MAX)
          const out = []
          for (let i = 0; i < n; i += stride) out.push(i)
          return out
        }
        // index of the loop vertex near a world point (or -1)
        const vertexIndexAt = (rope, w) => {
          const idx = handleIndices(rope)
          if (!idx.length) return -1
          const R = 12 / viewRef.current.scale
          let best = -1, bestD = R
          for (const i of idx) {
            const wp = gridToWorld(rope.loop[i])
            const d = Math.hypot(w.x - wp.x, w.y - wp.y)
            if (d <= bestD) { bestD = d; best = i }
          }
          return best
        }
        // index of the Select-chain node (a pin) near a world point (or -1)
        const chainNodeAt = (rope, w) => {
          if (!rope || !rope.select || !rope.chain) return -1
          const cfg = cfgRef.current
          const R = 14 / viewRef.current.scale
          let best = -1, bestD = R
          for (let i = 0; i < rope.chain.length; i++) {
            const ct = cellCenter(rope.chain[i].r, rope.chain[i].c, cfg)
            const d = Math.hypot(w.x - ct.x, w.y - ct.y)
            if (d <= bestD) { bestD = d; best = i }
          }
          return best
        }
        // nearest loop edge to a world point (for Shift-add); returns the insert
        // slot (in unique-point index space) and the snapped point, or null
        const edgeInsertAt = (rope, w) => {
          const L = rope.loop; if (!L || L.length < 2) return null
          const closed = isClosedLoop(rope)
          const nPts = closed ? L.length - 1 : L.length
          if (nPts < 2) return null
          const tol = 10 / viewRef.current.scale
          let best = null, bestD = tol
          for (let i = 0; i < nPts; i++) {
            const a = gridToWorld(L[i]), b = gridToWorld(L[(i + 1) % nPts])
            const dx = b.x - a.x, dy = b.y - a.y
            const len2 = dx * dx + dy * dy || 1e-9
            let t = ((w.x - a.x) * dx + (w.y - a.y) * dy) / len2
            t = Math.max(0, Math.min(1, t))
            const cx = a.x + dx * t, cy = a.y + dy * t
            const d = Math.hypot(w.x - cx, w.y - cy)
            if (d < bestD) { bestD = d; best = { insertAfter: i, g: worldToGrid({ x: cx, y: cy }), world: { x: cx, y: cy } } }
          }
          return best
        }
        // remove / insert a loop control point (unique-point index space),
        // rebuilding the seam duplicate for closed loops; keeps >= 3 points
        const removeVertexAt = (rope, index) => {
          const closed = isClosedLoop(rope)
          const uniq = closed ? rope.loop.slice(0, -1) : rope.loop.slice()
          if (uniq.length <= 3) return false
          uniq.splice(index, 1)
          rope.loop = closed ? [...uniq, { ...uniq[0] }] : uniq
          return true
        }
        const insertVertexAt = (rope, insertAfter, g) => {
          const closed = isClosedLoop(rope)
          const uniq = closed ? rope.loop.slice(0, -1) : rope.loop.slice()
          uniq.splice(Math.min(insertAfter + 1, uniq.length), 0, { gx: g.gx, gy: g.gy })
          rope.loop = closed ? [...uniq, { ...uniq[0] }] : uniq
        }
        // Shift-hover target: remove an existing handle, else add on the nearest edge
        const shiftTargetAt = (w) => {
          for (let i = ropesRef.current.length - 1; i >= 0; i--) {
            if (ropesRef.current[i].derived) continue
            const vi = vertexIndexAt(ropesRef.current[i], w)
            if (vi >= 0) return { kind: 'remove', rope: ropesRef.current[i], index: vi }
          }
          for (let i = ropesRef.current.length - 1; i >= 0; i--) {
            if (ropesRef.current[i].derived) continue
            const e = edgeInsertAt(ropesRef.current[i], w)
            if (e) return { kind: 'add', rope: ropesRef.current[i], insertAfter: e.insertAfter, g: e.g, world: e.world }
          }
          return null
        }
        const editDown = (w) => {
          // Shift: add a point on the nearest edge, or remove a hovered handle
          if (shiftRef.current) {
            const t = shiftTargetAt(w)
            if (t) {
              const before = t.rope.loop.map((g) => ({ ...g }))
              const ok = t.kind === 'remove' ? removeVertexAt(t.rope, t.index) : (insertVertexAt(t.rope, t.insertAfter, t.g), true)
              if (ok) {
                editRopeRef.current = t.rope
                reseedRope(t.rope, cfgRef.current); wake()
                histRef.current.push({ kind: 'edit', rope: t.rope, before, after: t.rope.loop.map((g) => ({ ...g })) })
                redoRef.current = []; refreshHist()
                rebuildMirrors(cfgRef.current)
              }
            }
            editShiftRef.current = null
            return
          }
          // grab a vertex of any rope (topmost first) so handles are editable
          // straight away, without a prior selecting click
          for (let i = ropesRef.current.length - 1; i >= 0; i--) {
            const rope = ropesRef.current[i]
            if (rope.derived) continue
            if (rope.select) {
              // Select ropes: grab a chain node to re-route it to another pin
              const ci = chainNodeAt(rope, w)
              if (ci >= 0) {
                editRopeRef.current = rope
                editDragRef.current = { kind: 'chain', rope, index: ci, before: rope.chain.map((k) => ({ r: k.r, c: k.c })) }
                return
              }
              continue
            }
            const vi = vertexIndexAt(rope, w)
            if (vi >= 0) {
              editRopeRef.current = rope
              editDragRef.current = { kind: 'vertex', rope, index: vi, closed: isClosedLoop(rope), before: rope.loop.map((g) => ({ ...g })) }
              return
            }
          }
          const rp = ropeAt(w)
          if (rp) {
            editRopeRef.current = rp
            // Select ropes are reshaped by dragging their pin nodes, not by moving
            // the whole body — clicking the body just selects it (shows handles).
            if (rp.select) return
            editDragRef.current = { kind: 'move', rope: rp, before: rp.loop.map((g) => ({ ...g })), holesBefore: rp.holes ? rp.holes.map((hl) => hl.map((g) => ({ ...g }))) : null, lastW: { x: w.x, y: w.y } }
            return
          }
          editRopeRef.current = null   // clicked empty space -> deselect
        }
        const editMove = (w) => {
          const d = editDragRef.current
          if (!d) {
            if (shiftRef.current) {
              const t = shiftTargetAt(w)
              editShiftRef.current = t
              el.style.cursor = t
                ? (t.kind === 'remove' ? CURSOR_DEL : CURSOR_ADD)
                : ((spaceRef.current || panToolRef.current) ? 'grab' : 'default')
              return
            }
            editShiftRef.current = null
            let over = false
            for (const rope of ropesRef.current) {
              if (rope.derived) continue
              if (rope.select ? chainNodeAt(rope, w) >= 0 : vertexIndexAt(rope, w) >= 0) { over = true; break }
            }
            if (!over) over = !!ropeAt(w)
            editHoverRef.current = over
            el.style.cursor = (spaceRef.current || panToolRef.current) ? 'grab' : (over ? 'move' : 'default')
            return
          }
          if (d.kind === 'chain') {
            // snap the dragged node onto whichever pin is under the cursor
            const hit = pinAt(w)
            if (hit && (d.rope.chain[d.index].r !== hit.r || d.rope.chain[d.index].c !== hit.c)) {
              d.rope.chain[d.index] = { r: hit.r, c: hit.c }
              reseedRope(d.rope, cfgRef.current)   // re-wrap seed; physics settles on release
            }
          } else if (d.kind === 'move') {
            const dx = w.x - d.lastW.x, dy = w.y - d.lastW.y
            d.lastW.x = w.x; d.lastW.y = w.y
            for (const j of d.rope.joints) { j.x += dx; j.y += dy; j.vx = 0; j.vy = 0 }
            const cfg = cfgRef.current, pitch = CELL + cfg.gap
            for (const g of d.rope.loop) { g.gx += dx / pitch; g.gy += dy / pitch }
            // move hole rings with the body (P2.0 spike)
            if (d.rope.holeJoints)
              for (const hj of d.rope.holeJoints)
                for (const j of hj) { j.x += dx; j.y += dy; j.vx = 0; j.vy = 0 }
            if (d.rope.holes)
              for (const hl of d.rope.holes)
                for (const g of hl) { g.gx += dx / pitch; g.gy += dy / pitch }
          } else {
            const g = worldToGrid(w)
            d.rope.loop[d.index] = { gx: g.gx, gy: g.gy }
            if (d.closed && d.index === 0) d.rope.loop[d.rope.loop.length - 1] = { gx: g.gx, gy: g.gy }
            // rebuild the outline from the loop (no wake): physics stays frozen
            // while dragging, so vertices move freely and only re-settle on release.
            reseedRope(d.rope, cfgRef.current)
          }
        }
        const editUp = () => {
          const d = editDragRef.current
          editDragRef.current = null
          if (!d) return
          // re-settle this rope from its (translated / reshaped) loop/chain on
          // release, so the shrink-wrap physics runs after the mouse is let go.
          reseedRope(d.rope, cfgRef.current); wake()
          if (d.kind === 'chain') {
            const after = d.rope.chain.map((k) => ({ r: k.r, c: k.c }))
            const changed = d.before.length !== after.length ||
              d.before.some((k, i) => k.r !== after[i].r || k.c !== after[i].c)
            if (changed) {
              histRef.current.push({ kind: 'edit-chain', rope: d.rope, before: d.before, after })
              redoRef.current = []
              refreshHist()
            }
            rebuildMirrors(cfgRef.current)
            return
          }
          const after = d.rope.loop.map((g) => ({ ...g }))
          const changed = d.before.length !== after.length ||
            d.before.some((g, i) => g.gx !== after[i].gx || g.gy !== after[i].gy)
          if (changed) {
            const holesAfter = d.rope.holes ? d.rope.holes.map((hl) => hl.map((g) => ({ ...g }))) : null
            histRef.current.push({ kind: 'edit', rope: d.rope, before: d.before, after, holesBefore: d.holesBefore, holesAfter })
            redoRef.current = []
            refreshHist()
          }
          rebuildMirrors(cfgRef.current)
        }

        // paint mode (drag): visit a pin, connecting it to the previous one when adjacent
        const paintVisit = (hit) => {
          if (!hit) return
          const drag = paintDragRef.current; if (!drag) return
          const key = hit.r + ',' + hit.c
          if (!paintNodesRef.current.has(key)) { paintNodesRef.current.add(key); drag.addedNodes.push(key) }
          if (drag.last && !sameCell(drag.last, hit) && adjacentCells(drag.last, hit)) {
            const lk = drag.last.r + ',' + drag.last.c
            if (!paintNodesRef.current.has(lk)) { paintNodesRef.current.add(lk); drag.addedNodes.push(lk) }
            const ek = edgeKey(drag.last, hit)
            if (!paintEdgesRef.current.has(ek)) {
              paintEdgesRef.current.add(ek); drag.addedEdges.push(ek)
            }
          }
          drag.last = hit
          wake()
        }

        // paint mode: remove a node and every link touching it (undoable)
        const removeNode = (key) => {
          const nodes = [], edges = []
          if (paintNodesRef.current.has(key)) { paintNodesRef.current.delete(key); nodes.push(key) }
          for (const ek of [...paintEdgesRef.current]) {
            const [ka, kb] = ek.split('|')
            if (ka === key || kb === key) { paintEdgesRef.current.delete(ek); edges.push(ek) }
          }
          if (nodes.length || edges.length) {
            histRef.current.push({ kind: 'paint', nodes, edges, inverse: true })
            redoRef.current = []
            refreshHist(); wake()
          }
        }

        // paint mode (click): arm a pin, connect to an armed neighbor, or remove
        const paintTap = (hit) => {
          const sel = paintSelRef.current
          if (!hit) { paintSelRef.current = null; return }
          const key = hit.r + ',' + hit.c
          if (sel && sameCell(sel, hit)) {          // second click on the same pin
            if (paintNodesRef.current.has(key)) removeNode(key)
            paintSelRef.current = null
            return
          }
          if (sel && adjacentCells(sel, hit)) {     // connect armed pin -> neighbor
            const nodes = [], edges = []
            const sk = sel.r + ',' + sel.c
            if (!paintNodesRef.current.has(sk)) { paintNodesRef.current.add(sk); nodes.push(sk) }
            if (!paintNodesRef.current.has(key)) { paintNodesRef.current.add(key); nodes.push(key) }
            const ek = edgeKey(sel, hit)
            if (!paintEdgesRef.current.has(ek)) {
              paintEdgesRef.current.add(ek); edges.push(ek)
            }
            if (nodes.length || edges.length) {
              histRef.current.push({ kind: 'paint', nodes, edges })
              redoRef.current = []; refreshHist()
            }
            paintSelRef.current = hit               // chain from the just-connected pin
            wake()
            return
          }
          paintSelRef.current = hit                 // arm this pin
          wake()
        }

        el.addEventListener('pointerdown', (e) => {
          // pan: middle button, Space + left button, or the hand (pan) tool
          if (e.button === 1 || (e.button === 0 && (spaceRef.current || panToolRef.current))) {
            e.preventDefault()
            el.setPointerCapture(e.pointerId)
            panRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
            el.style.cursor = 'grabbing'
            return
          }
          if (e.button !== 0) return
          // edit mode: click the center X to (un)ignore, else grab to resize
          if (isEdit()) {
            const w = worldOf(e)
            const hit = hoverPinRef.current || pinAt(w)
            if (hit) {
              const ct = cellCenter(hit.r, hit.c, cfgRef.current)
              const xHit = 16 / viewRef.current.scale
              if (Math.hypot(w.x - ct.x, w.y - ct.y) <= xHit) {
                const key = hit.r + ',' + hit.c
                const ig = ignoredRef.current
                if (ig.has(key)) ig.delete(key); else ig.add(key)
                wake()
                return
              }
              el.setPointerCapture(e.pointerId)
              dragPinRef.current = hit
              hoverPinRef.current = hit
              resizePin(w)
            }
            return
          }
          el.setPointerCapture(e.pointerId)
          if (modeRef.current === 'edit') { editDown(worldOf(e)); return }
          if (modeRef.current === 'select') { selectDown(worldOf(e)); return }
          if (modeRef.current === 'paint') {
            const hit = pinAt(worldOf(e))
            paintDragRef.current = { downHit: hit, last: hit, addedNodes: [], addedEdges: [] }
            return
          }
          if (drawToolRef.current === 'points') { pointsDown(worldOf(e)); return }
          curRef.current = [worldOf(e)]
        })
        el.addEventListener('pointermove', (e) => {
          lastEvtRef.current = e
          if (panRef.current && panRef.current.id === e.pointerId) {
            const dx = e.clientX - panRef.current.x, dy = e.clientY - panRef.current.y
            panRef.current.x = e.clientX; panRef.current.y = e.clientY
            const v = viewRef.current
            markTouched(); setView({ scale: v.scale, tx: v.tx + dx, ty: v.ty + dy })
            return
          }
          // edit mode: drag resizes the grabbed pin; otherwise track the hovered pin
          if (isEdit()) {
            if (dragPinRef.current) { resizePin(worldOf(e)); return }
            hoverPinRef.current = pinAt(worldOf(e))
            el.style.cursor = hoverPinRef.current
              ? 'ew-resize'
              : (spaceRef.current || panToolRef.current ? 'grab' : 'default')
            return
          }
          if (modeRef.current === 'edit') { editMove(worldOf(e)); return }
          if (!curRef.current) {
            if (paintDragRef.current) {
              const hit = pinAt(worldOf(e))
              paintHoverRef.current = hit
              paintVisit(hit)
              return
            }
            if (modeRef.current === 'paint') {
              paintHoverRef.current = pinAt(worldOf(e))
              el.style.cursor = paintHoverRef.current
                ? 'pointer'
                : (spaceRef.current || panToolRef.current ? 'grab' : 'crosshair')
            } else if (modeRef.current === 'select') {
              el.style.cursor = pinAt(worldOf(e))
                ? 'pointer'
                : (spaceRef.current || panToolRef.current ? 'grab' : 'crosshair')
            } else if (drawToolRef.current === 'points') {
              polyCursorRef.current = worldOf(e)
              el.style.cursor = (spaceRef.current || panToolRef.current) ? 'grab'
                : (polyNearFirst(polyCursorRef.current) ? 'pointer' : 'crosshair')
            }
            return
          }
          const q = worldOf(e), last = curRef.current[curRef.current.length - 1]
          if (Math.hypot(q.x - last.x, q.y - last.y) >= 8 / viewRef.current.scale) curRef.current.push(q)
        })
        // Select mode: click pins to chain an ordered belt; dbl-click/Enter commits.
        const selectDown = (w) => {
          const hit = pinAt(w)
          if (!hit) return
          const key = hit.r + ',' + hit.c
          const now = performance.now()
          // ignore the second down of a commit double-click on the same pin
          if (lastSelDownRef.current && lastSelDownRef.current.key === key &&
              now - lastSelDownRef.current.t < 350) { lastSelDownRef.current.t = now; return }
          lastSelDownRef.current = { key, t: now }
          if (!selectChainRef.current) selectChainRef.current = []
          selectChainRef.current.push({ r: hit.r, c: hit.c })
          // rebuild the live physics preview rope from the current chain
          const prev = { chain: selectChainRef.current.map((k) => ({ r: k.r, c: k.c })), select: true }
          reseedRope(prev, cfgRef.current)
          selectPreviewRef.current = prev
          wake()
        }
        const finishSelect = () => {
          const chain = selectChainRef.current
          const rope = selectPreviewRef.current
          selectChainRef.current = null; selectPreviewRef.current = null; lastSelDownRef.current = null
          el.style.cursor = idleCursor()
          if (!chain || !chain.length || !rope || !rope.joints || rope.joints.length < 2) return
          ropesRef.current.push(rope); wake()
          histRef.current.push({ kind: 'rope', rope })
          redoRef.current = []; refreshHist()
          rebuildMirrors(cfgRef.current)
        }
        // Commit a freshly drawn loop: if it lies fully inside an existing draw
        // rope, it becomes a HOLE in that rope (fill-rule evenodd); otherwise it
        // becomes a new rope. `loop` is in grid coords, `joints` the seeded ring.
        const commitDrawnLoop = (loop, joints) => {
          const cfg = cfgRef.current
          let cx = 0, cy = 0
          for (const j of joints) { cx += j.x; cy += j.y }
          cx /= joints.length; cy /= joints.length
          let host = null
          for (let i = ropesRef.current.length - 1; i >= 0; i--) {
            const r = ropesRef.current[i]
            if (r.derived || r.select || !r.joints || r.joints.length < 3) continue
            if (!pointInPoly({ x: cx, y: cy }, r.joints)) continue
            let inside = 0
            for (const j of joints) if (pointInPoly(j, r.joints)) inside++
            if (inside / joints.length < 0.9) continue          // must be mostly inside
            let inHole = false
            if (r.holeJoints) for (const hj of r.holeJoints)
              if (pointInPoly({ x: cx, y: cy }, hj)) { inHole = true; break }
            if (inHole) continue                                 // don't nest inside a hole
            host = r; break
          }
          if (host) {
            host.holes = [...(host.holes || []), loop]
            reseedRope(host, cfg); wake()
            histRef.current.push({ kind: 'hole', rope: host, hole: loop })
          } else {
            const rope = { loop, joints }
            ropesRef.current.push(rope); wake()
            histRef.current.push({ kind: 'rope', rope })
          }
          redoRef.current = []; refreshHist()
          rebuildMirrors(cfg)
        }
        const finishDraw = () => {
          if (!curRef.current) return
          const pts = curRef.current
          curRef.current = null
          if (pts.length >= 2) {
            const joints = seedJoints(pts, 10)
            if (joints.length >= 2) {
              const cfg = cfgRef.current, O = PAD + CELL / 2, pitch = CELL + cfg.gap
              const loop = pts.map((q) => ({ gx: (q.x - O) / pitch, gy: (q.y - O) / pitch }))
              commitDrawnLoop(loop, joints)
            }
          }
        }
        // polygon (Points tool): true when the cursor is over the first vertex and
        // the ring already has enough points to close.
        const polyNearFirst = (w) => {
          const poly = polyRef.current
          if (!poly || poly.length < 3 || !w) return false
          return Math.hypot(w.x - poly[0].x, w.y - poly[0].y) <= 12 / viewRef.current.scale
        }
        const closePolygon = () => {
          const poly = polyRef.current
          polyRef.current = null; polyCursorRef.current = null
          polyClosedAtRef.current = performance.now()
          el.style.cursor = idleCursor()
          if (!poly || poly.length < 3) return
          const pts = [...poly, poly[0]]   // close the seam so it samples evenly
          const joints = seedJoints(pts, 10)
          if (joints.length < 2) return
          const cfg = cfgRef.current, O = PAD + CELL / 2, pitch = CELL + cfg.gap
          const loop = pts.map((q) => ({ gx: (q.x - O) / pitch, gy: (q.y - O) / pitch }))
          commitDrawnLoop(loop, joints)
        }
        // add a vertex on click; close when clicking near the first point
        const pointsDown = (w) => {
          if (performance.now() - polyClosedAtRef.current < 350) return  // ignore dbl-click tail
          const poly = polyRef.current
          if (!poly) { polyRef.current = [w]; polyCursorRef.current = w; return }
          if (poly.length >= 3 && Math.hypot(w.x - poly[0].x, w.y - poly[0].y) <= 12 / viewRef.current.scale) {
            closePolygon(); return
          }
          const last = poly[poly.length - 1]
          if (Math.hypot(w.x - last.x, w.y - last.y) >= 6 / viewRef.current.scale) poly.push(w)  // dedupe
          polyCursorRef.current = w
        }
        const finishPaint = () => {
          const drag = paintDragRef.current
          paintDragRef.current = null
          if (!drag) return
          if (drag.addedNodes.length || drag.addedEdges.length) {
            // a drag that painted something: record it and arm the last pin for chaining
            histRef.current.push({ kind: 'paint', nodes: drag.addedNodes, edges: drag.addedEdges })
            redoRef.current = []
            refreshHist()
            paintSelRef.current = drag.last || null
            return
          }
          // no movement: treat as a click (arm / connect / remove)
          paintTap(drag.downHit)
        }
        el.addEventListener('pointerup', (e) => {
          if (panRef.current && panRef.current.id === e.pointerId) {
            panRef.current = null
            el.style.cursor = idleCursor()
            return
          }
          if (dragPinRef.current) { dragPinRef.current = null; return }
          if (modeRef.current === 'edit') { editUp(); return }
          if (paintDragRef.current) { finishPaint(); rebuildMirrors(cfgRef.current); return }
          finishDraw()
        })
        el.addEventListener('pointercancel', () => { curRef.current = null; panRef.current = null; dragPinRef.current = null; paintDragRef.current = null; editDragRef.current = null })
        el.addEventListener('pointerleave', () => { paintHoverRef.current = null })
        // double-click closes the polygon (Points tool) or commits a Select chain
        el.addEventListener('dblclick', (e) => {
          if (modeRef.current === 'select' && selectChainRef.current && selectChainRef.current.length) {
            e.preventDefault(); finishSelect(); return
          }
          if (polyRef.current && polyRef.current.length >= 3) { e.preventDefault(); closePolygon() }
        })

        // wheel: pan by default, zoom with Ctrl/Cmd (or trackpad pinch)
        el.addEventListener('wheel', (e) => {
          e.preventDefault()
          markTouched()
          if (e.ctrlKey || e.metaKey) {
            const { sx, sy } = screenOf(e)
            zoomAt(Math.exp(-e.deltaY * 0.0015), sx, sy)
          } else {
            const v = viewRef.current
            setView({ scale: v.scale, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY })
          }
        }, { passive: false })

        // Space toggles pan mode; Shift temporarily engages Edit sizes while held
        onKeyDown = (e) => {
          if (e.key === 'Escape' && polyRef.current) {
            polyRef.current = null; polyCursorRef.current = null; el.style.cursor = idleCursor()
          }
          if (e.key === 'Escape' && selectChainRef.current) {
            selectChainRef.current = null; selectPreviewRef.current = null; lastSelDownRef.current = null; el.style.cursor = idleCursor(); wake()
          }
          if (e.key === 'Enter' && modeRef.current === 'select' && selectChainRef.current) {
            e.preventDefault(); finishSelect()
          }
          if (e.code === 'Space' && !spaceRef.current && (e.target === document.body || e.target === el)) {
            spaceRef.current = true; if (!panRef.current) el.style.cursor = 'grab'; e.preventDefault()
          }
          if (e.key === 'Shift' && !shiftRef.current) {
            shiftRef.current = true
            if (modeRef.current === 'edit') {
              if (lastEvtRef.current && !panRef.current) editMove(worldOf(lastEvtRef.current))
            } else if (!editModeRef.current && lastEvtRef.current && !panRef.current) {
              hoverPinRef.current = pinAt(worldOf(lastEvtRef.current))
              el.style.cursor = hoverPinRef.current ? 'ew-resize' : idleCursor()
            }
          }
        }
        onKeyUp = (e) => {
          if (e.code === 'Space') { spaceRef.current = false; if (!panRef.current) el.style.cursor = idleCursor() }
          if (e.key === 'Shift') {
            shiftRef.current = false
            if (modeRef.current === 'edit') {
              editShiftRef.current = null
              if (lastEvtRef.current && !panRef.current) editMove(worldOf(lastEvtRef.current))
              else if (!panRef.current) el.style.cursor = idleCursor()
            } else if (!editModeRef.current) {
              hoverPinRef.current = null; dragPinRef.current = null
              if (!panRef.current) el.style.cursor = idleCursor()
            }
          }
        }
        window.addEventListener('keydown', onKeyDown)
        window.addEventListener('keyup', onKeyUp)

        // keep canvas the size of its container; auto-fit until the user takes over
        ro = new ResizeObserver(() => {
          const c = holderRef.current; if (!c || !p5Ref.current) return
          const nw = Math.max(1, Math.floor(c.clientWidth)), nh = Math.max(1, Math.floor(c.clientHeight))
          if (nw !== p5Ref.current.width || nh !== p5Ref.current.height) {
            p5Ref.current.resizeCanvas(nw, nh)
            if (!touchedRef.current) fit(); else applyBg()
          }
        })
        ro.observe(holderRef.current)

        fit()
      }

      p.draw = () => {
        const cfg = cfgRef.current, COL = colRef.current
        p.clear()

        // physics (world data) — shrink-wrap ropes around the pins while awake;
        // frozen during an edit drag so vertices move freely without flicker
        // (the rope only re-settles on pointer release in editUp).
        if (simRef.current.active && !editDragRef.current && (ropesRef.current.length || selectPreviewRef.current)) {
          const poles = pins(cfg)
          const poleGrid = buildPoleGrid(poles)
          const { w, h } = canvasSize(cfg.cols, cfg.rows, cfg.gap)
          // bounds must cover the drawn ropes too (you can draw beyond the grid),
          // otherwise joints get clamped to the grid rect and the shape is cropped
          let xMin = 0, yMin = 0, xMax = w, yMax = h
          for (const rope of ropesRef.current) {
            for (const j of rope.joints) {
              if (j.x < xMin) xMin = j.x; else if (j.x > xMax) xMax = j.x
              if (j.y < yMin) yMin = j.y; else if (j.y > yMax) yMax = j.y
            }
          }
          const M = 200
          const bounds = { xMin: xMin - M, xMax: xMax + M, yMin: yMin - M, yMax: yMax + M }
          let vmax = 0
          for (const rope of ropesRef.current) {
            vmax = Math.max(vmax, stepRope(rope.joints, poleGrid, cfg, bounds))
            if (rope.holeJoints)
              for (const hj of rope.holeJoints)
                vmax = Math.max(vmax, stepRope(hj, poleGrid, cfg, bounds))
          }
          if (selectPreviewRef.current && selectPreviewRef.current.joints)
            vmax = Math.max(vmax, stepRope(selectPreviewRef.current.joints, poleGrid, cfg, bounds))
          if (vmax < calmFor(cfg.tension)) simRef.current.active = false
        }

        // animate the view (zoom/recenter) when the dock opens/closes
        if (viewAnimRef.current) {
          const a = viewAnimRef.current
          let t = (performance.now() - a.start) / a.dur
          if (t >= 1) { t = 1; viewAnimRef.current = null }
          const e = easeOutCubic(t)
          setView({
            scale: a.from.scale + (a.to.scale - a.from.scale) * e,
            tx: a.from.tx + (a.to.tx - a.from.tx) * e,
            ty: a.from.ty + (a.to.ty - a.from.ty) * e,
          })
        }
        const v = viewRef.current
        p.push()
        p.translate(v.tx, v.ty)
        p.scale(v.scale)

        // guides (pins) — fade in/out with "hide guides"; forced visible while
        // editing or actively drawing a loop so the pins stay visible to aim at
        // (e.g. to place a hole inside an existing shape)
        const edit = isEdit()
        const editDraw = modeRef.current === 'edit'
        const drawingActive = !!(curRef.current || polyRef.current || selectChainRef.current)
        const gTarget = (cfg.hideGuides && !edit && !editDraw && !drawingActive) ? 0 : 1
        guideRef.current += (gTarget - guideRef.current) * 0.18
        if (guideRef.current < 0.003) guideRef.current = 0
        if (guideRef.current > 0.997) guideRef.current = 1

        const drawGuides = () => {
          if (guideRef.current <= 0) return
          const a = guideRef.current
          const cr01 = (cfg.cornerRadius ?? 36) / 100
          const active = edit ? (dragPinRef.current || hoverPinRef.current) : null
          const activeKey = active ? `${active.r},${active.c}` : null
          const anim = hoverAnimRef.current
          for (let r = 0; r < cfg.rows; r++)
            for (let c = 0; c < cfg.cols; c++) {
              const ct = cellCenter(r, c, cfg), s = sizeOf(cfg, r, c)
              const key = `${r},${c}`
              const ignored = ignoredRef.current.has(key)
              // hover ease (edit mode only): drives opacity + border
              let t = 0
              if (edit) {
                const prev = anim.get(key) || 0
                t = prev + ((key === activeKey ? 1 : 0) - prev) * 0.2
                anim.set(key, t < 0.001 ? 0 : t)
              }
              // paint-mode tint: hovered/armed pin fill eases toward the accent color
              let pt = 0
              const paint = !edit && modeRef.current === 'paint'
              if (paint) {
                const sel = paintSelRef.current, hov = paintHoverRef.current
                const target = (sel && `${sel.r},${sel.c}` === key) ? 1
                  : (hov && `${hov.r},${hov.c}` === key) ? 1 : 0
                const prev = paintAnimRef.current.get(key) || 0
                pt = prev + (target - prev) * 0.25
                paintAnimRef.current.set(key, pt < 0.001 ? 0 : pt)
              }
              // fill — 50% at rest, 100% on hover in edit mode; reddish when ignored
              const fillA = edit ? a * (0.5 + 0.5 * t) : a
              let col = p.color(ignored ? COL.danger : COL.empty)
              if (paint && pt > 0) col = p.lerpColor(col, p.color(COL.accent), pt)
              col.setAlpha(255 * fillA)
              p.noStroke(); p.fill(col)
              if (cfg.shape === 'circle') p.circle(ct.x, ct.y, s)
              else p.rect(ct.x - s / 2, ct.y - s / 2, s, s, (s / 2) * cr01)

              if (!edit) continue
              // animated dotted border: grows + turns accent (red when ignored) on hover
              const restBorder = p.color(ignored ? COL.danger : COL.ink)
              restBorder.setAlpha((ignored ? 200 : 90) * a)
              const bcol = p.lerpColor(restBorder, p.color(ignored ? COL.danger : COL.accent), t)
              const rad = s / 2 + (2 + 6 * t) / v.scale
              p.noFill(); p.stroke(bcol); p.strokeWeight((1.5 + 1.5 * t) / v.scale)
              p.drawingContext.setLineDash([4 / v.scale, 4 / v.scale])
              if (cfg.shape === 'circle') p.circle(ct.x, ct.y, rad * 2)
              else p.rect(ct.x - rad, ct.y - rad, rad * 2, rad * 2, rad * cr01)
              p.drawingContext.setLineDash([])
              if (t > 0.01) {
                // center X to toggle "ignore"
                const hl = 9 / v.scale
                const xcol = p.color(ignored ? COL.danger : COL.ink); xcol.setAlpha(255 * t)
                p.stroke(xcol); p.strokeWeight(2.4 / v.scale); p.strokeCap(p.ROUND)
                p.line(ct.x - hl, ct.y - hl, ct.x + hl, ct.y + hl)
                p.line(ct.x - hl, ct.y + hl, ct.x + hl, ct.y - hl)
                // resize handle on the right edge
                const hc = p.color(COL.accent); hc.setAlpha(255 * t)
                p.noStroke(); p.fill(hc)
                p.circle(ct.x + rad, ct.y, (12 * t) / v.scale)
              }
            }
        }

        // normal: guides sit under the ropes
        if (!edit) drawGuides()

        // ropes — crossfade opacity when the style changes (fill <-> outline);
        // dim all ropes to 50% while editing (Sizes/Path) or actively drawing a
        // loop, so the pins stay visible underneath (helps aim + place holes)
        const sa = styleAnimRef.current
        if (sa.t < 1) sa.t = Math.min(1, sa.t + 0.12)
        const se = easeInOut(sa.t)
        const ea = (editDraw || edit || drawingActive) ? 0.5 : 1
        for (const rope of ropesRef.current) {
          if (sa.t < 1) {
            drawRope(p, rope.joints, sa.from, COL, (1 - se) * ea, rope.holeJoints)
            drawRope(p, rope.joints, cfg.style, COL, se * ea, rope.holeJoints)
          } else {
            drawRope(p, rope.joints, cfg.style, COL, ea, rope.holeJoints)
          }
        }

        // painted blobs (metaball bridges + node circles + optional fillets)
        drawPaint(p, paintNodesRef.current, paintEdgesRef.current, cfg, COL, 1)
        drawPaint(p, paintMirNodesRef.current, paintMirEdgesRef.current, cfg, COL, 1)

        // paint mode: tint the hovered/armed pin toward accent, on top of painted nodes too
        if (modeRef.current === 'paint' && !edit) {
          const cr01 = (cfg.cornerRadius ?? 36) / 100
          for (const ref of [paintHoverRef.current, paintSelRef.current]) {
            if (!ref) continue
            const key = `${ref.r},${ref.c}`
            if (!paintNodesRef.current.has(key)) continue   // unpainted handled by guides
            const pt = paintAnimRef.current.get(key) || 0
            if (pt <= 0.01) continue
            const ct = cellCenter(ref.r, ref.c, cfg), s = sizeOf(cfg, ref.r, ref.c)
            const ac = p.color(COL.accent); ac.setAlpha(255 * pt)
            p.noStroke(); p.fill(ac)
            if (cfg.shape === 'square') p.rect(ct.x - s / 2, ct.y - s / 2, s, s, (s / 2) * cr01)
            else p.circle(ct.x, ct.y, s)
          }
        }

        // edit mode: guides render on top of the drawings
        if (edit) drawGuides()

        // preview of the loop being drawn (freehand)
        if (curRef.current && curRef.current.length > 1) {
          p.noFill(); p.stroke(COL.accent); p.strokeWeight(2 / v.scale)
          p.drawingContext.setLineDash([5 / v.scale, 5 / v.scale])
          p.beginShape(); for (const pt of curRef.current) p.vertex(pt.x, pt.y); p.endShape()
          p.drawingContext.setLineDash([])
        }

        // preview of the polygon being built (Points tool): solid placed segments,
        // a dashed rubber-band to the cursor, and a dot per vertex.
        if (polyRef.current && polyRef.current.length) {
          const poly = polyRef.current, sc = v.scale
          const cur = polyCursorRef.current
          p.noFill(); p.stroke(COL.accent); p.strokeWeight(2 / sc)
          if (poly.length > 1) { p.beginShape(); for (const pt of poly) p.vertex(pt.x, pt.y); p.endShape() }
          if (cur) {
            p.drawingContext.setLineDash([5 / sc, 5 / sc])
            const last = poly[poly.length - 1]
            p.line(last.x, last.y, cur.x, cur.y)
            p.drawingContext.setLineDash([])
          }
          const near = cur && poly.length >= 3 &&
            Math.hypot(cur.x - poly[0].x, cur.y - poly[0].y) <= 12 / sc
          p.noStroke()
          for (let i = 0; i < poly.length; i++) {
            const r = (i === 0 ? (near ? 7 : 5) : 4) / sc
            p.fill(i === 0 && near ? COL.accent : COL.ink)
            p.circle(poly[i].x, poly[i].y, r * 2)
            if (i === 0 && near) { p.noFill(); p.stroke(COL.accent); p.strokeWeight(2 / sc); p.circle(poly[i].x, poly[i].y, 18 / sc); p.noStroke() }
          }
        }

        // preview of the Select belt being chained: translucent belt fill + dashed
        // outline, plus a numbered badge over each pin in creation order.
        if (modeRef.current === 'select' && selectChainRef.current && selectChainRef.current.length) {
          const chain = selectChainRef.current, sc = v.scale
          const centers = chain.map((k) => cellCenter(k.r, k.c, cfg))
          const prev = selectPreviewRef.current
          if (prev && prev.joints && prev.joints.length >= 3) {
            drawRope(p, prev.joints, cfg.style, COL, 0.35)
            const { start, segs } = splineSegments(prev.joints, true)
            p.noFill(); p.stroke(COL.accent); p.strokeWeight(2 / sc)
            p.drawingContext.setLineDash([6 / sc, 5 / sc])
            p.beginShape(); p.vertex(start.x, start.y)
            for (const s of segs) p.bezierVertex(s.c1x, s.c1y, s.c2x, s.c2y, s.x, s.y)
            p.endShape(p.CLOSE)
            p.drawingContext.setLineDash([])
          }
          const seen = {}
          p.textAlign(p.CENTER, p.CENTER); p.textStyle(p.BOLD); p.textSize(14 / sc)
          for (let i = 0; i < chain.length; i++) {
            const key = chain[i].r + ',' + chain[i].c
            const n = seen[key] || 0; seen[key] = n + 1
            const ct = centers[i]
            const bx = ct.x + n * (16 / sc), by = ct.y - n * (16 / sc)
            p.noStroke(); p.fill(COL.ink); p.circle(bx, by, 22 / sc)
            p.fill(COL.empty); p.text(String(i + 1), bx, by)
          }
        }

        // edit mode: show draggable vertex handles for every rope right away
        // (no selecting click needed); highlight the actively-dragged one's outline.
        if (editDraw) {
          const sc = v.scale
          const O = PAD + CELL / 2, pitch = CELL + cfg.gap
          for (const rope of ropesRef.current) {
            if (rope.derived) continue   // no handles on mirror copies
            const selected = rope === editRopeRef.current
            if (selected && rope.joints && rope.joints.length >= 2) {
              p.noFill(); p.stroke(COL.accent); p.strokeWeight(1.5 / sc)
              p.drawingContext.setLineDash([5 / sc, 5 / sc])
              p.beginShape(); for (const j of rope.joints) p.vertex(j.x, j.y); p.endShape(p.CLOSE)
              p.drawingContext.setLineDash([])
            }
            const L = rope.loop
            if (L && L.length) {
              const closed = L.length >= 2 &&
                Math.abs(L[0].gx - L[L.length - 1].gx) < 1e-6 && Math.abs(L[0].gy - L[L.length - 1].gy) < 1e-6
              const n = closed ? L.length - 1 : L.length
              const stride = n > EDIT_HANDLE_MAX ? Math.ceil(n / EDIT_HANDLE_MAX) : 1
              const di = editDragRef.current
              for (let i = 0; i < n; i += stride) {
                const x = O + L[i].gx * pitch, y = O + L[i].gy * pitch
                const activeV = selected && di && di.kind === 'vertex' && di.index === i
                p.fill(COL.accent); p.stroke(COL.ink); p.strokeWeight(1 / sc)
                p.circle(x, y, (activeV ? 13 : 10) / sc)
              }
              p.noStroke()
            }
            // Select ropes: draggable node handles over each chained pin center
            if (rope.select && rope.chain && rope.chain.length) {
              const di = editDragRef.current
              for (let i = 0; i < rope.chain.length; i++) {
                const ct = cellCenter(rope.chain[i].r, rope.chain[i].c, cfg)
                const activeV = selected && di && di.kind === 'chain' && di.index === i
                p.fill(COL.accent); p.stroke(COL.ink); p.strokeWeight(1 / sc)
                p.circle(ct.x, ct.y, (activeV ? 15 : 12) / sc)
              }
              p.noStroke()
            }
          }
          // Shift-hover marker: a + at the insertion point, or a ring on the handle to remove
          const st = editShiftRef.current
          if (shiftRef.current && st) {
            const sc2 = v.scale
            p.noFill(); p.stroke(COL.accent); p.strokeWeight(1.5 / sc2)
            if (st.kind === 'add' && st.world) {
              p.circle(st.world.x, st.world.y, 14 / sc2)
              p.line(st.world.x - 4 / sc2, st.world.y, st.world.x + 4 / sc2, st.world.y)
              p.line(st.world.x, st.world.y - 4 / sc2, st.world.x, st.world.y + 4 / sc2)
            } else if (st.kind === 'remove' && st.rope.loop[st.index]) {
              const O2 = PAD + CELL / 2, pitch2 = CELL + cfg.gap
              const x = O2 + st.rope.loop[st.index].gx * pitch2, y = O2 + st.rope.loop[st.index].gy * pitch2
              p.circle(x, y, 18 / sc2)
              p.line(x - 4 / sc2, y, x + 4 / sc2, y)
            }
            p.noStroke()
          }
        }

        p.pop()
      }

      p.remove_ = () => {
        if (ro) ro.disconnect()
        if (onKeyDown) window.removeEventListener('keydown', onKeyDown)
        if (onKeyUp) window.removeEventListener('keyup', onKeyUp)
      }
    }

    p5Ref.current = new p5(sketch, hostRef.current)
    return () => {
      p5Ref.current.remove_?.()
      p5Ref.current.remove()
      p5Ref.current = null
    }
  }, [])

  // actions exposed to the Sidebar
  useImperativeHandle(ref, () => ({
    clear() {
      ropesRef.current = []; histRef.current = []; redoRef.current = []; curRef.current = null
      polyRef.current = null; polyCursorRef.current = null
      selectChainRef.current = null; selectPreviewRef.current = null; lastSelDownRef.current = null
      editRopeRef.current = null; editDragRef.current = null
      paintNodesRef.current.clear(); paintEdgesRef.current.clear(); paintDragRef.current = null
      paintMirNodesRef.current.clear(); paintMirEdgesRef.current.clear()
      wake(); setCanUndo(false); setCanRedo(false)
    },
    resetCircles() {
      sizesRef.current.clear(); ignoredRef.current.clear()
      hoverAnimRef.current.clear()
      wake()
    },
    undo: doUndo,
    redo: doRedo,
    randomize,
    // serializable drawing state + an SVG preview data-URI for the history dock
    snapshot() {
      const cfg = cfgRef.current
      const drawing = {
        ropes: ropesRef.current.filter((r) => !r.derived).map((r) => r.select
          ? { select: true, chain: (r.chain || []).map((k) => ({ r: k.r, c: k.c })) }
          : {
              loop: (r.loop || []).map((g) => ({ gx: g.gx, gy: g.gy })),
              ...(r.holes && r.holes.length
                ? { holes: r.holes.map((h) => h.map((g) => ({ gx: g.gx, gy: g.gy }))) }
                : {}),
            }),
        paint: { nodes: [...paintNodesRef.current], edges: [...paintEdgesRef.current] },
        sizes: [...sizesRef.current.entries()],
        ignored: [...ignoredRef.current],
      }
      const paint = {
        nodes: new Set([...paintNodesRef.current, ...paintMirNodesRef.current]),
        edges: new Set([...paintEdgesRef.current, ...paintMirEdgesRef.current]),
      }
      // preview uses `currentColor` so it follows the active theme when rendered inline
      const previewSvg = buildSVG(ropesRef.current, paint, cfg, 'currentColor')
      return { drawing, previewSvg }
    },
    // replace the current drawing with a saved snapshot (cfg = its saved geometry,
    // so ropes re-seed at the right pitch before the parent's state syncs cfgRef)
    restore(drawing, cfg) {
      if (!drawing) return
      if (cfg) cfgRef.current = { ...cfgRef.current, ...cfg, sizes: sizesRef.current, ignored: ignoredRef.current }
      sizesRef.current.clear()
      for (const [k, val] of drawing.sizes || []) sizesRef.current.set(k, val)
      ignoredRef.current.clear()
      for (const k of drawing.ignored || []) ignoredRef.current.add(k)
      ropesRef.current = (drawing.ropes || []).map((r) => {
        const rope = r.select
          ? { select: true, chain: (r.chain || []).map((k) => ({ r: k.r, c: k.c })) }
          : {
              loop: (r.loop || []).map((g) => ({ gx: g.gx, gy: g.gy })),
              ...(r.holes && r.holes.length
                ? { holes: r.holes.map((h) => h.map((g) => ({ gx: g.gx, gy: g.gy }))) }
                : {}),
            }
        reseedRope(rope, cfgRef.current)
        return rope
      })
      paintNodesRef.current = new Set(drawing.paint?.nodes || [])
      paintEdgesRef.current = new Set(drawing.paint?.edges || [])
      rebuildMirrors(cfgRef.current)
      histRef.current = []; redoRef.current = []
      curRef.current = null; polyRef.current = null; polyCursorRef.current = null
      editRopeRef.current = null; editDragRef.current = null
      paintDragRef.current = null; paintSelRef.current = null; paintHoverRef.current = null
      hoverAnimRef.current.clear(); paintAnimRef.current.clear()
      setCanUndo(false); setCanRedo(false)
      wake()
    },
    exportSVG() {
      const paint = {
        nodes: new Set([...paintNodesRef.current, ...paintMirNodesRef.current]),
        edges: new Set([...paintEdgesRef.current, ...paintMirEdgesRef.current]),
      }
      const svg = buildSVG(ropesRef.current, paint, cfgRef.current, colRef.current.ink)
      download(new Blob([svg], { type: 'image/svg+xml' }), 'grid.svg')
    },
    exportPNG() {
      const cfg = cfgRef.current
      const { w, h } = canvasSize(cfg.cols, cfg.rows, cfg.gap)
      const pg = p5Ref.current.createGraphics(w, h)
      pg.pixelDensity(2); pg.clear()
      for (const rope of ropesRef.current) drawRope(pg, rope.joints, cfg.style, colRef.current, 1, rope.holeJoints)
      drawPaint(pg, paintNodesRef.current, paintEdgesRef.current, cfg, colRef.current, 1)
      drawPaint(pg, paintMirNodesRef.current, paintMirEdgesRef.current, cfg, colRef.current, 1)
      p5Ref.current.saveCanvas(pg, 'grid', 'png')
      pg.remove()
    },
  }), [])

  return (
    <>
      <div
        ref={bgRef}
        className="canvas-bg"
        style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}
      />
      <div ref={holderRef} style={{ position: 'relative', zIndex: 1, width: '100%', height: '100%', overflow: 'hidden' }}>
        <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
      <div className="zoombox" style={{ left: leftInset + 16, right: 'auto' }}>
        <button
          className="tool-btn icon-btn" onClick={doUndo} disabled={!canUndo}
          title="Undo" aria-label="Undo"
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 14 4 9 9 4" /><path d="M4 9h11a5 5 0 0 1 0 10H8" />
          </svg>
        </button>
        <button
          className="tool-btn icon-btn" onClick={doRedo} disabled={!canRedo}
          title="Redo" aria-label="Redo"
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 14 20 9 15 4" /><path d="M20 9H9a5 5 0 0 0 0 10h7" />
          </svg>
        </button>
      </div>
      <div className="zoombox">
        <button
          className={'tool-btn icon-btn' + (panTool ? ' active' : '')}
          onClick={() => ctrlRef.current?.togglePan()}
          title="Pan (Space)" aria-label="Pan"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 11V6a2 2 0 0 0-4 0" /><path d="M14 10V4a2 2 0 0 0-4 0v2" /><path d="M10 10.5V6a2 2 0 0 0-4 0v8" /><path d="M18 8a2 2 0 0 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
          </svg>
        </button>
        <span className="tb-sep" />
        <button className="tool-btn icon-btn" onClick={() => ctrlRef.current?.zoomOut()} title="Zoom out" aria-label="Zoom out">−</button>
        <span className="zlabel" onClick={() => ctrlRef.current?.reset()} title="Reset view">{zoomPct}%</span>
        <button className="tool-btn icon-btn" onClick={() => ctrlRef.current?.zoomIn()} title="Zoom in" aria-label="Zoom in">+</button>
        <button className="tool-btn icon-btn" onClick={() => ctrlRef.current?.reset()} title="Reset view" aria-label="Reset view">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 9V5a1 1 0 0 1 1-1h4" /><path d="M20 9V5a1 1 0 0 0-1-1h-4" /><path d="M4 15v4a1 1 0 0 0 1 1h4" /><path d="M20 15v4a1 1 0 0 1-1 1h-4" />
          </svg>
        </button>
      </div>
    </div>
    </>
  )
})

export default GridCanvas
