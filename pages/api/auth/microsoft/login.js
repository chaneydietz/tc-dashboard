export default function handler(req, res) {
  const { agent } = req.query
  if (!agent) return res.status(400).json({ error: 'Missing agent name' })

  const tenantId = process.env.MICROSOFT_TENANT_ID
  const clientId = process.env.MICROSOFT_CLIENT_ID
  const redirectUri = `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/microsoft/callback`

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: 'offline_access Calendars.ReadWrite Mail.Send User.Read',
    state: Buffer.from(JSON.stringify({ agent })).toString('base64url')
  })

  res.redirect(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`)
}
