import { supabase } from '../../lib/supabase'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const { data, error } = await supabase
    .from('outlook_connections')
    .select('agent_name, connected_at')

  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json(data)
}
