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
  A **Corner radius** slider (0–100%) controls the rounding of both guides and the rope contour.
- [ ] **Erase** tool: remove drawn ropes (or parts of them) directly on the canvas.
- [x] **Ignore** circles: in Edit mode, click the center **X** of a pin to mark it ignored
  (reddish); ignored pins are skipped by the physics so the rope passes through them.
- [x] **Hide guides** toggle (draw without the pin dots showing).
- [ ] **Paint** mode: paint over pins to grow metaball **blobs**.
- [ ] **Connect** mode (metaball between neighbors) as an optional tool.
- [ ] Smooth/simplify the stroke points for even smaller SVGs.
- [x] Light/dark theme toggle (`[data-theme]` palette mapped to `@theme` tokens).
- [x] Full-canvas drawing with pan/zoom (scroll to pan, Ctrl/Cmd+scroll or pinch to zoom,
  Space/middle-button drag to pan; on-canvas +/−/% controls; auto-fit until manually moved).
- [x] Full-viewport canvas: content pans/zooms **under the sidebar** without cropping; a single
  seamless dotted background across the whole page (`leftInset` keeps fit/zoom centered).
- [x] Zoom box + bar sliders ported from DRAW_GRID (glass zoom pill with pan/fit; `.rng` sliders).
- [ ] Offline fonts (currently via Google Fonts with system fallback).
