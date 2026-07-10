# Changelog

All notable changes to this project. Newest first.

## Unreleased

### Added
- **Full-viewport canvas**: the drawing surface now spans the whole window (behind the opaque
  sidebar), with a left inset that keeps the fit/zoom centered on the visible area. Content pans
  and zooms **under the sidebar** seamlessly instead of being hard-cropped at its edge.
- **Seamless page dots**: a single fixed dotted background covers the whole page and pans/zooms
  with the content, so the pattern is continuous across the sidebar/canvas edge (previously two
  misaligned layers left a visible seam).
- **Ignore circles** (Edit mode): each pin shows a center **X** on hover; click it to mark
  the circle ignored — it turns reddish and is skipped by the rope physics, so drawings pass
  through it. Click again to re-enable it.
- **Edit mode** now lets a circle grow up to **300px** (beyond its container), the guides
  render **on top** of the drawings with **animated dotted borders**, and each pin fades from
  50% to 100% opacity on hover.
- **Undo / Redo** floating bar (bottom-left of the canvas, same style as the zoom box) with
  icon buttons that disable when there's nothing to undo/redo. Undo moved out of the sidebar
  (which now keeps only **Clear**).
- **Edit sizes** mode: a sidebar toggle that lets you resize each circle independently.
  Hover a circle to reveal a drag handle on its edge and drag to set its diameter (it grows
  inside its own container, so neighbors don't move). The rope physics and SVG/PNG export
  respect the per-circle sizes.
- **Content stays centered & fits** when the grid grows: changing columns/rows/spacing now
  re-fits the content centered (auto-reducing zoom so it always fits on screen) and grows from
  the middle instead of the top-left origin — even after you've panned or zoomed.
- **Zoom box + bar sliders ported from DRAW_GRID** (pedroleitin/SVG_DRAW): a solid floating
  zoom pill (bottom-right, same panel style as the sidebar) with a **pan** toggle (hand), −/+
  zoom, a clickable **%** label and a **fit/reset** button; and tall **bar sliders** (`.rng`)
  with the label and value inside the pill and a dark fill showing the value (text painted
  twice for contrast).
- **Infinite-style canvas**: the whole background area is now the drawing surface (no more
  small fixed region). **Pan** with scroll / Space+drag / middle-button drag, and **zoom** with
  Ctrl/Cmd+scroll or trackpad pinch. On-canvas **+ / − / %** controls zoom and reset (fit). The
  dotted background pans and zooms with the content; the view auto-fits until you take over.
- **grid-gen-2 UI**: fixed rounded sidebar panel, custom pointer-driven sliders, toggle
  (Hide guides) and segmented (Style/Pin) controls, `btn-menu` action buttons, and a dotted
  `canvas-bg` background. Fonts: Outfit + Ubuntu Mono.
- **Light/dark theme** toggle (sun/moon button): `[data-theme]` CSS-variable palette mapped to
  the Tailwind `@theme` tokens, so the whole UI and the canvas pins/ropes recolor.
- **Hide guides** toggle to draw without the pin dots showing.
- Elastic **rope physics** (Rogo model): a drawn loop becomes a closed ring of spring joints
  that contracts and shrink-wraps the enclosed pins, which push it out to their real edge.
- **Deterministic re-settle**: ropes store their original drawn loop (in grid coordinates) and
  are re-seeded from it on spacing/size changes, so the shape is a pure function of
  *(loop, spacing, size, tension)* — reverting values reproduces the identical shape.

### Changed
- **Renamed** to **G_connect** (sidebar title and page title); dropped the "freehand" tag.
- **Zoom + undo/redo buttons** now fill **yellow** (`#ffc800`) on hover, matching the accent used
  by the toggles and segmented controls.
- **Export buttons** moved out of the sidebar into a floating bar centered at the bottom of the
  canvas, shown as **download-icon** buttons (SVG / PNG), no background on the bar.
- **Sidebar polish**: bar sliders now animate — a subtle resting state (dimmed track/fill, dark
  label) that fills in on hover, where the light value label fades in; removed the dividers between
  menu items. The **Style/Pin** controls are now joined pill segmented controls (light pill with a
  dark rounded selected segment); checkboxes use a 4px ring; slider values drop the `px` suffix; the
  help text sticks to the bottom of the sidebar.
- **Circle size** max raised to **200** (`CELL` container grown to match).
- **Hide guides** now animates: the pin dots fade in/out instead of snapping.
- Canvas model: each pin owns a **fixed-size container** (`CELL`). Circle size grows inside its
  container without moving neighbors or resizing the canvas; **spacing** and columns/rows grow
  the canvas so nothing gets clipped.
- Slider ranges: circle size **35–200** (up to **300** in Edit mode), rope tension **100–200**;
  higher tension settles tighter.
- Rope no longer drifts or loses pins when changing spacing/size (fixed elasticity error by
  re-seeding from the original loop instead of continuing from the settled state).
- Full project translated to **English** (UI, comments, README, docs, `index.html` lang).

### Fixed
- **Rope now hugs the circles reliably** at any size. Spring stiffness is fixed (fast, stable);
  the **Rope tension** slider maps to the freeze threshold (`calmFor`) instead of stiffness, so a
  higher tension always settles tighter (previously the wrap froze early with slack and the slider
  only helped by accident).
- Spurious "fan of lines" on real drags — input now uses Pointer Events with `setPointerCapture`
  and `getBoundingClientRect` instead of `p.mouseX/mouseY`.

### Docs
- Split **Backlog** into `BACKLOG.md` and added this `CHANGELOG.md`.
