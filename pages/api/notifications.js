import { supabaseAdmin } from '../../lib/supabase'

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await supabaseAdmin
      .from('notifications')
      .select('id, kind, title, body, transaction_id, meta, read, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(100)
    // Before supabase_automation.sql has been run, just show no notifications.
    if (error) return res.status(200).json([])
    return res.status(200).json(data)
  }

  // Mark all as read
  if (req.method === 'POST') {
    const { error } = await supabaseAdmin.from('notifications').update({ read: true }).eq('read', false)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }

  res.status(405).end()
}
