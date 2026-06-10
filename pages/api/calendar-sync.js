import { getServerSession } from 'next-auth'
import { authOptions } from './auth/[...nextauth]'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const session = await getServerSession(req, res, authOptions)
  if (!session?.accessToken) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  const { deadlines, address } = req.body
  if (!deadlines || !Array.isArray(deadlines)) {
    return res.status(400).json({ error: 'No deadlines provided' })
  }

  const results = []
  const errors = []

  for (const deadline of deadlines) {
    try {
      const event = {
        summary: `${deadline.name} — ${address || 'Transaction'}`,
        description: `TC Dashboard deadline for ${address || 'transaction'}.\n\nDeadline: ${deadline.name}`,
        start: { date: deadline.date },
        end: { date: deadline.date },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 3 * 24 * 60 },
            { method: 'popup', minutes: 3 * 24 * 60 },
          ],
        },
      }

      const response = await fetch(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(event),
        }
      )

      const data = await response.json()
      if (!response.ok) {
        errors.push({ deadline: deadline.name, error: data.error?.message })
      } else {
        results.push({ deadline: deadline.name, eventId: data.id })
      }
    } catch (err) {
      errors.push({ deadline: deadline.name, error: err.message })
    }
  }

  return res.status(200).json({ results, errors, created: results.length })
}
