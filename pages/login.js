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
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#f4f4f0' }}>
      <form onSubmit={submit} style={{ background: '#fff', padding: 32, borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,0.08)', width: 320 }}>
        <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 16 }}>TC Dashboard</div>
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoFocus
          style={{ width: '100%', padding: 10, borderRadius: 6, border: '1px solid #ddd', marginBottom: 12 }}
        />
        {error && <div style={{ color: '#A32D2D', fontSize: 13, marginBottom: 12 }}>{error}</div>}
        <button type="submit" className="btn-primary" style={{ width: '100%' }}>Enter</button>
      </form>
    </div>
  )
}
