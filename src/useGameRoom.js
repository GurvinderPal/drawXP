import { useCallback, useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { getStoredToken } from './auth'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3001'

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

    const socket = io(API_BASE_URL, {
      auth: {
        room: roomId,
        token,
      },
      transports: ['websocket'],
    })
    socketRef.current = socket

    socket.on('connect', () => {
      setStatus('connected')
    })

    socket.on('welcome', (message) => {
      setClientId(message.clientId)
      setRoom(message.room)
      setHistory(message.history || [])
      setChat(message.chat?.length ? message.chat : [systemMessage(`Joined room ${message.room.id}.`)])
    })

    socket.on('room', (nextRoom) => {
      setRoom(nextRoom)
    })

    socket.on('draw', (event) => {
      setRemoteEvent(event)
    })

    socket.on('chat', (message) => {
      setChat((currentChat) => [...currentChat, message].slice(-50))
    })

    socket.on('clearCanvas', () => {
      setHistory([])
      setClearSignal((signal) => signal + 1)
    })

    socket.on('disconnect', () => {
      setStatus('disconnected')
    })

    socket.on('connect_error', () => {
      setStatus('error')
    })

    return () => {
      socket.disconnect()
    }
  }, [roomId, user])

  const sendDrawEvent = useCallback((drawEvent) => {
    socketRef.current?.emit('draw', drawEvent)
  }, [])

  const sendGuess = useCallback((text) => {
    const trimmed = text.trim()
    if (!trimmed) return
    socketRef.current?.emit('guess', trimmed)
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
