import { useRef, useState } from 'react'
import DrawingBoard from './DrawingBoard'
import { useGameRoom } from '../useGameRoom'
import './Canvas.css'

const tools = [
  { id: 'freeSelect', label: 'Free-form selection' },
  { id: 'rectSelect', label: 'Rectangular selection' },
  { id: 'eraser', label: 'Eraser' },
  { id: 'fill', label: 'Fill with color' },
  { id: 'picker', label: 'Pick color' },
  { id: 'zoom', label: 'Zoom' },
  { id: 'pencil', label: 'Pencil' },
  { id: 'brush', label: 'Brush' },
  { id: 'spray', label: 'Spray paint' },
  { id: 'text', label: 'Text' },
  { id: 'line', label: 'Line' },
  { id: 'curve', label: 'Curve' },
  { id: 'rect', label: 'Rectangle' },
  { id: 'poly', label: 'Polygon' },
  { id: 'ellipse', label: 'Ellipse' },
  { id: 'round', label: 'Rounded rectangle' },
]

const colors = [
  '#000000', '#ffffff', '#7b7b7b', '#800000', '#808000', '#008000', '#008080', '#000080',
  '#800080', '#808040', '#004040', '#0080ff', '#004080', '#8000ff', '#804000',
  '#c0c0c0', '#ffffff', '#c0c0c0', '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff',
  '#ff00ff', '#ffff80', '#00ff80', '#80ffff', '#8080ff', '#ff0080', '#ff8040',
]

function DrawingWindow({ roomId, user, onLogout }) {
  const windowRef = useRef(null)
  const dragRef = useRef(null)
  const [guess, setGuess] = useState('')
  const [activeTool, setActiveTool] = useState('pencil')
  const [primaryColor, setPrimaryColor] = useState('#000000')
  const [secondaryColor, setSecondaryColor] = useState('#ffffff')
  const [zoom, setZoom] = useState(1)
  const [frame, setFrame] = useState({
    x: 74,
    y: 32,
    width: 980,
    height: 560,
  })
  const {
    chat,
    clearSignal,
    history,
    isDrawer,
    remoteEvent,
    room,
    sendDrawEvent,
    sendGuess,
    status,
  } = useGameRoom(roomId, user)

  function clampFrame(nextFrame) {
    const maxX = Math.max(0, window.innerWidth - 90)
    const maxY = Math.max(0, window.innerHeight - 52)

    return {
      ...nextFrame,
      x: Math.min(Math.max(nextFrame.x, 0), maxX),
      y: Math.min(Math.max(nextFrame.y, 0), maxY),
      width: Math.max(nextFrame.width, 520),
      height: Math.max(nextFrame.height, 360),
    }
  }

  function beginDrag(event) {
    if (event.button !== 0 || event.target.closest('button')) return

    dragRef.current = {
      mode: 'move',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      frame,
    }

    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function beginResize(event) {
    event.preventDefault()
    event.stopPropagation()

    dragRef.current = {
      mode: 'resize',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      frame,
    }

    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function updatePointer(event) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    const deltaX = event.clientX - drag.startX
    const deltaY = event.clientY - drag.startY

    if (drag.mode === 'move') {
      setFrame(clampFrame({
        ...drag.frame,
        x: drag.frame.x + deltaX,
        y: drag.frame.y + deltaY,
      }))
    }

    if (drag.mode === 'resize') {
      setFrame(clampFrame({
        ...drag.frame,
        width: drag.frame.width + deltaX,
        height: drag.frame.height + deltaY,
      }))
    }
  }

  function endPointer(event) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
  }

  function pickPrimaryColor(color) {
    setPrimaryColor(color)
    setActiveTool((tool) => (tool === 'picker' ? 'pencil' : tool))
  }

  function pickSecondaryColor(event, color) {
    event.preventDefault()
    setSecondaryColor(color)
  }

  function submitGuess(event) {
    event.preventDefault()
    sendGuess(guess)
    setGuess('')
  }

  return (
    <main className="xp-desktop">
      <section
        ref={windowRef}
        className="paint-window"
        style={{
          transform: `translate(${frame.x}px, ${frame.y}px)`,
          width: frame.width,
          height: frame.height,
        }}
        aria-label="Scribble paint window"
      >
        <div
          className="paint-titlebar"
          onPointerDown={beginDrag}
          onPointerMove={updatePointer}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
        >
          <div className="paint-title">
            <span className="paint-icon" aria-hidden="true" />
            <span>{room?.id || roomId} - Scribble Paint</span>
          </div>
          <div className="window-controls" aria-label="Window controls">
            <button type="button" aria-label="Minimize">_</button>
            <button type="button" aria-label="Maximize">□</button>
            <button type="button" aria-label="Close">×</button>
          </div>
        </div>

        <nav className="paint-menubar" aria-label="Paint menu">
          {['File', 'Edit', 'View', 'Image', 'Colors', 'Help'].map((item) => (
            <button type="button" key={item}>{item}</button>
          ))}
          <button type="button" className="logoff-menu-item" onClick={onLogout}>Log Off</button>
        </nav>

        <div className="paint-body">
          <aside className="toolbox" aria-label="Paint tools">
            <div className="tool-grid">
              {tools.map((tool) => (
                <button
                  type="button"
                  className={`tool tool-${tool.id}${activeTool === tool.id ? ' is-active' : ''}`}
                  key={tool.id}
                  aria-label={tool.label}
                  title={tool.label}
                  disabled={!isDrawer}
                  onClick={() => setActiveTool(tool.id)}
                />
              ))}
            </div>
            <div className="tool-preview" aria-hidden="true">
              <span style={{ backgroundColor: primaryColor }} />
            </div>
          </aside>

          <div className="scribble-workspace">
            <section className="canvas-shell">
              <div className="canvas-corner top-left" aria-hidden="true" />
              <div className="canvas-workspace">
                <DrawingBoard
                  clearSignal={clearSignal}
                  color={primaryColor}
                  history={history}
                  isDrawer={isDrawer}
                  onDrawEvent={sendDrawEvent}
                  onPickColor={pickPrimaryColor}
                  remoteEvent={remoteEvent}
                  secondaryColor={secondaryColor}
                  setZoom={setZoom}
                  tool={activeTool}
                  zoom={zoom}
                />
              </div>
              {!isDrawer && (
                <div className="viewer-shield">
                  <span>Guess what {room?.players.find((player) => player.isDrawer)?.name || 'the drawer'} is drawing</span>
                </div>
              )}
            </section>

            <aside className="room-panel" aria-label="Scribble room">
              <div className="room-status">
                <strong>Room: {room?.id || roomId}</strong>
                <span>{status}</span>
              </div>
              <div className="word-box">
                <span>Word</span>
                <strong>{isDrawer ? 'You are drawing' : room?.wordHint || '_____'}</strong>
              </div>
              <div className="players-list">
                {(room?.players || []).map((player) => (
                  <div className={player.isDrawer ? 'player is-drawer' : 'player'} key={player.id}>
                    <span>{player.name}</span>
                    <strong>{player.score}</strong>
                  </div>
                ))}
              </div>
              <div className="chat-log">
                {chat.map((message) => (
                  <p className={`chat-message chat-${message.type}`} key={message.id}>
                    {message.type === 'guess' && <strong>{message.player}: </strong>}
                    {message.text}
                  </p>
                ))}
              </div>
              <form className="guess-form" onSubmit={submitGuess}>
                <input
                  aria-label="Guess"
                  disabled={isDrawer}
                  placeholder={isDrawer ? 'Draw the word...' : 'Type your guess'}
                  value={guess}
                  onChange={(event) => setGuess(event.target.value)}
                />
                <button type="submit" disabled={isDrawer}>Send</button>
              </form>
            </aside>
          </div>
        </div>

        <div className="paint-palette" aria-label="Color palette">
          <div className="selected-colors" aria-hidden="true">
            <span className="selected primary" style={{ backgroundColor: primaryColor }} />
            <span className="selected secondary" style={{ backgroundColor: secondaryColor }} />
          </div>
          <div className="swatches">
            {colors.map((color, index) => (
              <button
                type="button"
                className={`swatch${color.toLowerCase() === primaryColor.toLowerCase() ? ' is-current' : ''}`}
                style={{ backgroundColor: color }}
                aria-label={`Color ${index + 1}`}
                title="Left click for primary, right click for secondary"
                key={`${color}-${index}`}
                onClick={() => pickPrimaryColor(color)}
                onContextMenu={(event) => pickSecondaryColor(event, color)}
              />
            ))}
          </div>
        </div>

        <footer className="paint-statusbar">
          <span>{isDrawer ? tools.find((tool) => tool.id === activeTool)?.label : 'Guessing'} | Zoom {Math.round(zoom * 100)}%</span>
          <span>{user?.displayName}</span>
          <span />
          <span />
        </footer>

        <button
          type="button"
          className="resize-grip"
          aria-label="Resize window"
          onPointerDown={beginResize}
          onPointerMove={updatePointer}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
        />
      </section>
    </main>
  )
}

export default DrawingWindow
