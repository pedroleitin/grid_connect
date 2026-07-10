# Copilot — G_connect

A generative grid drawing tool: the user draws a loop around the circles and an
**elastic rope** shrink-wraps tightly around them (Rogo style). The canvas fills the whole
viewport (content pans/zooms under the sidebar, uncropped); circles can be resized independently
or ignored (Edit sizes). Exports SVG/PNG.

## Stack

- **React 19 + Vite 6 + Tailwind CSS v4 + p5.js**.
- Tailwind v4 **without config**: tokens in `@theme` (`src/index.css`) → utilities
  `bg-panel`, `text-ink`, `border-line`, `bg-accent`, `font-mono`, etc.
- p5 via npm. Run: `npm run dev`.

## Structure

- `src/App.jsx` — central state: `cols, rows, cellSize, gap, tension, style, shape, cornerRadius`,
  plus `hideGuides`, `editMode`, `darkMode`.
- `src/components/Sidebar.jsx` — controls (`Slider`, `Segmented`, `Checkbox` components).
- `src/components/GridCanvas.jsx` — p5 in `useEffect`; pan/zoom view transform; rope physics;
  per-circle sizing (Edit mode); export via `ref`.
- `src/lib/geometry.js` — geometry + `buildSVG` (single source, used by render and export).

## Conventions / rules

- **State used by the p5 loop goes in a `ref`** (`cfgRef`, `ropesRef`, `curRef`, `simRef`), not in
  state, to avoid re-rendering per point or losing the drawing. Props sync `cfgRef` in an effect.
- **Input via Pointer Events** (`pointerdown/move/up`, `setPointerCapture`, coords via
  `getBoundingClientRect`). Do NOT use `p.mouseX/mouseY` (produces spurious points in real drags).
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
- UI language and comments: **English**. Smallest change that respects the existing style.
