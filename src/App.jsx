import { useEffect, useState } from 'react'
import { clearToken, getStoredToken, verifyToken } from './auth'
import DrawingWindow from './components/Canvas'
import LoginScreen from './components/LoginScreen'

function App() {
  const [user, setUser] = useState(null)
  const [isCheckingSession, setIsCheckingSession] = useState(true)

  useEffect(() => {
    let isMounted = true

    async function restoreSession() {
      const verifiedUser = await verifyToken(getStoredToken())

      if (!isMounted) return
      setUser(verifiedUser)
      setIsCheckingSession(false)
    }

    restoreSession()

    return () => {
      isMounted = false
    }
  }, [])

  function logout() {
    clearToken()
    setUser(null)
  }

  if (isCheckingSession) {
    return <div className="session-loader">Loading DrawXP...</div>
  }

  if (!user) {
    return <LoginScreen onLogin={setUser} />
  }

  return <DrawingWindow roomId="lobby" user={user} onLogout={logout} />
}

export default App
