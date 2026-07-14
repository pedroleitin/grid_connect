import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react'
import p5 from 'p5'
import {
  canvasSize, cellCenter, pins, seedJoints, stepRope,
  splineSegments, buildSVG, calmFor, CELL, PAD, sizeOf,
  metaball, adjacentCells,
} from '../lib/geometry'

/* render a rope: closed Catmull-Rom spline through its physics joints */
function drawRope(g, joints, style, COL, alpha = 1) {
  const n = joints.length
  if (n === 0) return
  const ink = g.color(COL.ink); ink.setAlpha(255 * alpha)
  if (n < 3) { g.fill(ink); g.noStroke(); g.circle(joints[0].x, joints[0].y, 8); return }
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
  const v = (cfg.blob ?? 50) / 100
  const ink = g.color(COL.ink); ink.setAlpha(255 * alpha)
  g.noStroke(); g.fill(ink)
  for (const key of edges) {
    const [ka, kb] = key.split('|')
    const [ra, ca] = ka.split(',').map(Number)
    const [rb, cb] = kb.split(',').map(Number)
    const m = metaball(cellCenter(ra, ca, cfg), sizeOf(cfg, ra, ca) / 2,
                       cellCenter(rb, cb, cfg), sizeOf(cfg, rb, cb) / 2, v)
    if (!m) continue
    g.beginShape()
    g.vertex(m.p1a.x, m.p1a.y)
    g.bezierVertex(m.ho0.x, m.ho0.y, m.hi1.x, m.hi1.y, m.p2a.x, m.p2a.y)
    g.vertex(m.p2b.x, m.p2b.y)
    g.bezierVertex(m.ho2.x, m.ho2.y, m.hi3.x, m.hi3.y, m.p1b.x, m.p1b.y)
    g.endShape(g.CLOSE)
  }
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
const MAX_DIAM = 300          // edit mode lets a circle grow beyond its container
const clampDiam = (d) => Math.max(MIN_DIAM, Math.min(MAX_DIAM, d))
const EDIT_HANDLE_MAX = 40    // only show draggable vertex handles for loops up to this many points

// canonical key for an undirected paint link between two cells
const edgeKey = (a, b) => {
  const ka = a.r + ',' + a.c, kb = b.r + ',' + b.c
  return ka < kb ? ka + '|' + kb : kb + '|' + ka
}

// smoothstep easing for animation progress (0..1)
const easeInOut = (t) => t * t * (3 - 2 * t)

const GridCanvas = forwardRef(function GridCanvas({ cols, rows, cellSize, gap, shape, tension, style, cornerRadius, mode, blob, drawTool, hideGuides, editMode, theme, leftInset = 0 }, ref) {
  const holderRef = useRef(null)   // p5 host container (pans/zooms)
  const bgRef = useRef(null)       // full-page dotted background (single seamless layer)
  const insetRef = useRef(leftInset) // left area hidden by the sidebar (for centering)
  const hostRef = useRef(null)     // p5 canvas mounts here
  const p5Ref = useRef(null)
  const sizesRef = useRef(new Map())  // per-cell diameter overrides: "r,c" -> px
  const ignoredRef = useRef(new Set())  // ignored cells ("r,c"): no drawing interaction
  const cfgRef = useRef({ cols, rows, cellSize, gap, shape, tension, style, cornerRadius, blob, hideGuides, sizes: sizesRef.current, ignored: ignoredRef.current })
  const ropesRef = useRef([])       // physics ropes: { loop, joints }
  const paintNodesRef = useRef(new Set())  // painted cells "r,c"
  const paintEdgesRef = useRef(new Set())  // painted links: sorted "ka|kb"
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
  const styleAnimRef = useRef({ from: style, t: 1 })  // crossfade between styles
  const styleCurRef = useRef(style)
  const lastGapRef = useRef(gap)
  const lastSizeRef = useRef(cellSize)
  const lastColsRef = useRef(cols)
  const lastRowsRef = useRef(rows)
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

  // view transform: world -> screen is  screen = world * scale + (tx, ty)
  const viewRef = useRef({ scale: 1, tx: 0, ty: 0 })
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
      reseedRope(act.rope, cfgRef.current)
    }
  }

  const doUndo = () => {
    const act = histRef.current.pop()
    if (!act) return
    applyAction(act, false)
    redoRef.current.push(act)
    wake(); refreshHist()
  }
  const doRedo = () => {
    const act = redoRef.current.pop()
    if (!act) return
    applyAction(act, true)
    histRef.current.push(act)
    wake(); refreshHist()
  }

  const reseedRope = (rope, cfg) => {
    if (!rope.loop) return
    const O = PAD + CELL / 2, pitch = CELL + cfg.gap
    const pts = rope.loop.map((g) => ({ x: O + g.gx * pitch, y: O + g.gy * pitch }))
    rope.joints = seedJoints(pts, 10)
  }

  const reseed = (cfg) => {
    for (const rope of ropesRef.current) reseedRope(rope, cfg)
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
    if (style !== styleCurRef.current) {
      styleAnimRef.current = { from: styleCurRef.current, t: 0 }
      styleCurRef.current = style
    }
    cfgRef.current = { cols, rows, cellSize, gap, shape, tension, style, cornerRadius, blob, hideGuides, sizes: sizesRef.current, ignored: ignoredRef.current }
    // geometry that changes the canvas size (cols/rows/spacing) re-fits the
    // content centered, so the grid always fits on screen and grows from the
    // middle — even after the user has panned or zoomed.
    const geomChanged =
      cols !== lastColsRef.current || rows !== lastRowsRef.current || gap !== lastGapRef.current
    if (gap !== lastGapRef.current || cellSize !== lastSizeRef.current) {
      reseed(cfgRef.current)
      lastGapRef.current = gap
      lastSizeRef.current = cellSize
    }
    lastColsRef.current = cols
    lastRowsRef.current = rows
    if (!touchedRef.current || geomChanged) ctrlRef.current?.fit()
    wake()
  }, [cols, rows, cellSize, gap, shape, tension, style, cornerRadius, mode, blob, drawTool, hideGuides, editMode])

  // re-read theme colors so pins/ropes recolor on light/dark switch (deferred to rAF
  // so the parent's data-theme update has committed first)
  useEffect(() => {
    const id = requestAnimationFrame(() => { colRef.current = readColors() })
    return () => cancelAnimationFrame(id)
  }, [theme])

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
      const isEdit = () => editModeRef.current || shiftRef.current

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
      const fit = () => {
        const el = holderRef.current; if (!el) return
        const inset = insetRef.current
        const availW = Math.max(1, el.clientWidth - inset), H = el.clientHeight
        const { w, h } = canvasSize(cfgRef.current.cols, cfgRef.current.rows, cfgRef.current.gap)
        const margin = 60
        const scale = clampScale(Math.min((availW - margin) / w, (H - margin) / h))
        setView({ scale, tx: inset + (availW - w * scale) / 2, ty: (H - h * scale) / 2 })
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
          const diam = clampDiam(Math.hypot(w.x - ct.x, w.y - ct.y) * 2)
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
        // index of the loop vertex near a world point (or -1)
        const vertexIndexAt = (rope, w) => {
          const n = handleCount(rope)
          if (n === 0 || n > EDIT_HANDLE_MAX) return -1
          const R = 9 / viewRef.current.scale
          let best = -1, bestD = R
          for (let i = 0; i < n; i++) {
            const wp = gridToWorld(rope.loop[i])
            const d = Math.hypot(w.x - wp.x, w.y - wp.y)
            if (d <= bestD) { bestD = d; best = i }
          }
          return best
        }
        const editDown = (w) => {
          const sel = editRopeRef.current
          if (sel) {
            const vi = vertexIndexAt(sel, w)
            if (vi >= 0) {
              editDragRef.current = { kind: 'vertex', rope: sel, index: vi, closed: isClosedLoop(sel), before: sel.loop.map((g) => ({ ...g })) }
              return
            }
          }
          const rp = ropeAt(w)
          if (rp) {
            editRopeRef.current = rp
            editDragRef.current = { kind: 'move', rope: rp, before: rp.loop.map((g) => ({ ...g })), lastW: { x: w.x, y: w.y } }
            return
          }
          editRopeRef.current = null   // clicked empty space -> deselect
        }
        const editMove = (w) => {
          const d = editDragRef.current
          if (!d) {
            const sel = editRopeRef.current
            const over = (sel && vertexIndexAt(sel, w) >= 0) || !!ropeAt(w)
            editHoverRef.current = over
            el.style.cursor = (spaceRef.current || panToolRef.current) ? 'grab' : (over ? 'move' : 'default')
            return
          }
          if (d.kind === 'move') {
            const dx = w.x - d.lastW.x, dy = w.y - d.lastW.y
            d.lastW.x = w.x; d.lastW.y = w.y
            for (const j of d.rope.joints) { j.x += dx; j.y += dy; j.vx = 0; j.vy = 0 }
            const cfg = cfgRef.current, pitch = CELL + cfg.gap
            for (const g of d.rope.loop) { g.gx += dx / pitch; g.gy += dy / pitch }
            wake()
          } else {
            const g = worldToGrid(w)
            d.rope.loop[d.index] = { gx: g.gx, gy: g.gy }
            if (d.closed && d.index === 0) d.rope.loop[d.rope.loop.length - 1] = { gx: g.gx, gy: g.gy }
            reseedRope(d.rope, cfgRef.current)
            wake()
          }
        }
        const editUp = () => {
          const d = editDragRef.current
          editDragRef.current = null
          if (!d) return
          // re-seed a moved rope from its (translated) loop so it settles
          // deterministically around the pins now under it, instead of the
          // live-translated ring snapping back to the original pins.
          if (d.kind === 'move') { reseedRope(d.rope, cfgRef.current); wake() }
          const after = d.rope.loop.map((g) => ({ ...g }))
          const changed = d.before.length !== after.length ||
            d.before.some((g, i) => g.gx !== after[i].gx || g.gy !== after[i].gy)
          if (changed) {
            histRef.current.push({ kind: 'edit', rope: d.rope, before: d.before, after })
            redoRef.current = []
            refreshHist()
          }
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
            if (!paintEdgesRef.current.has(ek)) { paintEdgesRef.current.add(ek); drag.addedEdges.push(ek) }
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
            if (!paintEdgesRef.current.has(ek)) { paintEdgesRef.current.add(ek); edges.push(ek) }
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
        const finishDraw = () => {
          if (!curRef.current) return
          const pts = curRef.current
          curRef.current = null
          if (pts.length >= 2) {
            const joints = seedJoints(pts, 10)
            if (joints.length >= 2) {
              const cfg = cfgRef.current, O = PAD + CELL / 2, pitch = CELL + cfg.gap
              const loop = pts.map((q) => ({ gx: (q.x - O) / pitch, gy: (q.y - O) / pitch }))
              const rope = { loop, joints }
              ropesRef.current.push(rope); wake()
              histRef.current.push({ kind: 'rope', rope })
              redoRef.current = []
              refreshHist()
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
          const rope = { loop, joints }
          ropesRef.current.push(rope); wake()
          histRef.current.push({ kind: 'rope', rope })
          redoRef.current = []
          refreshHist()
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
          if (paintDragRef.current) { finishPaint(); return }
          finishDraw()
        })
        el.addEventListener('pointercancel', () => { curRef.current = null; panRef.current = null; dragPinRef.current = null; paintDragRef.current = null; editDragRef.current = null })
        el.addEventListener('pointerleave', () => { paintHoverRef.current = null })
        // double-click closes the polygon (Points tool)
        el.addEventListener('dblclick', (e) => {
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
          if (e.code === 'Space' && !spaceRef.current && (e.target === document.body || e.target === el)) {
            spaceRef.current = true; if (!panRef.current) el.style.cursor = 'grab'; e.preventDefault()
          }
          if (e.key === 'Shift' && !shiftRef.current) {
            shiftRef.current = true
            if (!editModeRef.current && lastEvtRef.current && !panRef.current) {
              hoverPinRef.current = pinAt(worldOf(lastEvtRef.current))
              el.style.cursor = hoverPinRef.current ? 'ew-resize' : idleCursor()
            }
          }
        }
        onKeyUp = (e) => {
          if (e.code === 'Space') { spaceRef.current = false; if (!panRef.current) el.style.cursor = idleCursor() }
          if (e.key === 'Shift') {
            shiftRef.current = false
            if (!editModeRef.current) {
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

        // physics (world data) — shrink-wrap ropes around the pins while awake
        if (simRef.current.active && ropesRef.current.length) {
          const poles = pins(cfg)
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
          for (const rope of ropesRef.current) vmax = Math.max(vmax, stepRope(rope.joints, poles, cfg, bounds))
          if (vmax < calmFor(cfg.tension)) simRef.current.active = false
        }

        const v = viewRef.current
        p.push()
        p.translate(v.tx, v.ty)
        p.scale(v.scale)

        // guides (pins) — fade in/out with "hide guides"; forced visible in edit mode
        const edit = isEdit()
        const editDraw = modeRef.current === 'edit'
        const gTarget = (cfg.hideGuides && !edit && !editDraw) ? 0 : 1
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

        // ropes — crossfade opacity when the style changes (fill <-> outline)
        const sa = styleAnimRef.current
        if (sa.t < 1) sa.t = Math.min(1, sa.t + 0.12)
        const se = easeInOut(sa.t)
        for (const rope of ropesRef.current) {
          if (sa.t < 1) {
            drawRope(p, rope.joints, sa.from, COL, 1 - se)
            drawRope(p, rope.joints, cfg.style, COL, se)
          } else {
            drawRope(p, rope.joints, cfg.style, COL)
          }
        }

        // painted blobs (metaball bridges + node circles)
        drawPaint(p, paintNodesRef.current, paintEdgesRef.current, cfg, COL)

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

        // edit mode: outline the selected rope and show its draggable vertex handles
        if (editDraw && editRopeRef.current && ropesRef.current.includes(editRopeRef.current)) {
          const rope = editRopeRef.current, sc = v.scale
          const O = PAD + CELL / 2, pitch = CELL + cfg.gap
          if (rope.joints && rope.joints.length >= 2) {
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
            if (n <= EDIT_HANDLE_MAX) {
              const di = editDragRef.current
              for (let i = 0; i < n; i++) {
                const x = O + L[i].gx * pitch, y = O + L[i].gy * pitch
                const activeV = di && di.kind === 'vertex' && di.index === i
                p.noStroke(); p.fill(COL.ink); p.circle(x, y, (activeV ? 9 : 6) / sc)
                p.fill(COL.accent); p.circle(x, y, (activeV ? 5 : 3) / sc)
              }
            }
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
      editRopeRef.current = null; editDragRef.current = null
      paintNodesRef.current.clear(); paintEdgesRef.current.clear(); paintDragRef.current = null
      wake(); setCanUndo(false); setCanRedo(false)
    },
    resetCircles() {
      sizesRef.current.clear(); ignoredRef.current.clear()
      hoverAnimRef.current.clear()
      wake()
    },
    undo: doUndo,
    redo: doRedo,
    exportSVG() {
      const paint = { nodes: paintNodesRef.current, edges: paintEdgesRef.current }
      const svg = buildSVG(ropesRef.current, paint, cfgRef.current, colRef.current.ink)
      download(new Blob([svg], { type: 'image/svg+xml' }), 'grid.svg')
    },
    exportPNG() {
      const cfg = cfgRef.current
      const { w, h } = canvasSize(cfg.cols, cfg.rows, cfg.gap)
      const pg = p5Ref.current.createGraphics(w, h)
      pg.pixelDensity(2); pg.clear()
      for (const rope of ropesRef.current) drawRope(pg, rope.joints, cfg.style, colRef.current)
      drawPaint(pg, paintNodesRef.current, paintEdgesRef.current, cfg, colRef.current)
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
