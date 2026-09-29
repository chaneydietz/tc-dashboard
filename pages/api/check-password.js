export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { password } = req.body
  if (password === process.env.SITE_PASSWORD) {
    res.setHeader('Set-Cookie', `site_auth=${process.env.SITE_PASSWORD}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`)
    return res.status(200).json({ ok: true })
  }
  return res.status(401).json({ error: 'Incorrect password' })
}
