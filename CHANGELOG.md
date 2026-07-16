# Changelog

All notable changes to this project. Newest first.

## Unreleased

### Changed
- **Edit → Path** now only appears in **Draw** mode (Path reshapes ropes, which only exist in Draw);
  in Paint mode the **Edit** segmented shows just **Off / Sizes**. Switching to Paint while Path is
  active resets Edit to Off. **Mode** now sits above **Line** in the sidebar.
- **Unified Edit control**: the edit tools are now one **Edit** segmented (**Off / Sizes / Path**,
  shortcut **E** cycles them) placed above **Hide guides**. **Sizes** is the per-circle resize
  (formerly the "Edit sizes" toggle); **Path** is the rope-reshape mode (formerly Mode → Edit).
  **Mode** is back to a two-way **Draw / Paint** toggle. Moving a whole rope in **Path** now re-seeds
  it from its translated loop on release, so it deterministically re-wraps the pins now under it.
  The **Line** control now sits above **Mode** in the sidebar, and all ropes render at 50% fill while
  **Path** edit mode is active so the pins under them stay visible.

### Added
- **Smooth joins** (Paint mode, default on): a checkbox that fuses painted connections into a single
  glued object. Each bridge now leaves the pin tangent to its actual boundary — square bridges hug
  the flat edge (concave fillet) and circle necks round out instead of pinching to a point. Turning
  it off restores the plain metaball (inscribed-circle) bridge. Implemented geometrically (`bridge`/
  `smoothBridge`/`nodeBoundary` in `geometry.js`), so both the canvas render and the SVG/PNG export
  stay clean vector.
- **Path editing** (Edit → **Path**): reshape a rope after drawing it. Click a rope to select it
  (dashed outline + vertex handles appear); drag its interior/outline to move the whole loop — it
  re-wraps whatever pins are now underneath — or drag a vertex handle to reshape it. Undo/redo covers
  every edit.
- **Points path tool** (Draw mode only): a new **Line → Freehand/Points** toggle (shortcut **L**).
  **Freehand** is the
  existing click-and-drag stroke; **Points** is a polygon/pen tool — click to drop vertices connected
  by straight edges (a dashed rubber-band previews the next segment), then close the loop by clicking
  the first vertex again or double-clicking. **Esc** cancels an in-progress polygon. The closed loop
  becomes a normal shrink-wrap rope (same physics/export).
- **Keyboard shortcuts** with on-screen badges (an uppercase letter in a small rounded square next to
  each label): **M** Mode, **S** Style, **P** Pin, **E** Edit, **H** Hide guides, **C** Clear,
  **R** Reset, **Ctrl/Cmd+Z** Undo (**Shift** to Redo). Also, holding **Shift** while hovering a pin
  temporarily engages size editing (resize/ignore) without flipping the toggle.
- **Blob spread** slider (Paint mode only): tunes the metaball connection neck — one of the two
  metaball parameters (`v`, the contact-point spread; the other is the fixed handle length). Low =
  thin neck, high = fat bridge.
- **Click-to-connect** in Paint mode: click one pin then click any of its 8 neighbors to link them
  (chains from the last pin); dragging across pins still works. Clicking an armed pin again removes it
  and its links.
- **Paint / Connect mode**: a new **Mode → Draw/Paint** toggle. **Draw** is the existing elastic
  rope; **Paint** interactively connects adjacent pins with smooth **metaball blob** bridges — just
  drag the cursor across neighboring pins and they link up (8-way adjacency, never skipping a cell).
  Nodes and bridges share the same solid ink fill so they read as one connected shape, and blobs are
  included in the SVG (one `<path>` per bridge + `<circle>` per node) and PNG export. Undo/redo is now
  unified across ropes and blobs. (Metaball geometry ported from the paper.js Meta Balls example.)
  - Paint nodes follow the **Pin shape**: with **Pin → Square** they render as rounded squares
    (respecting the Corner radius) both on canvas and in the SVG (`<rect rx>`) / PNG export.
  - **Yellow hover** highlight on the pin under the cursor in Paint mode.
  - **Tap to remove**: clicking an already-painted pin (without dragging) removes it and every
    link touching it (undoable).
- **Eased style switch & filled stroke in export**: the Filled/Outline crossfade now uses a
  smoothstep easing, and exporting a **Filled** rope includes the matching `stroke` in the SVG
  (so the vector matches the on-canvas render exactly).
- **Animated style switch**: toggling **Style → Filled/Outline** now crossfades the rope's
  opacity (the old style fades out while the new one fades in) instead of switching instantly.
- **Animated Corner radius reveal**: the **Corner radius** slider now slides/fades in and out
  (max-height + opacity) when toggling **Pin → Square/Circle**, instead of appearing abruptly.
- **Adjustable square corner radius**: with **Pin → Square**, a **Corner radius** slider (20–100%)
  appears below the Pin control and drives both the guide squares' corners and the rope collision
  (20% = mild rounding, 100% = fully rounded). The **Size** slider was renamed from "Circle size".
- **Square pins shape the rope**: with **Pin → Square**, the rope physics now collides with a
  rounded-square pole (flat edges at the radius, softly rounded corners matching the guide) instead
  of a circle, so the wrapped contour follows the square shape. Circle mode is unchanged.
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
- Paint hover now fills the pin **solid accent yellow** (`#ffc800`, eased) instead of drawing a ring; the armed
  pin is fully accent. Segmented controls (Mode/Style/Pin) are a fixed **140px** with equal-width
  options. The Filled/Outline crossfade is **faster**.
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
