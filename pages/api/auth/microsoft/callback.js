import { supabaseAdmin } from '../../../../lib/supabase'

export default async function handler(req, res) {
  const { code, state, error } = req.query
  if (error) return res.status(400).send(`Microsoft returned an error: ${error}`)
  if (!code || !state) return res.status(400).send('Missing code or state')

  let agent
  try {
    agent = JSON.parse(Buffer.from(state, 'base64url').toString()).agent
  } catch {
    return res.status(400).send('Invalid state')
  }

  const tenantId = process.env.MICROSOFT_TENANT_ID
  const redirectUri = `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/microsoft/callback`

  const tokenRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      scope: 'offline_access Calendars.ReadWrite Mail.Send User.Read'
    })
  })

  const tokenData = await tokenRes.json()
  if (!tokenRes.ok) {
    console.error('Token exchange failed:', tokenData)
    return res.status(500).send('Failed to connect Outlook: ' + (tokenData.error_description || tokenData.error))
  }

  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString()

  const { error: dbError } = await supabase
    .from('outlook_connections')
    .upsert({
      agent_name: agent,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: expiresAt
    }, { onConflict: 'agent_name' })

  if (dbError) {
    console.error('Supabase error:', dbError)
    return res.status(500).send('Connected to Microsoft, but failed to save. Try again.')
  }

  res.redirect('/?outlook=connected')
}
