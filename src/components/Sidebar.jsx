/* Controls sidebar — grid-gen-2 style (Tailwind v4 + theme tokens) */
import { useLayoutEffect, useRef, useState } from 'react'

function Row({ children }) {
  return <div>{children}</div>
}

/* keyboard-shortcut badge: a lowercase letter in a small rounded square */
function Kbd({ k }) {
  return <span className="kbd" aria-hidden="true">{k}</span>
}

function Label({ children, kbd }) {
  return (
    <span className="text-sm inline-flex items-center" style={{ color: 'var(--c-text)', opacity: 0.5 }}>
      {children}{kbd ? <Kbd k={kbd} /> : null}
    </span>
  )
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

function Checkbox({ label, checked, onChange, kbd }) {
  return (
    <Row>
      <div className="px-5 flex items-center justify-between py-3">
        <Label kbd={kbd}>{label}</Label>
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

function Segmented({ label, options, value, onChange, kbd, width }) {
  return (
    <Row>
      <div className="px-5 py-3 flex items-center justify-between gap-3">
        <Label kbd={kbd}>{label}</Label>
        <div className="seg" style={width ? { width } : undefined}>
          {options.map((o) => (
            <button
              key={o.value}
              onClick={() => onChange(o.value)}
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
  tension, setTension, mode, setMode, style, setStyle, shape, setShape,
  cornerRadius, setCornerRadius, blob, setBlob, drawTool, setDrawTool,
  smoothJoins, setSmoothJoins,
  hideGuides, setHideGuides,
  editTool, setEditTool,
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
        <div className={`collapse-row${mode === 'draw' ? ' collapse-row--open' : ''}`}>
          <div>
            <Slider label="Rope tension" min={100} max={200} value={tension} onChange={setTension} />
          </div>
        </div>
        <div className={`collapse-row${mode === 'paint' ? ' collapse-row--open' : ''}`}>
          <div>
            <Slider label="Blob spread" min={20} max={90} value={blob} suffix="%" onChange={setBlob} />
            <Checkbox label="Smooth joins" checked={smoothJoins} onChange={setSmoothJoins} />
          </div>
        </div>

        <Segmented
          label="Mode" value={mode} onChange={setMode} kbd="m"
          options={[{ value: 'draw', label: 'Draw' }, { value: 'paint', label: 'Paint' }]}
        />
        <div className={`collapse-row${mode === 'draw' ? ' collapse-row--open' : ''}`}>
          <div>
            <Segmented
              label="Line" value={drawTool} onChange={setDrawTool} kbd="l"
              options={[{ value: 'points', label: 'Points' }, { value: 'free', label: 'Freehand' }]}
            />
          </div>
        </div>
        <Segmented
          label="Style" value={style} onChange={setStyle} kbd="s"
          options={[{ value: 'fill', label: 'Filled' }, { value: 'stroke', label: 'Outline' }]}
        />
        <Segmented
          label="Pin" value={shape} onChange={setShape} kbd="p"
          options={[{ value: 'circle', label: 'Circle' }, { value: 'square', label: 'Square' }]}
        />
        <div className={`collapse-row${shape === 'square' ? ' collapse-row--open' : ''}`}>
          <div>
            <Slider label="Corner radius" min={20} max={100} value={cornerRadius} suffix="%" onChange={setCornerRadius} />
          </div>
        </div>
        <Segmented
          label="Edit" value={editTool} onChange={setEditTool} kbd="e" width={mode === 'draw' ? 210 : 140}
          options={mode === 'draw'
            ? [{ value: 'off', label: 'Off' }, { value: 'sizes', label: 'Sizes' }, { value: 'path', label: 'Path' }]
            : [{ value: 'off', label: 'Off' }, { value: 'sizes', label: 'Sizes' }]}
        />
        <Checkbox label="Hide guides" checked={hideGuides} onChange={setHideGuides} kbd="h" />

        <p className="px-5 py-3 mt-auto text-[11px] leading-relaxed" style={{ color: 'var(--c-text)', opacity: 0.5 }}>
          Draw a loop anywhere on the canvas around the circles you want to wrap — an elastic
          rope snaps tightly around them. Scroll to pan, Ctrl/Cmd+scroll (or pinch) to zoom,
          Space+drag or middle-button drag to pan. Use the +/−/% controls to zoom or reset.
        </p>
      </div>

      {/* action buttons pinned to the bottom */}
      <div className="p-4 divider border-t border-[#d7d2c7]/25 flex gap-2">
        <button className="btn-menu flex-1 py-2 text-[13px] font-medium inline-flex items-center justify-center" onClick={onResetCircles}>Reset<Kbd k="r" /></button>
        <button className="btn-menu flex-1 py-2 text-[13px] font-medium inline-flex items-center justify-center" onClick={onClear}>Clear<Kbd k="c" /></button>
      </div>
    </div>
  )
}
