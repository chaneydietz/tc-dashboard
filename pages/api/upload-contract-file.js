// Uploads a single PDF to Anthropic's Files API and returns a file_id.
// Keeping this endpoint one-file-at-a-time means each request stays small,
// which avoids Vercel's hard ~4.5MB request body limit for serverless
// functions — a limit that can't be raised via Next.js bodyParser config.

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4mb'
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' })
  }

  const { pdfBase64, filename } = req.body
  if (!pdfBase64) return res.status(400).json({ error: 'No file provided' })

  try {
    const buffer = Buffer.from(pdfBase64, 'base64')
    const form = new FormData()
    form.append('file', new Blob([buffer], { type: 'application/pdf' }), filename || 'document.pdf')

    const response = await fetch('https://api.anthropic.com/v1/files', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'files-api-2025-04-14',
      },
      body: form
    })

    const data = await response.json()
    if (!response.ok) {
      console.error('Anthropic file upload error:', JSON.stringify(data))
      return res.status(500).json({ error: data.error?.message || 'Upload error', details: data })
    }

    return res.status(200).json({ fileId: data.id })
  } catch (err) {
    console.error('Upload error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
