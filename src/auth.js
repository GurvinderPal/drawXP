const TOKEN_KEY = 'drawxp.jwt'
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3001'

export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export async function verifyToken(token) {
  if (!token) return null

  const response = await fetch(`${API_BASE_URL}/api/session`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    clearToken()
    return null
  }

  const data = await response.json()
  return data.user
}

export async function login(username, password) {
  const response = await fetch(`${API_BASE_URL}/api/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.message || 'The system could not log you on.')
  }

  localStorage.setItem(TOKEN_KEY, data.token)

  return {
    token: data.token,
    user: data.user,
  }
}
