# Copilot — G_connect

A generative grid drawing tool: the user draws a loop around the circles and an
**elastic rope** shrink-wraps tightly around them (Rogo style). The canvas fills the whole
viewport (content pans/zooms under the sidebar, uncropped); circles can be resized independently
or ignored (Edit → Sizes). Exports SVG/PNG.

## Stack

- **React 19 + Vite 6 + Tailwind CSS v4 + p5.js**.
- Tailwind v4 **without config**: tokens in `@theme` (`src/index.css`) → utilities
  `bg-panel`, `text-ink`, `border-line`, `bg-accent`, `font-mono`, etc.
- p5 via npm. Run: `npm run dev`.

## Structure

- `src/App.jsx` — central state: `cols, rows, cellSize, gap, tension, mode, style, shape, cornerRadius`,
  plus `hideGuides`, `editMode`, `darkMode`.
- `src/components/Sidebar.jsx` — controls (`Slider`, `Segmented`, `Checkbox` components).
- `src/components/GridCanvas.jsx` — p5 in `useEffect`; pan/zoom view transform; rope physics;
  per-circle sizing (Edit mode); Paint-mode metaball blobs; export via `ref`.
- `src/lib/geometry.js` — geometry + `buildSVG` (single source, used by render and export).

## Conventions / rules

- **State used by the p5 loop goes in a `ref`** (`cfgRef`, `ropesRef`, `curRef`, `simRef`), not in
  state, to avoid re-rendering per point or losing the drawing. Props sync `cfgRef` in an effect.
- **Input via Pointer Events** (`pointerdown/move/up`, `setPointerCapture`, coords via
  `getBoundingClientRect`). Do NOT use `p.mouseX/mouseY` (produces spurious points in real drags).
- **Path tool** (`drawTool`/`drawToolRef`, `'free'|'points'`, Draw mode only; **Line** segmented, kbd **L**).
  `'free'` = freehand `curRef` stroke; `'points'` = polygon/pen: `pointsDown` fills `polyRef` (world
  pts), `polyCursorRef` = rubber-band, `closePolygon()` on first-vertex click (len≥3) or `dblclick`
  (`polyClosedAtRef` guards the stray second down), `polyNearFirst` sets cursor, **Esc** cancels;
  `closePolygon` seals the seam then `seedJoints(pts,10)` → normal rope. Helpers defined in `p.setup`
  are NOT visible in `p.draw` — inline or outer-scope anything used in `p.draw`.
- **Path editing** (`mode='edit'`, from the **Edit → Path** control; **Edit → Sizes** is `editModeRef`
  circle-resize — App keeps a single `editTool` `'off'|'sizes'|'path'` mapped to
  `mode={editTool==='path'?'edit':mode}` + `editMode={editTool==='sizes'}`): reshape a settled rope.
  `editRopeRef`=selection, `editDragRef`=active drag. `editDown` hits a loop vertex of the selected
  rope (`vertexIndexAt`, handles for loops ≤ `EDIT_HANDLE_MAX`) else the topmost rope under the cursor
  (`ropeAt` = `pointInPoly` on `joints` OR near edge via `distToPolyEdges`) → move drag; empty
  deselects. `editMove` move = translate `joints` + `loop` by the cursor delta; vertex = rewrite
  `loop[i]` (mirror closed seam) then `reseedRope`. `editUp` **re-seeds a moved rope from its
  translated `loop`** (deterministic re-wrap) then pushes `{kind:'edit', rope, before, after}` (loop
  snapshots); `applyAction` restores + `reseedRope`s. Mode is a 2-way segmented (Draw/Paint); **M**
  toggles it. **Edit** is a separate 3-way segmented (Off/Sizes/Path, `width={210}`); **E** cycles it.
- **Pan/zoom** is a render-only view transform in `viewRef` (`{scale, tx, ty}`); physics and export
  stay in world coords so zoom never affects the SVG/PNG. The canvas spans the **full viewport**
  behind the opaque sidebar; a `leftInset` prop keeps `fit()`/zoom centered on the visible area so
  content pans/zooms **under the sidebar** uncropped. `fit()` fits+centers (auto until touched,
  and when the grid grows); a single **fixed full-page dotted layer** (`bgRef`, `.canvas-bg`)
  behind everything, offset by the holder's page position (`applyBg`), so dots are seamless and
  pan/zoom uniformly; zoom box overlay + pan (hand) tool.
- **Per-circle sizes** in `sizesRef` (`Map "r,c" -> diameter`) mirrored into `cfgRef.current.sizes`;
  `geometry.sizeOf(cfg,r,c)` returns the override or global `cellSize`. **Edit mode** (`editModeRef`)
  disables drawing: hover a pin (`pinAt` → `hoverPinRef`) to show a handle, drag (`dragPinRef`,
  `resizePin`) to set its diameter. `pins()` returns `{x,y,r}` — collision radius is **per-pin**.
- **Canvas sizing:** each pin has a fixed-size container (`CELL` in `geometry.js`, = circle-size
  slider max). `cellSize` grows the circle inside its container (no neighbor move, no canvas resize);
  `gap` (spacing) and cols/rows resize the canvas via `canvasSize(cols, rows, gap)`, so nothing clips.
  On a spacing/size change each rope is re-seeded from its stored drawn loop (grid coords) and
  re-settled — deterministic shape, no drift/topology loss.
- **Elastic shrink-wrap (physics, Rogo model):** the drawn loop becomes a closed ring of spring
  joints (`seedJoints`). Springs have a tiny rest length (`REST_LENGTH`) so the ring contracts; each
  pin pushes joints inside it back to its edge (per-pin radius). `stepRope` runs `SUBSTEPS`
  spring+collision+bounds iterations per frame → the rope snaps tightly around the enclosed circles.
  It runs while `simRef.active`, freezes when max speed < `calmFor(tension)`; `wake()` re-activates on
  any change. Spring stiffness is a fixed `STIFFNESS`; the slider maps to `calmFor(tension)` (the
  freeze threshold): higher tension = later freeze = tighter hug (100 loose → 200 glued). Pins in
  `cfg.ignored` are skipped by `pins()`.
- **Render/Export:** closed Catmull-Rom spline through the settled joints; SVG = one `<path>` per
  rope (fill or stroke), no guide circles or filters; PNG at 2x transparent. Square pins use a
  `cornerRadius` (20–100%) for both the guide rects and the rounded-square collision. Switching
  `style` crossfades the rope opacity (`styleAnimRef`, old+new drawn at `1-t`/`t`); the Corner radius
  slider slides/fades in via `.collapse-row` (avoid Tailwind's `.collapse` = `visibility: collapse`).
- **Paint mode (`mode='paint'`, `modeRef`):** connect neighbors with metaball **blob** bridges by
  dragging over pins (`paintVisit`) or click-to-click (`paintTap`: click a pin then a neighbor to
  link + re-arm; click the armed pin again to remove). `paintNodesRef` (Set `"r,c"`) + `paintEdgesRef`
  (Set of sorted `"ka|kb"` via `edgeKey`); `adjacentCells` (8-way) blocks skipping a cell;
  `paintSelRef` = armed pin. `metaball(c1,r1,c2,r2,v,handleRate)`/`metaballPathD` (paper.js Meta Balls
  port) build the Bézier bridge — `v` = **Blob spread** slider (`cfg.blob`), `handleRate` fixed.
  **Smooth joins** (`cfg.smoothJoins`, default false, Sidebar checkbox) picks the bridge builder via
  `bridge(c1,r1,c2,r2,cfg)`: on → `smoothBridge` (contacts on the pin's real boundary via
  `nodeBoundary`, tangent-aligned handles → squares hug the flat edge, circle necks round out); off →
  plain `metaball`. `drawPaint` renders bridges + nodes with the same solid ink so they union — nodes follow the Pin
  shape (rounded rect for squares). `removeNode` deletes a node + its links; `paintHoverRef` +
  `paintAnimRef` ease the pin **fill** toward accent on hover/arm (no ring). Undo/redo unified in
  `histRef`/`redoRef` (`{kind:'rope'|'paint'}`, removals use `inverse`); `buildSVG(ropes, paint, cfg,
  ink)` and both exports include the blobs. Filled ropes/exports carry a matching `stroke`; the style
  crossfade uses `easeInOut` (fast).
- **Keyboard shortcuts** (App `keydown`, ignores form fields): **M/S/P** toggle Mode/Style/Pin,
  **L** toggle Line (Freehand/Points), **E** cycle Edit (Off→Sizes→Path), **H** toggle Hide guides,
  **C** Clear, **R** Reset,
  **Ctrl/Cmd+Z** Undo (**Shift** Redo).
  Labels show a `Kbd` badge (`.kbd`); segmented controls are **140px** with equal-width options
  (Edit uses `width={210}`).
  Holding **Shift** (GridCanvas `shiftRef`) makes `isEdit()` true — a transient Edit-sizes override
  while hovering a pin (recomputes hover from `lastEvtRef`; clears on keyup).
- UI language and comments: **English**. Smallest change that respects the existing style.
