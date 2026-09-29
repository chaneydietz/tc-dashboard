import { supabaseAdmin } from './supabase'

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

async function refreshAccessToken(agentName, refreshToken) {
  const tenantId = process.env.MICROSOFT_TENANT_ID
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: 'offline_access Calendars.ReadWrite Mail.Send User.Read'
    })
  })
  const data = await res.json()
  if (!res.ok) throw new Error('Token refresh failed: ' + (data.error_description || data.error))

  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString()
  await supabaseAdmin
    .from('outlook_connections')
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token || refreshToken,
      expires_at: expiresAt
    })
    .eq('agent_name', agentName)

  return data.access_token
}

// Returns a valid access token for this agent, refreshing it first if it's
// expired or about to expire. Returns null if the agent hasn't connected Outlook.
export async function getValidAccessToken(agentName) {
  const { data, error } = await supabaseAdmin
    .from('outlook_connections')
    .select('access_token, refresh_token, expires_at')
    .eq('agent_name', agentName)
    .maybeSingle()

  if (error || !data) return null

  const expiresAt = new Date(data.expires_at).getTime()
  const bufferMs = 5 * 60 * 1000 // refresh 5 min before actual expiry
  if (Date.now() < expiresAt - bufferMs) return data.access_token

  return refreshAccessToken(agentName, data.refresh_token)
}

// Creates an all-day Outlook event with a reminder set to fire the day
// before at 9am. (For an all-day event starting at local midnight, "900
// minutes before start" lands exactly on 9am the previous day.)
export async function createCalendarEvent(agentName, { subject, date, body }) {
  const accessToken = await getValidAccessToken(agentName)
  if (!accessToken) return { skipped: true, reason: 'not_connected' }

  const nextDay = new Date(date)
  nextDay.setDate(nextDay.getDate() + 1)
  const endDate = nextDay.toISOString().slice(0, 10)

  const event = {
    subject,
    body: { contentType: 'Text', content: body || '' },
    start: { dateTime: `${date}T00:00:00`, timeZone: 'America/Los_Angeles' },
    end: { dateTime: `${endDate}T00:00:00`, timeZone: 'America/Los_Angeles' },
    isAllDay: true,
    isReminderOn: true,
    reminderMinutesBeforeStart: 900
  }

  const res = await fetch(`${GRAPH_BASE}/me/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(event)
  })
  const data = await res.json()
  if (!res.ok) {
    console.error('Graph create event error:', JSON.stringify(data))
    return { error: data.error?.message || 'Failed to create event' }
  }
  return { id: data.id }
}
