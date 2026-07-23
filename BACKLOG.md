# Backlog / next steps

- [x] Independent size and spacing sliders.
- [x] Fixed canvas by columns/rows (size/spacing don't resize the canvas; drawings preserved).
- [x] **UI matching grid-gen-2** (fixed rounded sidebar, custom sliders, toggle/segmented
  controls, `btn-menu` buttons, dotted `canvas-bg`, Outfit/Ubuntu Mono).
- [x] **Per-circle size** mode ("Edit sizes"): resize individual circles independently —
  hover a circle to reveal a drag handle on its edge; drag to set its diameter (inside its
  own container, so neighbors don't move). Physics + export respect the per-circle sizes.
- [x] **Squares** mode: with **Pin → Square**, the rope collides with a rounded-square pole
  (flat edges, softly rounded corners matching the guide), so the wrap follows the square shape.
  A **Corner radius** slider (20–100%) controls the rounding of both guides and the rope contour.
- [x] **Randomize — Symmetry** (Off / H / V / Radial): mirror the generated shapes across the grid's
  center axes; each reflection is its own shape and mirroring happens after carving so halves match.
  Works in Draw and Paint, refines live.
- [ ] **Erase** tool: remove drawn ropes (or parts of them) directly on the canvas.
- [x] **Select mode** (Mode → Select): a third Mode, hybrid of Draw and Paint. Click pins in
  sequence to chain them; the band wraps them live using the same shrink-wrap physics as Draw, so it
  hugs the pins cleanly and follows the path's bends without self-intersecting artifacts (order badges
  shown while chaining; the preview is the settling rope). Double-click/Enter commits, Esc cancels.
  Belt re-seeds from the pin chain, respects Symmetry, and exports like any rope.
- [ ] **Select mode — refinements** (planned): keep improving the Select wrap. Ideas: restore a
  distinct **revisit-a-pin → wrap outside** behavior on top of the physics model, tighter/looser band
  control, and smoother handling of very tight/winding chains.
- [x] **Mode-aware controls**: hide/disable controls that don't apply to the current Mode. **Style**
  is hidden in Paint (shown in Draw/Select), **Line** and **Rope tension** only in Draw, **Blob
  spread / Smooth joins / Diagonals** only in Paint, **Edit → Path** only in Draw.
- [ ] **Presets**: save/load named configurations (grid, sizes, style, mode, drawings).
- [x] **History dock**: a floating image button (right of the sidebar, vertically centered)
  saves the current drawing (ropes + paint + per-circle sizes/ignored + full config) and an
  SVG preview into a dock fixed beside the sidebar; snapshots persist in localStorage. Clicking
  a preview restores that drawing; hover reveals a delete button. Opening the dock re-fits and
  recenters the canvas so it stays fully visible.
- [x] **Edit drawing** (Mode → Edit): reshape an existing rope — click it to select (dashed
  outline + vertex handles), drag its interior/outline to move the whole loop (re-wraps whatever
  pins are now underneath), or drag a vertex handle to reshape. Undo/redo covers edits.
- [x] **Points path tool** (Line → Freehand/Points, shortcut **L**): a polygon/pen alternative to freehand
  drawing — click vertices joined by straight edges (dashed rubber-band preview), close by
  clicking the first vertex or double-clicking; **Esc** cancels. Closed loops become normal
  shrink-wrap ropes.
- [x] **Ignore** circles: in Edit mode, click the center **X** of a pin to mark it ignored
  (reddish); ignored pins are skipped by the physics so the rope passes through them.
- [x] **Hide guides** toggle (draw without the pin dots showing).
- [x] **Paint** mode (Draw/Paint toggle): interactively connect adjacent pins with smooth
  metaball **blob** bridges by dragging the cursor across neighbors (8-way, never skipping a
  cell). Nodes and links share the ink fill so they read as one connected shape; included in
  the SVG/PNG export. Unified undo/redo covers both ropes and blobs.
- [x] **Connect** mode (metaball between neighbors) — folded into Paint mode above.
- [x] **Paint refinements**: click-to-click connect (click a pin, then a neighbor) + chaining,
  click-again-to-remove, eased fill-tint hover, and a **Blob spread** slider (metaball `v`).
- [x] **Keyboard shortcuts** (M/S/P/H/E/C/R, Ctrl/Cmd+Z) with on-screen `Kbd` badges;
  hold **Shift** + hover a pin for a transient Edit-sizes override.
- [ ] Smooth/simplify the stroke points for even smaller SVGs.
- [x] Light/dark theme toggle (`[data-theme]` palette mapped to `@theme` tokens).
- [x] Full-canvas drawing with pan/zoom (scroll to pan, Ctrl/Cmd+scroll or pinch to zoom,
  Space/middle-button drag to pan; on-canvas +/−/% controls; auto-fit until manually moved).
- [x] Full-viewport canvas: content pans/zooms **under the sidebar** without cropping; a single
  seamless dotted background across the whole page (`leftInset` keeps fit/zoom centered).
- [x] Zoom box + bar sliders ported from DRAW_GRID (glass zoom pill with pan/fit; `.rng` sliders).
- [ ] Offline fonts (currently via Google Fonts with system fallback).
