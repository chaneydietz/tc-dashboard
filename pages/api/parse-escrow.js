export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { pdfBase64 } = req.body
  if (!pdfBase64) return res.status(400).json({ error: 'No PDF provided' })

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 }
            },
            {
              type: 'text',
              text: `Extract all deadlines and dates from this escrow timeline document. Return ONLY a JSON array, no other text, no markdown backticks. Each item should have "name" (string describing the deadline) and "date" (in YYYY-MM-DD format). Example: [{"name":"Close of Escrow","date":"2026-07-20"},{"name":"Buyer Initial Deposit Due","date":"2026-06-08"}]. Include every date mentioned: COE, deposits, contingency removals, inspection periods, document deliveries, and all other milestones.`
            }
          ]
        }]
      })
    })

    const data = await response.json()
    if (!response.ok) {
      console.error('Anthropic error:', data)
      return res.status(500).json({ error: data.error?.message || 'AI error' })
    }

    const text = data.content?.map(c => c.text || '').join('') || ''
    const clean = text.replace(/```json|```/g, '').trim()
    const deadlines = JSON.parse(clean)

    return res.status(200).json({ deadlines })
  } catch (err) {
    console.error('Parse error:', err)
    return res.status(500).json({ error: 'Failed to parse PDF' })
  }
}
