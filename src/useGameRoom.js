import { useCallback, useEffect, useRef, useState } from 'react'
import { getStoredToken } from './auth'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3001'
const WS_BASE_URL = API_BASE_URL.replace(/^http/, 'ws')

function systemMessage(text) {
  return {
    id: crypto.randomUUID(),
    type: 'system',
    player: 'DrawXP',
    text,
    createdAt: Date.now(),
  }
}

export function useGameRoom(roomId, user) {
  const socketRef = useRef(null)
  const [clientId, setClientId] = useState(null)
  const [room, setRoom] = useState(null)
  const [history, setHistory] = useState([])
  const [remoteEvent, setRemoteEvent] = useState(null)
  const [clearSignal, setClearSignal] = useState(0)
  const [chat, setChat] = useState([])
  const [status, setStatus] = useState('connecting')

  useEffect(() => {
    const token = getStoredToken()
    if (!token || !user) return undefined

    const socket = new WebSocket(`${WS_BASE_URL}/ws?room=${encodeURIComponent(roomId)}&token=${encodeURIComponent(token)}`)
    socketRef.current = socket

    socket.addEventListener('open', () => {
      setStatus('connected')
    })

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)

      if (message.type === 'welcome') {
        setClientId(message.clientId)
        setRoom(message.room)
        setHistory(message.history || [])
        setChat(message.chat?.length ? message.chat : [systemMessage(`Joined room ${message.room.id}.`)])
      }

      if (message.type === 'room') {
        setRoom(message.room)
      }

      if (message.type === 'draw') {
        setRemoteEvent(message.event)
      }

      if (message.type === 'chat') {
        setChat((currentChat) => [...currentChat, message.message].slice(-50))
      }

      if (message.type === 'clearCanvas') {
        setHistory([])
        setClearSignal((signal) => signal + 1)
      }
    })

    socket.addEventListener('close', () => {
      setStatus('disconnected')
    })

    socket.addEventListener('error', () => {
      setStatus('error')
    })

    return () => {
      socket.close()
    }
  }, [roomId, user])

  const sendDrawEvent = useCallback((drawEvent) => {
    const socket = socketRef.current
    if (socket?.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify({ type: 'draw', event: drawEvent }))
  }, [])

  const sendGuess = useCallback((text) => {
    const trimmed = text.trim()
    const socket = socketRef.current
    if (!trimmed || socket?.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify({ type: 'guess', text: trimmed }))
  }, [])

  return {
    chat,
    clearSignal,
    clientId,
    history,
    isDrawer: room?.drawerId === clientId,
    remoteEvent,
    room,
    sendDrawEvent,
    sendGuess,
    status,
  }
}
