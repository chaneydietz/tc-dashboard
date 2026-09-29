import { supabaseAdmin } from '../../../lib/supabase'
import { sendMail } from '../../../lib/microsoftGraph'

function pacificDateString(daysFromNow) {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d) // YYYY-MM-DD
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end()
  }

  const targetDate = pacificDateString(2) // 2 days from today, Pacific time

  const { data: transactions, error: txError } = await supabaseAdmin
    .from('transactions')
    .select('address, coe, timeline_groups')

  if (txError) {
    console.error('Supabase error:', txError)
    return res.status(500).json({ error: txError.message })
  }

  const { data: connections, error: connError } = await supabaseAdmin
    .from('outlook_connections')
    .select('agent_name, email')

  if (connError) {
    console.error('Supabase error:', connError)
    return res.status(500).json({ error: connError.message })
  }

  const recipients = (connections || []).map(c => c.email).filter(Boolean)
  if (recipients.length === 0) return res.status(200).json({ sent: 0, reason: 'no_connected_emails' })

  const senderAgent = connections[0].agent_name // send using whichever account is connected
  let sent = 0

  for (const tx of transactions || []) {
    const crGroup = (tx.timeline_groups || []).find(
      g => g.date === targetDate && /contingency/i.test(g.label)
    )
    if (crGroup) {
      await sendMail(senderAgent, {
        to: recipients,
        subject: `CR Reminder — ${tx.address}`,
        body: `Hi all, this is a reminder that CR for ${tx.address} is on ${targetDate}.`
      })
      sent++
    }

    if (tx.coe === targetDate) {
      await sendMail(senderAgent, {
        to: recipients,
        subject: `COE Reminder — ${tx.address}`,
        body: `Hi All, this is a reminder that COE for ${tx.address} is on ${targetDate}. Yay!`
      })
      sent++
    }
  }

  return res.status(200).json({ sent, targetDate })
}
