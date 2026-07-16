# CLAUDE.md — G_connect

Project instructions for Claude Code. The user's global preferences still apply.

## What it is

A generative grid drawing tool. The user traces a path over the pins to connect them and a
**capsule-chain band** molds tightly to them ([Rogo](https://github.com/Jakob-Bock/Rogo)
style). Visuals follow [grid-gen-2](https://github.com/pedroleitin/grid-gen-2).

## Stack and execution

- **React 19 + Vite 6 + Tailwind v4 + p5.js** (p5 via npm).
- Run: `npm run dev` (port 5173). Build: `npm run build`.
- Tailwind v4: no `tailwind.config`; tokens in `@theme` in `src/index.css`
  (utilities `bg-panel`, `text-ink`, `border-line`, `font-mono`, etc.).

## Architecture

- `src/App.jsx` — state owner: `cols, rows, cellSize, gap, tension, mode, style, shape, cornerRadius`,
  plus `hideGuides`, `editMode`, `darkMode`. Passes everything to `Sidebar` and `GridCanvas`; actions
  (undo/clear) via `ref`; **Export SVG/PNG** is a floating bar centered at the bottom of the canvas.
- `src/components/GridCanvas.jsx` — p5 as an instance inside `useEffect`.
  - Current config mirrored in `cfgRef` (the p5 loop reads `cfgRef.current`, not props).
  - Ropes in `ropesRef` as **physics rings** (`{ loop: [{gx,gy}], joints: [{x,y,vx,vy}] }`); `loop`
    is the original drawn path in grid coords (for deterministic re-seeding), `joints` is the live
    ring. Loop being drawn in `curRef` (raw points) — **refs**, to avoid re-rendering per point.
    `simRef.active` gates the physics loop (runs while settling, freezes when calm; `wake()`
    re-activates on draw/undo/clear/config change). `reseed()` rebuilds joints from `loop` at the
    current pitch on spacing/size changes → deterministic shape, no drift.
  - **Pointer input** (`pointerdown/move/up` + `setPointerCapture`, coords via
    `getBoundingClientRect`). Do NOT use `p.mouseX/mouseY` (it reported spurious points at (0,0)
    in real drags → "fan of lines").
  - **Path tool** (`drawTool`/`drawToolRef`, `'free'|'points'`, Draw mode only; **Line** segmented in
    the sidebar). `'free'` is the freehand `curRef` stroke. `'points'` is a polygon/pen tool:
    `pointsDown(w)` drops vertices into `polyRef` (grid-agnostic world pts), `polyCursorRef` drives the
    dashed rubber-band, close via `closePolygon()` (click first vertex when len≥3, or `dblclick`;
    `polyClosedAtRef` guards the double-click's stray second down). `polyNearFirst(w)` sets the cursor.
    **Esc** cancels. `closePolygon` appends `poly[0]` to seal the seam, then `seedJoints(pts,10)` → a
    normal shrink-wrap rope (`loop` in grid coords, same as freehand). Anything referenced in `p.draw`
    must be inlined or outer-scoped — helpers defined inside `p.setup` are NOT visible in `p.draw`.
  - **Path editing** (`mode='edit'`, driven by the **Edit → Path** control; `editModeRef`/`editMode`
    is the **Edit → Sizes** circle-resize tool — both fed from App's `editTool` `'off'|'sizes'|'path'`,
    mapped to `mode={editTool==='path'?'edit':mode}` and `editMode={editTool==='sizes'}`):
    reshape a settled rope. `editRopeRef` = selected rope, `editDragRef` = active drag. `editDown`
    hit-tests: a loop vertex of the selected rope (`vertexIndexAt`, handles only for loops ≤
    `EDIT_HANDLE_MAX`), else the topmost rope under the cursor (`ropeAt` = `pointInPoly` on `joints`
    OR near an edge via `distToPolyEdges`) → selects + starts a **move** drag; empty space deselects.
    `editMove` **move** translates all `joints` (live, smooth) and the `loop` (grid coords) by the
    cursor delta; **vertex** rewrites `loop[i]` (mirroring the closed seam) then `reseedRope`. `editUp`
    **re-seeds a moved rope from its translated `loop`** (so it deterministically re-wraps the pins now
    under it instead of snapping back), then pushes `{kind:'edit', rope, before, after}` (loop
    snapshots); `applyAction` restores the loop and `reseedRope`s. `p.draw` renders the selected rope's
    dashed outline + vertex handles (inline math — no `p.setup` helpers).
  - **Pan/zoom** is a render-only view transform in `viewRef` (`{scale, tx, ty}`; screen = world *
    scale + t). Physics and export stay in **world coords**, so zoom never affects the SVG/PNG.
    The canvas spans the **full viewport** (behind the opaque sidebar); a `leftInset` prop (the
    sidebar width) keeps `fit()`/zoom centered on the visible area, so content pans/zooms **under
    the sidebar** without being cropped. `fit()` fits+centers (auto until `touchedRef` is set, and
    on grow). A single **fixed full-page dotted layer** (`bgRef`, `.canvas-bg`) sits behind
    everything and is offset by the holder's page position, so the dots are seamless across the
    sidebar edge and pan/zoom uniformly (`applyBg`). Zoom box overlay + pan (hand) tool
    (`panToolRef`/`panTool`); undo/redo bar offset by `leftInset`.
  - **Per-circle sizes** live in `sizesRef` (a `Map` of `"r,c" -> diameter`) mirrored into
    `cfgRef.current.sizes`. **Edit mode** (`editModeRef`) disables drawing: hovering a pin
    (`hoverPinRef` via `pinAt`) shows a drag handle; dragging (`dragPinRef`, `resizePin`) sets that
    circle's diameter from the cursor distance to its center. `geometry.sizeOf(cfg,r,c)` returns the
    override or the global `cellSize`.
  - Actions exposed via `useImperativeHandle`.
- `src/lib/geometry.js` — pure geometry + `buildSVG`. Shared between render and export.

## Important concepts

- **Canvas sizing:** each pin owns a fixed-size container (`CELL` in `geometry.js`,
  equal to the circle-size slider max). `cellSize` grows the circle **inside its container**
  — it never moves neighbors nor resizes the canvas. `gap` (spacing) is the gap between
  containers, so it **does resize the canvas** (grows with cols/rows too), and nothing gets clipped.
  On a spacing/size change each rope is re-seeded from its stored drawn loop (grid coords) at the
  new pitch and re-settled — deterministic shape, no drift or topology loss.
- **Elastic shrink-wrap (physics, Rogo model):** the drawn loop becomes a closed ring of spring
  joints (`seedJoints`). The springs have a tiny rest length (`REST_LENGTH=3`) so the ring
  contracts; each pin pushes any joint inside it back to its edge (per-pin radius — `pins()` returns
  `{x, y, r}`, `r` from `sizeOf/2`). `stepRope()` runs `SUBSTEPS` spring+collision+bounds iterations
  per frame; the rope snaps tightly around the enclosed circles (clean geometric shapes). It runs
  while `simRef.active` and freezes when the max joint speed drops below `calmFor(tension)`; any change
  calls `wake()`. Pins listed as ignored (`cfg.ignored`) are skipped by `pins()`, so the rope passes
  through them.
- **Tension → tightness:** spring stiffness is a fixed `STIFFNESS` (fast, stable convergence). The
  slider controls `calmFor(tension)` — the speed threshold at which the sim freezes: higher tension =
  lower threshold = the ring settles later and hugs tighter (100 ≈ loose/rounded, 200 ≈ glued).
- **Render:** closed Catmull-Rom spline (`splineSegments`) through the settled joints,
  `style` = `fill` | `stroke`. Square pins use a `cornerRadius` (20–100%) that drives both the guide
  rect corners and the rounded-square collision. Switching `style` crossfades the rope opacity
  (`styleAnimRef`: draws the old + new style with `1-t`/`t` alpha as `t` ramps 0→1); the Corner
  radius slider itself slides/fades via the `.collapse-row` CSS class (not Tailwind's `.collapse`).
- **Paint mode (`mode='paint'`):** `modeRef` gates pointer handling. Connect neighbors with
  **metaball blob** bridges — by dragging across pins (`paintVisit`) or by click-to-click
  (`paintTap`: click one pin, then a neighbor to link + re-arm for chaining; click the armed pin
  again to remove it). `paintNodesRef` (Set of `"r,c"`) + `paintEdgesRef` (Set of sorted `"ka|kb"`
  from `edgeKey`); `adjacentCells` (8-way) gates links so you can't skip a cell; `paintSelRef` holds
  the armed pin. `metaball(c1,r1,c2,r2,v,handleRate)`/`metaballPathD()` in `geometry.js` (paper.js
  Meta Balls port) build the Bézier bridge — `v` (contact-point spread) is exposed as the **Blob
  spread** slider (`cfg.blob`), `handleRate` is fixed. **Smooth joins** (`cfg.smoothJoins`, default
  true, Sidebar checkbox) swaps the bridge builder via `bridge(c1,r1,c2,r2,cfg)`: on → `smoothBridge`
  (contacts on the pin's real boundary via `nodeBoundary`, handles along the edge tangent → squares
  hug the flat edge, circle necks round out); off → plain `metaball`. `drawPaint()` renders bridges (`bezierVertex`)
  + nodes with the same solid ink so they union — nodes follow the Pin shape (rounded `rect` for
  squares). `removeNode` deletes a node + its links; `paintHoverRef` + `paintAnimRef` ease the pin's
  **fill** toward accent on hover/arm (no ring). Undo/redo is unified in `histRef`/`redoRef` as
  actions `{kind:'rope'|'paint', ...}` (paint removals use an `inverse` flag); `buildSVG` takes
  `(ropes, paint, cfg, ink)` and both exports include the blobs. Filled ropes/exports carry a
  matching `stroke`; the style crossfade uses `easeInOut` (fast).
- **Keyboard shortcuts** (App-level `keydown` effect, ignores form fields): **M** Mode (Draw/Paint),
  **L** Line, **S** Style, **P** Pin, **E** Edit (cycles Off→Sizes→Path), **H** Hide guides,
  **C** Clear, **R** Reset, **Ctrl/Cmd+Z** Undo
  (**Shift** Redo). Each label shows a `Kbd` badge (`.kbd` in `index.css`); segmented controls are a
  fixed **140px** with equal-width options (the **Edit** segmented uses a `width={210}` override).
  Holding **Shift** sets `shiftRef` in `GridCanvas`, which
  makes `isEdit()` (`editModeRef || shiftRef`) true — a transient Edit-sizes override while hovering a
  pin (recomputes hover from `lastEvtRef` on keydown; clears hover/drag + resets cursor on keyup).
- **StrictMode:** the mount effect creates/cleans up the p5 (`p5Ref.current.remove()`). Do not create
  multiple instances.

## When editing the code

- When changing geometry (size/spacing/grid), make sure **the ropes stay glued to the circles**
  and that the **circle size does not resize the canvas** (only spacing and cols/rows change it).
- The rope must never collapse or leak inside a pin: pins push joints out to radius `cellSize/2`;
  the spring rest length keeps it contracting so it hugs the enclosed circles.
- Check in the browser (headless/preview): the rope should hug the circles it wraps,
  and exporting SVG should generate one `<path>` per rope, without guide circles.
- Keep `geometry.js` as the single source of geometry (render and export use the same functions).

## Backlog & changelog

Planned work is tracked in `BACKLOG.md`; change history in `CHANGELOG.md`.
