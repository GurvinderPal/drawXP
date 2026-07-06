import { useEffect, useRef } from 'react'
import './DrawingBoard.css'

function hexToRgb(hex) {
  const normalized = hex.replace('#', '')
  const value = Number.parseInt(normalized, 16)

  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
    a: 255,
  }
}

function colorsMatch(data, index, target) {
  return (
    data[index] === target.r
    && data[index + 1] === target.g
    && data[index + 2] === target.b
    && data[index + 3] === target.a
  )
}

function setPixel(data, index, color) {
  data[index] = color.r
  data[index + 1] = color.g
  data[index + 2] = color.b
  data[index + 3] = color.a
}

function normalizeBox(start, end) {
  const x = Math.min(start.x, end.x)
  const y = Math.min(start.y, end.y)
  const width = Math.abs(end.x - start.x)
  const height = Math.abs(end.y - start.y)

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  }
}

function pointInPolygon(point, polygon) {
  let inside = false

  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index) {
    const currentPoint = polygon[index]
    const previousPoint = polygon[previous]
    const intersects = currentPoint.y > point.y !== previousPoint.y > point.y
      && point.x < ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y))
        / (previousPoint.y - currentPoint.y) + currentPoint.x

    if (intersects) inside = !inside
  }

  return inside
}

function DrawingBoard({
  clearSignal,
  color,
  history,
  isDrawer,
  onDrawEvent,
  onPickColor,
  remoteEvent,
  secondaryColor,
  setZoom,
  tool,
  zoom,
}) {
  const canvasRef = useRef(null)
  const overlayRef = useRef(null)
  const actionRef = useRef(null)
  const remoteStrokeRef = useRef(null)
  const selectionRef = useRef(null)
  const propsRef = useRef({ tool, color, secondaryColor, zoom, isDrawer })

  useEffect(() => {
    propsRef.current = { tool, color, secondaryColor, zoom, isDrawer }
  }, [tool, color, secondaryColor, zoom, isDrawer])

  useEffect(() => {
    const canvas = canvasRef.current
    const overlay = overlayRef.current
    const ctx = canvas.getContext('2d')

    function resizeLayer() {
      const snapshot = document.createElement('canvas')
      snapshot.width = canvas.width
      snapshot.height = canvas.height
      snapshot.getContext('2d').drawImage(canvas, 0, 0)

      const rect = canvas.parentElement.getBoundingClientRect()
      canvas.width = Math.max(1, Math.floor(rect.width))
      canvas.height = Math.max(1, Math.floor(rect.height))
      overlay.width = canvas.width
      overlay.height = canvas.height

      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(snapshot, 0, 0)
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
      ctx.strokeStyle = propsRef.current.color
      ctx.fillStyle = propsRef.current.color
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      const overlayCtx = overlay.getContext('2d')
      overlayCtx.clearRect(0, 0, overlay.width, overlay.height)

      if (selectionRef.current) {
        const selection = selectionRef.current
        overlayCtx.save()
        overlayCtx.setLineDash([4, 3])
        overlayCtx.strokeStyle = '#000'
        overlayCtx.lineWidth = 1
        overlayCtx.strokeRect(selection.x + 0.5, selection.y + 0.5, selection.width, selection.height)
        overlayCtx.restore()
      }
    }

    const observer = new ResizeObserver(resizeLayer)
    observer.observe(canvas.parentElement)
    resizeLayer()

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvasContext()
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    clearOverlay()

    history.forEach((event) => {
      applyDrawEvent(event)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history])

  useEffect(() => {
    if (!remoteEvent) return
    applyDrawEvent(remoteEvent)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteEvent])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvasContext()
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    clearOverlay()
    selectionRef.current = null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearSignal])

  function configureContext(ctx, strokeColor, lineWidth) {
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.strokeStyle = strokeColor
    ctx.fillStyle = strokeColor
    ctx.lineWidth = lineWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }

  function canvasContext() {
    return canvasRef.current.getContext('2d')
  }

  function overlayContext() {
    return overlayRef.current.getContext('2d')
  }

  function clearOverlay() {
    const overlay = overlayRef.current
    overlayContext().clearRect(0, 0, overlay.width, overlay.height)
  }

  function pointFromEvent(event) {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()

    return {
      x: Math.round((event.clientX - rect.left) * (canvas.width / rect.width)),
      y: Math.round((event.clientY - rect.top) * (canvas.height / rect.height)),
    }
  }

  function putImageDataWithAlpha(ctx, imageData, x, y) {
    const buffer = document.createElement('canvas')
    buffer.width = imageData.width
    buffer.height = imageData.height
    buffer.getContext('2d').putImageData(imageData, 0, 0)
    ctx.drawImage(buffer, Math.round(x), Math.round(y))
  }

  function selectionContains(point) {
    const selection = selectionRef.current
    if (!selection) return false

    return point.x >= selection.x
      && point.x <= selection.x + selection.width
      && point.y >= selection.y
      && point.y <= selection.y + selection.height
  }

  function drawSelectionOutline(box = selectionRef.current, points = null) {
    clearOverlay()
    if (!box && !points) return

    const ctx = overlayContext()
    ctx.save()
    ctx.setLineDash([4, 3])
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 1

    if (points?.length > 1) {
      ctx.beginPath()
      ctx.moveTo(points[0].x, points[0].y)
      points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y))
      ctx.stroke()
    } else {
      ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.width, box.height)
    }

    ctx.restore()
  }

  function commitSelection() {
    selectionRef.current = null
    clearOverlay()
  }

  function drawPreviewShape(action, point) {
    const ctx = overlayContext()
    const box = normalizeBox(action.start, point)
    clearOverlay()
    configureContext(ctx, action.color || propsRef.current.color, action.tool === 'brush' ? 8 : 2)

    if (action.tool === 'line') {
      ctx.beginPath()
      ctx.moveTo(action.start.x, action.start.y)
      ctx.lineTo(point.x, point.y)
      ctx.stroke()
      return
    }

    if (action.tool === 'curve') {
      ctx.beginPath()
      ctx.moveTo(action.start.x, action.start.y)
      ctx.quadraticCurveTo(action.start.x, point.y, point.x, point.y)
      ctx.stroke()
      return
    }

    if (action.tool === 'rect') {
      ctx.strokeRect(box.x, box.y, box.width, box.height)
      return
    }

    if (action.tool === 'poly') {
      ctx.beginPath()
      ctx.moveTo(box.x + box.width / 2, box.y)
      ctx.lineTo(box.x + box.width, box.y + box.height * 0.45)
      ctx.lineTo(box.x + box.width * 0.78, box.y + box.height)
      ctx.lineTo(box.x + box.width * 0.18, box.y + box.height)
      ctx.lineTo(box.x, box.y + box.height * 0.42)
      ctx.closePath()
      ctx.stroke()
      return
    }

    if (action.tool === 'ellipse') {
      ctx.beginPath()
      ctx.ellipse(
        box.x + box.width / 2,
        box.y + box.height / 2,
        Math.max(1, box.width / 2),
        Math.max(1, box.height / 2),
        0,
        0,
        Math.PI * 2,
      )
      ctx.stroke()
      return
    }

    if (action.tool === 'round') {
      const radius = Math.min(14, box.width / 3, box.height / 3)
      ctx.beginPath()
      ctx.roundRect(box.x, box.y, box.width, box.height, radius)
      ctx.stroke()
    }
  }

  function stampPreviewShape(action, point) {
    const source = overlayRef.current
    const ctx = canvasContext()
    drawPreviewShape(action, point)
    ctx.drawImage(source, 0, 0)
    clearOverlay()
  }

  function floodFill(start, fillColor = propsRef.current.color) {
    const canvas = canvasRef.current
    const ctx = canvasContext()
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = image.data
    const x = Math.max(0, Math.min(canvas.width - 1, start.x))
    const y = Math.max(0, Math.min(canvas.height - 1, start.y))
    const targetIndex = (y * canvas.width + x) * 4
    const target = {
      r: data[targetIndex],
      g: data[targetIndex + 1],
      b: data[targetIndex + 2],
      a: data[targetIndex + 3],
    }
    const replacement = hexToRgb(fillColor)

    if (colorsMatch(data, targetIndex, replacement)) return

    const stack = [[x, y]]
    while (stack.length > 0) {
      const [currentX, currentY] = stack.pop()
      const index = (currentY * canvas.width + currentX) * 4

      if (!colorsMatch(data, index, target)) continue

      setPixel(data, index, replacement)

      if (currentX > 0) stack.push([currentX - 1, currentY])
      if (currentX < canvas.width - 1) stack.push([currentX + 1, currentY])
      if (currentY > 0) stack.push([currentX, currentY - 1])
      if (currentY < canvas.height - 1) stack.push([currentX, currentY + 1])
    }

    ctx.putImageData(image, 0, 0)
  }

  function pickColor(point) {
    const canvas = canvasRef.current
    const ctx = canvasContext()
    const x = Math.max(0, Math.min(canvas.width - 1, point.x))
    const y = Math.max(0, Math.min(canvas.height - 1, point.y))
    const [r, g, b] = ctx.getImageData(x, y, 1, 1).data
    const picked = `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`
    onPickColor(picked)
  }

  function insertText(point, remoteText = null, textColor = propsRef.current.color) {
    const text = remoteText ?? window.prompt('Text')
    if (!text) return

    const ctx = canvasContext()
    configureContext(ctx, textColor, 2)
    ctx.font = '20px Tahoma, Verdana, Arial, sans-serif'
    ctx.textBaseline = 'top'
    ctx.fillText(text, point.x, point.y)

    if (remoteText === null) {
      onDrawEvent({ kind: 'text', point, text, color: textColor })
    }
  }

  function drawSprayDots(dots, sprayColor = propsRef.current.color) {
    const ctx = canvasContext()
    configureContext(ctx, sprayColor, 1)
    dots.forEach((dot) => {
      ctx.fillRect(dot.x, dot.y, 1, 1)
    })
  }

  function sprayAt(point, sprayColor = propsRef.current.color) {
    const dots = []
    for (let index = 0; index < 26; index += 1) {
      const angle = Math.random() * Math.PI * 2
      const radius = Math.random() * 15
      dots.push({
        x: point.x + Math.cos(angle) * radius,
        y: point.y + Math.sin(angle) * radius,
      })
    }
    drawSprayDots(dots, sprayColor)
    return dots
  }

  function applyDrawEvent(event) {
    if (!event) return

    const ctx = canvasContext()

    if (event.kind === 'strokeStart') {
      configureContext(ctx, event.color, event.lineWidth)
      ctx.beginPath()
      ctx.moveTo(event.point.x, event.point.y)
      remoteStrokeRef.current = true
    }

    if (event.kind === 'strokeMove' && remoteStrokeRef.current) {
      ctx.lineTo(event.point.x, event.point.y)
      ctx.stroke()
    }

    if (event.kind === 'strokeEnd') {
      remoteStrokeRef.current = null
      ctx.beginPath()
    }

    if (event.kind === 'spray') {
      drawSprayDots(event.dots, event.color)
    }

    if (event.kind === 'fill') {
      floodFill(event.point, event.color)
    }

    if (event.kind === 'text') {
      insertText(event.point, event.text, event.color)
    }

    if (event.kind === 'shape') {
      stampPreviewShape({
        start: event.start,
        tool: event.tool,
        color: event.color,
      }, event.end)
    }
  }

  function beginMoveSelection(event, point) {
    const selection = selectionRef.current
    const canvas = canvasRef.current
    const ctx = canvasContext()

    ctx.clearRect(selection.x, selection.y, selection.width, selection.height)
    const base = ctx.getImageData(0, 0, canvas.width, canvas.height)

    actionRef.current = {
      type: 'moveSelection',
      pointerId: event.pointerId,
      offsetX: point.x - selection.x,
      offsetY: point.y - selection.y,
      base,
      selection,
    }
  }

  function createRectSelection(start, end) {
    const box = normalizeBox(start, end)
    if (box.width < 4 || box.height < 4) {
      commitSelection()
      return
    }

    const ctx = canvasContext()
    const image = ctx.getImageData(box.x, box.y, box.width, box.height)
    selectionRef.current = { ...box, image }
    drawSelectionOutline(selectionRef.current)
  }

  function createFreeSelection(points) {
    if (points.length < 3) return

    const minX = Math.max(0, Math.floor(Math.min(...points.map((point) => point.x))))
    const minY = Math.max(0, Math.floor(Math.min(...points.map((point) => point.y))))
    const maxX = Math.ceil(Math.max(...points.map((point) => point.x)))
    const maxY = Math.ceil(Math.max(...points.map((point) => point.y)))
    const width = Math.max(1, maxX - minX)
    const height = Math.max(1, maxY - minY)
    const ctx = canvasContext()
    const image = ctx.getImageData(minX, minY, width, height)

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!pointInPolygon({ x: x + minX, y: y + minY }, points)) {
          image.data[(y * width + x) * 4 + 3] = 0
        }
      }
    }

    selectionRef.current = {
      x: minX,
      y: minY,
      width,
      height,
      image,
    }
    drawSelectionOutline(null, points)
  }

  function beginPointer(event) {
    if (!propsRef.current.isDrawer) return

    const currentTool = propsRef.current.tool
    const point = pointFromEvent(event)
    const canvas = canvasRef.current
    const ctx = canvasContext()

    canvas.setPointerCapture(event.pointerId)

    if (selectionRef.current && selectionContains(point)) {
      beginMoveSelection(event, point)
      return
    }

    if (!['rectSelect', 'freeSelect'].includes(currentTool)) {
      commitSelection()
    }

    if (currentTool === 'fill') {
      floodFill(point)
      onDrawEvent({ kind: 'fill', point, color: propsRef.current.color })
      canvas.releasePointerCapture(event.pointerId)
      return
    }

    if (currentTool === 'picker') {
      pickColor(point)
      canvas.releasePointerCapture(event.pointerId)
      return
    }

    if (currentTool === 'zoom') {
      setZoom((currentZoom) => (currentZoom >= 2 ? 1 : currentZoom + 0.5))
      canvas.releasePointerCapture(event.pointerId)
      return
    }

    if (currentTool === 'text') {
      insertText(point)
      canvas.releasePointerCapture(event.pointerId)
      return
    }

    if (currentTool === 'spray') {
      actionRef.current = { type: 'spray', pointerId: event.pointerId }
      onDrawEvent({ kind: 'spray', color: propsRef.current.color, dots: sprayAt(point) })
      return
    }

    if (currentTool === 'rectSelect') {
      actionRef.current = { type: 'rectSelect', pointerId: event.pointerId, start: point }
      drawSelectionOutline({ ...normalizeBox(point, point), width: 1, height: 1 })
      return
    }

    if (currentTool === 'freeSelect') {
      actionRef.current = { type: 'freeSelect', pointerId: event.pointerId, points: [point] }
      drawSelectionOutline(null, [point])
      return
    }

    if (['line', 'curve', 'rect', 'poly', 'ellipse', 'round'].includes(currentTool)) {
      actionRef.current = { type: 'shape', tool: currentTool, pointerId: event.pointerId, start: point, color: propsRef.current.color }
      return
    }

    const isEraser = currentTool === 'eraser'
    const isBrush = currentTool === 'brush'
    configureContext(ctx, isEraser ? '#ffffff' : propsRef.current.color, isEraser ? 16 : isBrush ? 8 : 2)
    actionRef.current = { type: 'draw', pointerId: event.pointerId }
    ctx.beginPath()
    ctx.moveTo(point.x, point.y)
    onDrawEvent({
      kind: 'strokeStart',
      point,
      color: isEraser ? '#ffffff' : propsRef.current.color,
      lineWidth: isEraser ? 16 : isBrush ? 8 : 2,
    })
  }

  function movePointer(event) {
    const action = actionRef.current
    if (!action || action.pointerId !== event.pointerId) return

    const point = pointFromEvent(event)
    const ctx = canvasContext()

    if (action.type === 'draw') {
      ctx.lineTo(point.x, point.y)
      ctx.stroke()
      onDrawEvent({ kind: 'strokeMove', point })
      return
    }

    if (action.type === 'spray') {
      onDrawEvent({ kind: 'spray', color: propsRef.current.color, dots: sprayAt(point) })
      return
    }

    if (action.type === 'shape') {
      drawPreviewShape(action, point)
      return
    }

    if (action.type === 'rectSelect') {
      drawSelectionOutline(normalizeBox(action.start, point))
      return
    }

    if (action.type === 'freeSelect') {
      action.points.push(point)
      drawSelectionOutline(null, action.points)
      return
    }

    if (action.type === 'moveSelection') {
      const nextX = point.x - action.offsetX
      const nextY = point.y - action.offsetY
      ctx.putImageData(action.base, 0, 0)
      putImageDataWithAlpha(ctx, action.selection.image, nextX, nextY)
      selectionRef.current = {
        ...action.selection,
        x: Math.round(nextX),
        y: Math.round(nextY),
      }
      drawSelectionOutline(selectionRef.current)
    }
  }

  function endPointer(event) {
    const action = actionRef.current
    if (!action || action.pointerId !== event.pointerId) return

    const point = pointFromEvent(event)

    if (action.type === 'shape') {
      stampPreviewShape(action, point)
      onDrawEvent({
        kind: 'shape',
        tool: action.tool,
        color: action.color,
        start: action.start,
        end: point,
      })
    }

    if (action.type === 'draw') {
      onDrawEvent({ kind: 'strokeEnd' })
    }

    if (action.type === 'rectSelect') {
      createRectSelection(action.start, point)
    }

    if (action.type === 'freeSelect') {
      createFreeSelection(action.points)
    }

    actionRef.current = null
    canvasRef.current.releasePointerCapture(event.pointerId)
  }

  return (
    <div className="drawing-board-frame" style={{ '--canvas-zoom': zoom }}>
      <canvas
        className="drawing-board"
        ref={canvasRef}
        onPointerDown={beginPointer}
        onPointerMove={movePointer}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      />
      <canvas className="drawing-overlay" ref={overlayRef} aria-hidden="true" />
    </div>
  )
}

export default DrawingBoard
