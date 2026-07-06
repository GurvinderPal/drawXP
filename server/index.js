import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import http from 'node:http'
import { Server } from 'socket.io'

const PORT = Number.parseInt(process.env.PORT || '3001', 10)
const JWT_SECRET = process.env.JWT_SECRET || 'drawxp-dev-secret-change-me'
const TOKEN_TTL_SECONDS = 60 * 60 * 8
const WORDS = ['house', 'pizza', 'rocket', 'castle', 'computer', 'rainbow', 'chair', 'flower']

const users = new Map([
  ['artist', { username: 'Artist', password: 'paint', displayName: 'Artist' }],
])
const rooms = new Map()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(__dirname, '../dist')

function base64UrlEncode(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url')
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function sign(value) {
  return crypto.createHmac('sha256', JWT_SECRET).update(value).digest('base64url')
}

function createToken(user) {
  const header = base64UrlEncode({ alg: 'HS256', typ: 'JWT' })
  const payload = base64UrlEncode({
    sub: user.username,
    name: user.displayName,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  })
  const unsigned = `${header}.${payload}`

  return `${unsigned}.${sign(unsigned)}`
}

function verifyToken(token) {
  if (!token) return null

  const parts = token.split('.')
  if (parts.length !== 3) return null

  const [header, payload, signature] = parts
  if (signature !== sign(`${header}.${payload}`)) return null

  const decoded = JSON.parse(base64UrlDecode(payload))
  if (!decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) return null

  return {
    username: decoded.sub,
    displayName: decoded.name,
  }
}

function createRoom(id) {
  return {
    id,
    word: WORDS[Math.floor(Math.random() * WORDS.length)],
    drawerId: null,
    players: new Map(),
    history: [],
    chat: [],
  }
}

function getRoom(id) {
  if (!rooms.has(id)) rooms.set(id, createRoom(id))
  return rooms.get(id)
}

function roomPayload(room) {
  return {
    id: room.id,
    wordHint: room.word.replace(/[a-z]/gi, '_'),
    drawerId: room.drawerId,
    players: [...room.players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      score: player.score,
      isDrawer: player.id === room.drawerId,
    })),
  }
}

function broadcastRoom(io, room) {
  io.to(room.id).emit('room', roomPayload(room))
}

function clearRoomCanvas(io, room) {
  room.history = []
  io.to(room.id).emit('clearCanvas')
}

function rotateDrawer(room) {
  const players = [...room.players.keys()]
  if (players.length === 0) {
    room.drawerId = null
    return
  }

  const currentIndex = players.indexOf(room.drawerId)
  room.drawerId = players[(currentIndex + 1) % players.length]
}

function handleGuess(io, room, player, text) {
  const normalized = text.trim().toLowerCase()
  const isCorrect = normalized === room.word.toLowerCase() && player.id !== room.drawerId
  const message = {
    id: crypto.randomUUID(),
    type: isCorrect ? 'system' : 'guess',
    player: player.name,
    text: isCorrect ? `${player.name} guessed the word!` : text,
    createdAt: Date.now(),
  }

  if (isCorrect) {
    player.score += 10
    room.word = WORDS[Math.floor(Math.random() * WORDS.length)]
    rotateDrawer(room)
    clearRoomCanvas(io, room)
  }

  room.chat.push(message)
  room.chat = room.chat.slice(-50)
  io.to(room.id).emit('chat', message)
  broadcastRoom(io, room)
}

const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
})

app.use(express.json())
app.use(express.static(distDir))

app.post('/api/login', (request, response) => {
  const { username = '', password = '' } = request.body
  const user = users.get(username.trim().toLowerCase())

  if (!user || user.password !== password) {
    response.status(401).json({ message: 'The user name or password is incorrect.' })
    return
  }

  response.json({
    token: createToken(user),
    user: {
      username: user.username,
      displayName: user.displayName,
    },
  })
})

app.get('/api/session', (request, response) => {
  const token = request.headers.authorization?.replace('Bearer ', '')
  const user = verifyToken(token)

  if (!user) {
    response.status(401).json({ message: 'Unauthorized' })
    return
  }

  response.json({ user })
})

app.get('*', (_request, response) => {
  response.sendFile(path.join(distDir, 'index.html'))
})

io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token
  const user = verifyToken(token)

  if (!user) {
    next(new Error('Unauthorized'))
    return
  }

  socket.user = user
  next()
})

io.on('connection', (socket) => {
  const roomId = String(socket.handshake.auth?.room || socket.handshake.query?.room || 'lobby').slice(0, 32)
  const room = getRoom(roomId)
  const player = {
    id: socket.id,
    name: socket.user.displayName,
    score: 0,
  }

  room.players.set(socket.id, player)
  if (!room.drawerId) room.drawerId = socket.id
  socket.join(room.id)

  socket.emit('welcome', {
    clientId: socket.id,
    room: roomPayload(room),
    history: room.history,
    chat: room.chat,
  })
  broadcastRoom(io, room)

  socket.on('draw', (event) => {
    if (socket.id !== room.drawerId) return

    room.history.push(event)
    room.history = room.history.slice(-2000)
    socket.to(room.id).emit('draw', event)
  })

  socket.on('guess', (text) => {
    handleGuess(io, room, player, text || '')
  })

  socket.on('disconnect', () => {
    room.players.delete(socket.id)
    if (room.drawerId === socket.id) rotateDrawer(room)

    if (room.players.size === 0) {
      rooms.delete(room.id)
      return
    }

    broadcastRoom(io, room)
  })
})

server.listen(PORT, () => {
  console.log(`DrawXP server running at http://127.0.0.1:${PORT}`)
})
