# G_connect

A generative drawing tool over a grid of pins. You drag a loop around the
circles and a **rubber band** molds tightly to them (arcs glued to each circle +
straight tangent lines) — inspired by [Rogo](https://github.com/Jakob-Bock/Rogo).
The whole window is an infinite-style canvas you can **pan and zoom** (the content
flows under the sidebar, never cropped), and each circle can be **resized
independently** or **ignored**. Exports as a clean **SVG** and a 2x **PNG**
with a transparent background.

Follows the visual style guide of [grid-gen-2](https://github.com/pedroleitin/grid-gen-2)
(colors, Outfit / Ubuntu Mono fonts, dot pattern).

## Stack

- **React 19** + **Vite 6**
- **Tailwind CSS v4** (`@tailwindcss/vite` plugin, tokens via `@theme`)
- **p5.js** (canvas, via npm)

## How to run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
npm run preview  # serve the build
```

## Structure

```
index.html                 # Vite entry (mounts #root)
vite.config.js             # react() + tailwindcss() plugins
src/
  main.jsx                 # ReactDOM root
  index.css                # @import tailwind + @theme (design tokens) + base styles
  App.jsx                  # state (grid, size, spacing, tension, style, shape)
  components/
    Sidebar.jsx            # controls (Tailwind)
    GridCanvas.jsx         # p5 inside a component + rope physics + export
  lib/
    geometry.js            # grid, Catmull-Rom spline, SVG generation
assets/                    # reference images
```

## How it works

- **Pins (poles):** the grid circles. The rope collides with them and is pushed out to their
  real edge (radius = that circle's diameter / 2). Each pin can have its own diameter (see
  **Edit sizes**), so the collision radius is per-pin.
- **Drawing:** draw a **loop around** the circles you want to wrap (robust pointer capture with
  `setPointerCapture`). On release the loop is stored (in grid coords) and becomes a closed **ring
  of spring joints** (`seedJoints`).
- **Elastic shrink-wrap (physics):** the ring's springs have a tiny rest length, so it contracts;
  the pins push any joint that enters them back to their edge (`stepRope`). The rope therefore
  snaps tightly around the enclosed circles, producing clean geometric shapes — exactly like an
  elastic band around pegs (Rogo model). The simulation runs each frame while it's settling and
  freezes when calm, waking again on any change. Rendered as a closed Catmull-Rom spline.
- **Deterministic re-settle:** on a **spacing or circle-size** change, each rope is re-seeded from
  its original drawn loop (remapped to the new pitch) and re-settled. This makes the shape a pure
  function of *(loop, spacing, size, tension)* — changing values and reverting gives the identical
  shape, and the loop always re-encloses the same pins, so shrinking circles never lets a pin slip
  out (no drift or topology loss).
- **Canvas sizing:** each pin owns a **fixed-size container** (`CELL` in `geometry.js`, equal to
  the circle-size slider max). The circle grows **inside its own container**, so changing the
  circle size never moves neighbors nor resizes the canvas. **Spacing** is the gap between
  containers, so increasing it **grows the canvas** and nothing gets clipped (the rope joints are
  remapped to the new pitch). The canvas also grows with columns/rows.
- **Pan & zoom:** the whole window is the drawing surface — the canvas spans the full viewport
  behind the opaque sidebar, so content pans/zooms **under it** and is never cropped at its edge.
  **Pan** with scroll, Space+drag or middle-button drag; **zoom** with Ctrl/Cmd+scroll or trackpad
  pinch. A floating zoom box (bottom-right) has a pan (hand) toggle, − / + zoom, a clickable **%**
  label and a fit/reset button. Fit/zoom stay centered on the visible area (right of the sidebar);
  the view auto-fits and re-centers when the grid grows, until you take over. A single dotted
  background covers the whole page and pans/zooms with the content (seamless across the sidebar
  edge). The view transform is render-only: physics and export stay in world coordinates, so zoom
  never affects the exported SVG/PNG.
- **Per-circle size (Edit sizes):** toggle **Edit sizes**, hover a circle to reveal a drag handle
  on its edge, and drag to set that circle's diameter (it grows inside its own container, so
  neighbors don't move). The physics and export respect the per-circle sizes. In Edit mode you can
  also click a circle's center **X** to **ignore** it (turns red, skipped by the rope); **Reset**
  clears all sizes and ignore flags.

### Controls (Sidebar)

- **Columns / Rows** — grid size (grows the canvas).
- **Size** — pin diameter; grows within its container without moving neighbors or resizing the canvas.
- **Spacing** — gap between containers (grows the canvas so nothing is clipped).
- **Rope tension** — settle tightness (100 = loose/round wrap, 200 = tight/glued to the circles).
- **Style** — Filled (blob) or Outline (line); switching crossfades the rope's opacity.
- **Pin** — Circle or Square. The rope collides with the chosen shape (a circle, or a
  rounded square with flat edges), so the wrap follows it.
- **Corner radius** (Square only) — 20–100% control for the squares' corner rounding, driving both
  the guides and the rope contour (20% = mild rounding, 100% = fully rounded); the slider slides
  and fades in/out when toggling the Pin shape.
- **Hide guides** — draw without the pin dots showing (animated fade).
- **Edit sizes** — resize each circle independently by dragging its edge handle.
- **Undo / Redo** — floating icon buttons at the bottom-left of the canvas; **Clear** in the sidebar.
- **Export SVG / PNG** — icon buttons centered at the bottom of the canvas.

## Export

- **SVG:** one Catmull-Rom `<path>` per rope (filled or stroked). No guide circles,
  no filters — clean vector.
- **PNG:** rendered at 2x, transparent background.

## Rope physics (`lib/geometry.js`)

| Function          | Role                                                            |
| ----------------- | -------------------------------------------------------------- |
| `pins` / `sizeOf` | pin centers with a **per-pin radius** (per-circle size override or the global `cellSize`) |
| `seedJoints`      | resample the drawn loop into an evenly spaced ring of joints    |
| `stepRope`        | one physics frame: ring springs + pole collisions + bounds      |
| `calmFor`         | Tension slider (100..200) → settle tightness (freeze threshold; higher = tighter) |
| `splineSegments`  | closed Catmull-Rom through the settled joints (render/export)   |

## Backlog & changelog

- Planned work: [`BACKLOG.md`](BACKLOG.md)
- Change history: [`CHANGELOG.md`](CHANGELOG.md)
