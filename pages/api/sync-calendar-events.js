import { createCalendarEvent } from '../../lib/microsoftGraph'
import { supabaseAdmin } from '../../lib/supabase'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { address, coe, timelineGroups, agentName } = req.body

  const toCreate = []
  ;(timelineGroups || []).forEach(g => {
   if (g.date && g.date !== 'TBD' && /contingency/i.test(g.label)) {
  toCreate.push({
    subject: `CR - ${address}`,
    date: g.date,
    body: g.label
  })
}
  })
 if (coe) {
  toCreate.push({
    subject: `COE-${address}`,
    date: coe,
    body: 'Close of Escrow'
  })
}

  if (toCreate.length === 0) {
    return res.status(200).json({ created: 0, total: 0 })
  }

  const { data: connections, error } = await supabaseAdmin
    .from('outlook_connections')
    .select('agent_name')

  if (error) {
    console.error('Supabase error fetching connections:', error)
    return res.status(500).json({ error: error.message })
  }

  let created = 0
  const errors = []
  for (const { agent_name } of connections || []) {
    for (const item of toCreate) {
      const result = await createCalendarEvent(agent_name, item)
      if (result.id) created++
      else if (result.error) errors.push(`${agent_name}: ${result.error}`)
    }
  }

  return res.status(200).json({ created, total: toCreate.length * (connections?.length || 0), errors })
}
