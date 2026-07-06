import { useState } from 'react'
import { login } from '../auth'
import './LoginScreen.css'

function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('Artist')
  const [password, setPassword] = useState('paint')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  async function submitLogin(event) {
    event.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const session = await login(username, password)
      onLogin(session.user)
    } catch (loginError) {
      setError(loginError.message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main className="xp-login-screen">
      <div className="login-top-band" aria-hidden="true" />
      <section className="login-center">
        <div className="login-brand">
          <span className="windows-flag" aria-hidden="true" />
          <h1>DrawXP</h1>
          <p>To begin, click your user name.</p>
        </div>

        <form className="login-panel" onSubmit={submitLogin}>
          <div className="user-tile">
            <span className="user-avatar" aria-hidden="true">D</span>
            <div>
              <label htmlFor="username">User name</label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
          </div>

          <label className="password-row" htmlFor="password">
            Password
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {error && <p className="login-error">{error}</p>}

          <div className="login-actions">
            <button type="submit" disabled={isLoading}>
              {isLoading ? 'Logging on...' : 'Log On'}
            </button>
          </div>
        </form>
      </section>
      <footer className="login-bottom-band">
        <span>After you log on, your JWT session is saved on this computer.</span>
        <span>Demo account: Artist / paint</span>
      </footer>
    </main>
  )
}

export default LoginScreen
