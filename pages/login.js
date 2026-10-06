import { useState } from 'react'
import { useRouter } from 'next/router'

export default function Login() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const router = useRouter()

  async function submit(e) {
    e.preventDefault()
    setError('')
    const res = await fetch('/api/check-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    })
    if (res.ok) {
      router.push('/')
    } else {
      setError('Incorrect password.')
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'linear-gradient(160deg, #0B2545 0%, #13315C 100%)' }}>
      <form onSubmit={submit} style={{ background: '#fff', padding: 36, borderRadius: 14, boxShadow: '0 20px 50px rgba(0,0,0,0.3)', width: 340 }}>
        <div style={{ fontWeight: 700, fontSize: 20, color: '#0B2545', marginBottom: 4 }}>TC Dashboard</div>
        <div style={{ fontSize: 13, color: '#6B778A', marginBottom: 20 }}>Enter the team password to continue</div>
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoFocus
          style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #C9D3E2', marginBottom: 12, fontSize: 14 }}
        />
        {error && <div style={{ color: '#A32D2D', fontSize: 13, marginBottom: 12 }}>{error}</div>}
        <button type="submit" className="btn-primary" style={{ width: '100%', padding: 10 }}>Enter</button>
      </form>
    </div>
  )
}
