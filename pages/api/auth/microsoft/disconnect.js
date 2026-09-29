import { supabaseAdmin } from '../../../../lib/supabase'

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).end()
  const { agent } = req.query
  if (!agent) return res.status(400).json({ error: 'Missing agent name' })

  const { error } = await supabaseAdmin
    .from('outlook_connections')
    .delete()
    .eq('agent_name', agent)

  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ ok: true })
}
