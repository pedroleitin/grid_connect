import { useEffect, useRef, useState } from 'react'
import Sidebar from './components/Sidebar'
import GridCanvas from './components/GridCanvas'

export default function App() {
  const [cols, setCols] = useState(6)
  const [rows, setRows] = useState(6)
  const [cellSize, setCellSize] = useState(100)  // circle diameter
  const [gap, setGap] = useState(22)             // spacing between circles
  const [tension, setTension] = useState(200)    // rope tension (100..200); 200 = glued
  const [style, setStyle] = useState('fill')     // 'fill' | 'stroke'
  const [shape, setShape] = useState('circle')   // 'circle' | 'square'
  const [hideGuides, setHideGuides] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [darkMode, setDarkMode] = useState(false)
  const canvasApi = useRef(null)

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light'
  }, [darkMode])

  return (
    <div className="bg-base" style={{ height: '100dvh', overflow: 'hidden' }}>
      <Sidebar
        cols={cols} setCols={setCols}
        rows={rows} setRows={setRows}
        cellSize={cellSize} setCellSize={setCellSize}
        gap={gap} setGap={setGap}
        tension={tension} setTension={setTension}
        style={style} setStyle={setStyle}
        shape={shape} setShape={setShape}
        hideGuides={hideGuides} setHideGuides={setHideGuides}
        editMode={editMode} setEditMode={setEditMode}
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

      <main className="h-full" style={{ paddingLeft: 360 }}>
        <GridCanvas
          ref={canvasApi}
          cols={cols} rows={rows} cellSize={cellSize} gap={gap}
          shape={shape} tension={tension} style={style}
          hideGuides={hideGuides} editMode={editMode} theme={darkMode ? 'dark' : 'light'}
        />
      </main>

      {/* export bar centered at the bottom of the canvas area */}
      <div
        className="fixed bottom-4 z-50 flex gap-2 p-2 rounded-[15px]"
        style={{ left: 'calc(50% + 180px)', transform: 'translateX(-50%)', color: 'var(--c-text)' }}
      >
        <button
          className="btn-menu flex items-center gap-2 px-4 py-2 text-[13px] font-medium"
          onClick={() => canvasApi.current?.exportSVG()}
          aria-label="Download SVG"
        >
          <DownloadIcon />SVG
        </button>
        <button
          className="btn-menu flex items-center gap-2 px-4 py-2 text-[13px] font-medium"
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
