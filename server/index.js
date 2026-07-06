import crypto from 'node:crypto'
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
  const input = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))
  return input.toString('base64url')
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

function jsonResponse(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  })
  response.end(JSON.stringify(body))
}

async function readJsonBody(request) {
  const chunks = []

  for await (const chunk of request) {
    chunks.push(chunk)
  }

  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
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

function createRoom(id) {
  return {
    id,
    word: WORDS[Math.floor(Math.random() * WORDS.length)],
    drawerId: null,
    players: new Map(),
    clients: new Map(),
    history: [],
    chat: [],
  }
}

function getRoom(id) {
  if (!rooms.has(id)) rooms.set(id, createRoom(id))
  return rooms.get(id)
}

function sendFrame(socket, payload) {
  const message = Buffer.from(JSON.stringify(payload))
  const header = []

  header.push(0x81)
  if (message.length < 126) {
    header.push(message.length)
  } else if (message.length < 65536) {
    header.push(126, (message.length >> 8) & 255, message.length & 255)
  } else {
    header.push(127, 0, 0, 0, 0, (message.length >> 24) & 255, (message.length >> 16) & 255, (message.length >> 8) & 255, message.length & 255)
  }

  socket.write(Buffer.concat([Buffer.from(header), message]))
}

function broadcast(room, payload, exceptId = null) {
  room.clients.forEach((client, clientId) => {
    if (clientId !== exceptId) sendFrame(client, payload)
  })
}

function parseFrames(buffer) {
  const messages = []
  let offset = 0

  while (offset + 2 <= buffer.length) {
    const firstByte = buffer[offset]
    const secondByte = buffer[offset + 1]
    const opcode = firstByte & 0x0f
    const isMasked = (secondByte & 0x80) !== 0
    let length = secondByte & 0x7f
    let headerLength = 2

    if (length === 126) {
      if (offset + 4 > buffer.length) break
      length = buffer.readUInt16BE(offset + 2)
      headerLength = 4
    } else if (length === 127) {
      if (offset + 10 > buffer.length) break
      length = Number(buffer.readBigUInt64BE(offset + 2))
      headerLength = 10
    }

    const maskLength = isMasked ? 4 : 0
    const frameEnd = offset + headerLength + maskLength + length
    if (frameEnd > buffer.length) break

    const mask = isMasked ? buffer.subarray(offset + headerLength, offset + headerLength + 4) : null
    const payload = buffer.subarray(offset + headerLength + maskLength, frameEnd)

    if (opcode === 8) {
      messages.push({ type: 'close' })
    } else if (opcode === 1) {
      const data = Buffer.alloc(payload.length)
      payload.forEach((byte, index) => {
        data[index] = mask ? byte ^ mask[index % 4] : byte
      })
      messages.push({ type: 'text', data: data.toString('utf8') })
    }

    offset = frameEnd
  }

  return { messages, remaining: buffer.subarray(offset) }
}

function handleGuess(room, player, text) {
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
    room.history = []
    const players = [...room.players.keys()]
    const currentIndex = players.indexOf(room.drawerId)
    room.drawerId = players[(currentIndex + 1) % players.length]
    broadcast(room, { type: 'clearCanvas' })
  }

  room.chat.push(message)
  room.chat = room.chat.slice(-50)
  broadcast(room, { type: 'chat', message })
  broadcast(room, { type: 'room', room: roomPayload(room) })
}

function handleSocketMessage(room, player, clientId, message) {
  if (message.type === 'draw' && clientId === room.drawerId) {
    room.history.push(message.event)
    room.history = room.history.slice(-2000)
    broadcast(room, { type: 'draw', event: message.event }, clientId)
    return
  }

  if (message.type === 'guess') {
    handleGuess(room, player, message.text || '')
  }
}

function handleWebSocket(request, socket) {
  const url = new URL(request.url, `http://${request.headers.host}`)
  const token = url.searchParams.get('token')
  const roomId = (url.searchParams.get('room') || 'lobby').slice(0, 32)
  const user = verifyToken(token)

  if (!user) {
    socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n')
    return
  }

  const key = request.headers['sec-websocket-key']
  const accept = crypto
    .createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64')

  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '\r\n',
  ].join('\r\n'))

  const room = getRoom(roomId)
  const clientId = crypto.randomUUID()
  const player = {
    id: clientId,
    name: user.displayName,
    score: 0,
  }

  room.players.set(clientId, player)
  room.clients.set(clientId, socket)
  if (!room.drawerId) room.drawerId = clientId

  sendFrame(socket, {
    type: 'welcome',
    clientId,
    room: roomPayload(room),
    history: room.history,
    chat: room.chat,
  })
  broadcast(room, { type: 'room', room: roomPayload(room) })

  let buffered = Buffer.alloc(0)
  socket.on('data', (chunk) => {
    buffered = Buffer.concat([buffered, chunk])
    const parsed = parseFrames(buffered)
    buffered = parsed.remaining

    parsed.messages.forEach((frame) => {
      if (frame.type === 'close') {
        socket.end()
        return
      }

      try {
        handleSocketMessage(room, player, clientId, JSON.parse(frame.data))
      } catch {
        sendFrame(socket, { type: 'error', message: 'Bad message' })
      }
    })
  })

  socket.on('close', () => {
    room.players.delete(clientId)
    room.clients.delete(clientId)
    if (room.drawerId === clientId) {
      room.drawerId = room.players.keys().next().value || null
    }
    broadcast(room, { type: 'room', room: roomPayload(room) })
    if (room.players.size === 0) rooms.delete(room.id)
  })

  socket.on('error', () => {
    room.players.delete(clientId)
    room.clients.delete(clientId)
    if (room.drawerId === clientId) {
      room.drawerId = room.players.keys().next().value || null
    }
    broadcast(room, { type: 'room', room: roomPayload(room) })
    if (room.players.size === 0) rooms.delete(room.id)
  })
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`)
  const requestedPath = url.pathname === '/' ? '/index.html' : url.pathname
  const filePath = path.resolve(distDir, `.${requestedPath}`)

  if (!filePath.startsWith(distDir)) {
    response.writeHead(403)
    response.end()
    return
  }

  try {
    const file = await readFile(filePath)
    const extension = path.extname(filePath)
    const contentTypes = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
    }
    response.writeHead(200, { 'Content-Type': contentTypes[extension] || 'application/octet-stream' })
    response.end(file)
  } catch {
    const fallback = await readFile(path.join(distDir, 'index.html'))
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end(fallback)
  }
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    jsonResponse(response, 204, {})
    return
  }

  if (request.url === '/api/login' && request.method === 'POST') {
    const { username = '', password = '' } = await readJsonBody(request)
    const user = users.get(username.trim().toLowerCase())

    if (!user || user.password !== password) {
      jsonResponse(response, 401, { message: 'The user name or password is incorrect.' })
      return
    }

    jsonResponse(response, 200, {
      token: createToken(user),
      user: {
        username: user.username,
        displayName: user.displayName,
      },
    })
    return
  }

  if (request.url === '/api/session' && request.method === 'GET') {
    const token = request.headers.authorization?.replace('Bearer ', '')
    const user = verifyToken(token)
    jsonResponse(response, user ? 200 : 401, user ? { user } : { message: 'Unauthorized' })
    return
  }

  await serveStatic(request, response)
})

server.on('upgrade', (request, socket) => {
  if (!request.url?.startsWith('/ws')) {
    socket.end('HTTP/1.1 404 Not Found\r\n\r\n')
    return
  }

  handleWebSocket(request, socket)
})

server.listen(PORT, () => {
  console.log(`DrawXP server running at http://127.0.0.1:${PORT}`)
})
