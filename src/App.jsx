import { useEffect, useRef, useState } from 'react'
import Sidebar from './components/Sidebar'
import GridCanvas from './components/GridCanvas'

const STORE_KEY = 'gconnect.history.v1' // localStorage key for saved snapshots

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || [] } catch { return [] }
}
function saveHistory(items) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(items)) } catch { /* quota/full: ignore */ }
}


export default function App() {
  const [cols, setCols] = useState(6)
  const [rows, setRows] = useState(6)
  const [cellSize, setCellSize] = useState(100)  // circle diameter
  const [gap, setGap] = useState(22)             // spacing between circles
  const [tension, setTension] = useState(200)    // rope tension (100..200); 200 = glued
  const [style, setStyle] = useState('fill')     // 'fill' | 'stroke'
  const [shape, setShape] = useState('circle')   // 'circle' | 'square'
  const [cornerRadius, setCornerRadius] = useState(36) // square corner radius (% of half-size)
  const [blob, setBlob] = useState(50)          // paint connection spread (metaball v, %)
  const [smoothJoins, setSmoothJoins] = useState(false) // fuse paint connections with smooth/glued joins
  const [hideGuides, setHideGuides] = useState(false)
  const [editTool, setEditTool] = useState('off')  // 'off' | 'sizes' (circle sizes) | 'path' (reshape ropes)
  const [darkMode, setDarkMode] = useState(false)
  const [mode, setMode] = useState('draw')       // 'draw' (rope) | 'paint' (blob connect)
  const [drawTool, setDrawTool] = useState('points') // 'points' (polygon) | 'free' (freehand)
  const canvasApi = useRef(null)

  // history dock: saved drawing snapshots (persisted in localStorage)
  const [snapshots, setSnapshots] = useState(loadHistory)
  const [dockOpen, setDockOpen] = useState(() => loadHistory().length > 0)
  const [dockClosing, setDockClosing] = useState(false)

  // close with an exit animation: keep the dock mounted until it finishes
  const closeDock = () => { setDockOpen(false); setDockClosing(true) }
  const toggleDock = () => (dockOpen ? closeDock() : setDockOpen(true))

  useEffect(() => { saveHistory(snapshots) }, [snapshots])

  const captureConfig = () => ({
    cols, rows, cellSize, gap, tension, style, shape, cornerRadius,
    blob, smoothJoins, mode, drawTool, hideGuides,
  })

  const handleSaveSnapshot = () => {
    const snap = canvasApi.current?.snapshot()
    if (!snap) return
    const item = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      at: Date.now(),
      config: captureConfig(),
      drawing: snap.drawing,
      previewSvg: snap.previewSvg,
    }
    setSnapshots((s) => [item, ...s])
    setDockClosing(false)
    setDockOpen(true)
  }

  const handleRestoreSnapshot = (item) => {
    const c = item.config
    setCols(c.cols); setRows(c.rows); setCellSize(c.cellSize); setGap(c.gap)
    setTension(c.tension); setStyle(c.style); setShape(c.shape); setCornerRadius(c.cornerRadius)
    setBlob(c.blob); setSmoothJoins(c.smoothJoins); setMode(c.mode); setDrawTool(c.drawTool)
    setHideGuides(c.hideGuides); setEditTool('off')
    canvasApi.current?.restore(item.drawing, c)
  }

  const handleDeleteSnapshot = (id) => setSnapshots((s) => s.filter((x) => x.id !== id))

  const leftInset = 330
  // reserve vertical space for the history dock so it never overlaps the grid
  const bottomInset = dockOpen ? 190 : 0

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light'
  }, [darkMode])

  // Path editing only makes sense in Draw mode; drop it when leaving Draw
  useEffect(() => {
    if (mode !== 'draw' && editTool === 'path') setEditTool('off')
  }, [mode, editTool])

  // keyboard shortcuts (ignored while typing in a field)
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) canvasApi.current?.redo(); else canvasApi.current?.undo()
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      switch (e.key.toLowerCase()) {
        case 'm': setMode((v) => (v === 'draw' ? 'paint' : 'draw')); break
        case 'l': setDrawTool((v) => (v === 'free' ? 'points' : 'free')); break
        case 's': setStyle((v) => (v === 'fill' ? 'stroke' : 'fill')); break
        case 'p': setShape((v) => (v === 'circle' ? 'square' : 'circle')); break
        case 'h': setHideGuides((v) => !v); break
        case 'e': setEditTool((v) => (v === 'off' ? 'sizes' : v === 'sizes' ? 'path' : 'off')); break
        case 'c': canvasApi.current?.clear(); break
        case 'r': canvasApi.current?.resetCircles(); break
        default: return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="bg-base" style={{ height: '100dvh', overflow: 'hidden' }}>
      <Sidebar
        cols={cols} setCols={setCols}
        rows={rows} setRows={setRows}
        cellSize={cellSize} setCellSize={setCellSize}
        gap={gap} setGap={setGap}
        tension={tension} setTension={setTension}
        mode={mode} setMode={setMode}
        drawTool={drawTool} setDrawTool={setDrawTool}
        style={style} setStyle={setStyle}
        shape={shape} setShape={setShape}
        cornerRadius={cornerRadius} setCornerRadius={setCornerRadius}
        blob={blob} setBlob={setBlob}
        smoothJoins={smoothJoins} setSmoothJoins={setSmoothJoins}
        hideGuides={hideGuides} setHideGuides={setHideGuides}
        editTool={editTool} setEditTool={setEditTool}
        onClear={() => canvasApi.current?.clear()}
        onResetCircles={() => canvasApi.current?.resetCircles()}
      />

      {/* theme toggle */}
      <button
        onClick={() => setDarkMode((v) => !v)}
        className="eye-btn fixed top-4 right-4 z-[60] w-11 h-11 flex items-center justify-center rounded-full bg-transparent border-none cursor-pointer"
        style={{ color: 'var(--c-text)' }}
        aria-label="Toggle theme"
      >
        {darkMode ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        )}
      </button>

      <main className="h-full">
        <GridCanvas
          ref={canvasApi}
          cols={cols} rows={rows} cellSize={cellSize} gap={gap}
          shape={shape} tension={tension} style={style}
          cornerRadius={cornerRadius} mode={editTool === 'path' ? 'edit' : mode} blob={blob}
          drawTool={drawTool} smoothJoins={smoothJoins}
          hideGuides={hideGuides} editMode={editTool === 'sizes'} theme={darkMode ? 'dark' : 'light'}
          leftInset={leftInset} bottomInset={bottomInset}
        />
      </main>

      {/* history dock: popover above the footer bar with saved-snapshot previews */}
      {(dockOpen || dockClosing) && (
        <div
          className={'history-pop fixed z-[55] bg-panel rounded-[15px] p-2' + (dockClosing ? ' history-pop--closing' : '')}
          onAnimationEnd={(e) => { if (e.animationName === 'history-pop-out') setDockClosing(false) }}
          style={{
            left: `calc(50% + ${leftInset / 2}px)`, bottom: 74,
            transform: 'translateX(-50%)', maxWidth: `calc(100vw - ${leftInset + 32}px)`,
            color: 'var(--c-text)',
          }}
        >
          <div className="menu-scroll flex gap-2 overflow-x-auto" style={{ maxWidth: '100%' }}>
            <button
              onClick={handleSaveSnapshot}
              className="snap-pop snap-add flex items-center justify-center cursor-pointer shrink-0"
              style={{ width: 92, height: 92, animationDelay: '90ms' }}
              title="Save current drawing" aria-label="Save current drawing"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            {snapshots.map((item, i) => (
              <div
                key={item.id}
                className="snap-pop snap-item group relative rounded-[10px] overflow-hidden shrink-0"
                style={{ width: 92, height: 92, animationDelay: `${i * 55 + 145}ms` }}
              >
                <button
                  onClick={() => handleRestoreSnapshot(item)}
                  className="block w-full h-full cursor-pointer border-none p-0 bg-transparent"
                  title="Restore this drawing" aria-label="Restore this drawing"
                >
                  {item.previewSvg ? (
                    <div
                      className="snap-preview block w-full h-full"
                      style={{ color: 'var(--c-ink)', background: 'color-mix(in srgb, var(--c-line) 20%, transparent)' }}
                      dangerouslySetInnerHTML={{ __html: item.previewSvg }}
                    />
                  ) : (
                    <img
                      src={item.preview} alt="snapshot preview"
                      className="block w-full h-full"
                      style={{ objectFit: 'contain', background: 'color-mix(in srgb, var(--c-line) 20%, transparent)' }}
                    />
                  )}
                </button>
                <button
                  onClick={() => handleDeleteSnapshot(item.id)}
                  className="snap-del absolute top-1 right-1 w-6 h-6 flex items-center justify-center rounded-md border-none cursor-pointer"
                  style={{ background: 'var(--c-panel)', color: 'var(--c-text)' }}
                  title="Delete" aria-label="Delete snapshot"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* footer bar: history toggle + export, aligned with the undo/redo & zoom boxes */}
      <div
        className="zoombox"
        style={{ position: 'fixed', bottom: 16, left: `calc(50% + ${leftInset / 2}px)`, right: 'auto', transform: 'translateX(-50%)', zIndex: 50, color: 'var(--c-text)' }}
      >
        <button
          className={'tool-btn icon-btn' + (dockOpen ? ' active' : '')}
          onClick={() => (snapshots.length === 0 ? handleSaveSnapshot() : toggleDock())}
          title="History" aria-label="Toggle history"
        >
          <MotionIcon />
        </button>
        <span className="tb-sep" />
        <button
          className="tool-btn gap-2"
          onClick={() => canvasApi.current?.exportSVG()}
          aria-label="Download SVG"
        >
          <DownloadIcon />SVG
        </button>
        <button
          className="tool-btn gap-2"
          onClick={() => canvasApi.current?.exportPNG()}
          aria-label="Download PNG"
        >
          <DownloadIcon />PNG
        </button>
      </div>
    </div>
  )
}

function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

function MotionIcon() {
  return (
    <svg width="22" height="22" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true">
      <path d="M480-80q-33 0-56.5-23.5T400-160v-320q0-33 23.5-56.5T480-560h320q33 0 56.5 23.5T880-480v320q0 33-23.5 56.5T800-80H480Zm0-80h320v-320H480v320Zm-240-80v-400q0-33 23.5-56.5T320-720h400v80H320v400h-80ZM80-400v-400q0-33 23.5-56.5T160-880h400v80H160v400H80Zm400 240v-320 320Z" />
    </svg>
  )
}
