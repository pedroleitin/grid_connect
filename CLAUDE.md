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

- `src/App.jsx` — state owner: `cols, rows, cellSize, gap, tension, style, shape`, plus
  `hideGuides`, `editMode`, `darkMode`. Passes everything to `Sidebar` and `GridCanvas`; actions
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
  `style` = `fill` | `stroke`.
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
