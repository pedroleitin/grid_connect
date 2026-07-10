/* Controls sidebar — grid-gen-2 style (Tailwind v4 + theme tokens) */
import { useLayoutEffect, useRef, useState } from 'react'

function Row({ children }) {
  return <div>{children}</div>
}

/* bar slider ported from DRAW_GRID: label + value inside a tall pill whose
   dark fill shows the value. The light (clipped) copy of the text must be as
   wide as the whole track so it stays aligned with the dark copy. */
function Slider({ label, min, max, value, suffix = '', onChange }) {
  const rootRef = useRef(null)
  const [trackW, setTrackW] = useState(0)
  const dragging = useRef(false)

  useLayoutEffect(() => {
    const el = rootRef.current
    const ro = new ResizeObserver(() => setTrackW(el.clientWidth))
    ro.observe(el)
    setTrackW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const valAt = (e) => {
    const r = rootRef.current.getBoundingClientRect()
    const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    return Math.round(min + t * (max - min))
  }
  const down = (e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); onChange(valAt(e)) }
  const move = (e) => { if (dragging.current) onChange(valAt(e)) }
  const up = () => { dragging.current = false }
  const key = (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.max(min, value - 1)) }
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onChange(Math.min(max, value + 1)) }
  }
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0
  const text = `${value}${suffix}`

  return (
    <Row>
      <div className="px-5 py-3">
        <div
          ref={rootRef}
          className="rng"
          tabIndex={0}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onKeyDown={key}
        >
          <div className="rng-content"><span>{label}</span><span className="rng-val">{text}</span></div>
          <div className="rng-fill" style={{ width: `${pct}%` }}>
            <div className="rng-content rng-content--light" style={{ width: trackW }}>
              <span>{label}</span><span className="rng-val">{text}</span>
            </div>
          </div>
        </div>
      </div>
    </Row>
  )
}

function Checkbox({ label, checked, onChange }) {
  return (
    <Row>
      <div className="px-5 flex items-center justify-between py-3">
        <span className="text-sm" style={{ color: 'var(--c-text)', opacity: 0.5 }}>{label}</span>
        <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="toggle-switch">
          <span
            className="toggle-thumb"
            style={{
              left: checked ? '31px' : '0px',
              backgroundColor: checked ? 'var(--thumb-color)' : 'transparent',
              border: checked ? 'none' : '4px solid var(--thumb-color)',
            }}
          />
        </button>
      </div>
    </Row>
  )
}

function Segmented({ label, options, value, onChange }) {
  const toggle = () => {
    const other = options.find((o) => o.value !== value)
    if (other) onChange(other.value)
  }
  return (
    <Row>
      <div className="px-5 py-3 flex items-center justify-between gap-3">
        <span className="text-sm" style={{ color: 'var(--c-text)', opacity: 0.5 }}>{label}</span>
        <div className="seg">
          {options.map((o) => (
            <button
              key={o.value}
              onClick={toggle}
              className={'seg-opt' + (value === o.value ? ' active' : '')}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </Row>
  )
}

export default function Sidebar({
  cols, setCols, rows, setRows, cellSize, setCellSize, gap, setGap,
  tension, setTension, style, setStyle, shape, setShape,
  cornerRadius, setCornerRadius,
  hideGuides, setHideGuides,
  editMode, setEditMode,
  onClear, onResetCircles,
}) {
  return (
    <div
      className="fixed left-[10px] top-[10px] w-[320px] flex flex-col rounded-[15px] overflow-hidden z-50"
      style={{ height: 'calc(100dvh - 20px)', backgroundColor: 'var(--c-panel)', color: 'var(--c-text)' }}
    >
      <div className="flex-1 overflow-y-auto flex flex-col menu-scroll">
        <p className="px-5 pt-4 pb-3 font-medium text-[26px] leading-none divider border-b border-[#d7d2c7]/25 flex items-baseline justify-between">
          G_connect
        </p>

        <Slider label="Columns" min={1} max={20} value={cols} onChange={setCols} />
        <Slider label="Rows" min={1} max={20} value={rows} onChange={setRows} />
        <Slider label="Size" min={35} max={200} value={cellSize} onChange={setCellSize} />
        <Slider label="Spacing" min={0} max={80} value={gap} onChange={setGap} />
        <Slider label="Rope tension" min={100} max={200} value={tension} onChange={setTension} />

        <Segmented
          label="Style" value={style} onChange={setStyle}
          options={[{ value: 'fill', label: 'Filled' }, { value: 'stroke', label: 'Outline' }]}
        />
        <Segmented
          label="Pin" value={shape} onChange={setShape}
          options={[{ value: 'circle', label: 'Circle' }, { value: 'square', label: 'Square' }]}
        />
        {shape === 'square' && (
          <Slider label="Corner radius" min={0} max={100} value={cornerRadius} suffix="%" onChange={setCornerRadius} />
        )}
        <Checkbox label="Hide guides" checked={hideGuides} onChange={setHideGuides} />
        <Checkbox label="Edit sizes" checked={editMode} onChange={setEditMode} />

        <p className="px-5 py-3 mt-auto text-[11px] leading-relaxed" style={{ color: 'var(--c-text)', opacity: 0.5 }}>
          Draw a loop anywhere on the canvas around the circles you want to wrap — an elastic
          rope snaps tightly around them. Scroll to pan, Ctrl/Cmd+scroll (or pinch) to zoom,
          Space+drag or middle-button drag to pan. Use the +/−/% controls to zoom or reset.
        </p>
      </div>

      {/* action buttons pinned to the bottom */}
      <div className="p-4 divider border-t border-[#d7d2c7]/25 flex gap-2">
        <button className="btn-menu flex-1 py-2 text-[13px] font-medium" onClick={onResetCircles}>Reset</button>
        <button className="btn-menu flex-1 py-2 text-[13px] font-medium" onClick={onClear}>Clear</button>
      </div>
    </div>
  )
}
