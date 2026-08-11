// Extracts escrow timeline data (dates + fee allocations) from a purchase
// agreement plus any counters/addenda. Documents must be passed in
// chronological order — later documents (counters/addenda) win when they
// conflict with earlier terms.

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '40mb'
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' })
  }

  const { documents } = req.body // [{ name: 'Purchase Agreement.pdf', pdfBase64: '...' }, ...]
  if (!Array.isArray(documents) || documents.length === 0) {
    return res.status(400).json({ error: 'No documents provided' })
  }

  const instructions = `You are helping a real estate transaction coordinator build an escrow timeline from contract documents.

The documents above are provided in chronological order: the original purchase agreement first, followed by any counter offers or addenda in the order they were signed. There may be several counters and addenda — sometimes five or six or more, especially with multiple counters going back and forth between buyer and seller. LATER DOCUMENTS OVERRIDE EARLIER ONES wherever their terms conflict (e.g. a counter changing the close-of-escrow date, or an addendum changing who pays a fee). Work through the documents in order and keep a running picture of the current, most up-to-date value for every field — the last document to touch a given term always wins, no matter how many documents came before it. If two documents signed on the same day both amend the same term, prefer whichever one is more specific or was clearly signed later based on any timestamps present.

Return ONLY a single JSON object, no other text, no markdown backticks, matching this exact shape:

{
  "propertyAddress": "Full property address as written in the contract",
  "seller": "Full name(s) of seller(s)",
  "buyer": "Full name(s) of buyer(s)",
  "purchasePrice": "e.g. $549,000",
  "apn": "Assessor's Parcel Number if present, else empty string",
  "escrowCompany": "Escrow/title company name if present, else empty string",
  "escrowNumber": "Escrow number if present, else empty string",
  "acceptanceDate": "YYYY-MM-DD, the date of final acceptance of the contract (as amended)",
  "closeOfEscrow": "YYYY-MM-DD",
  "timelineGroups": [
    {
      "label": "Short label, e.g. 'Date of Acceptance', 'Buyer's Initial Deposit of $16,470 Due On', '3 Days from Acceptance', '17 Days from Acceptance', 'Within 5 Days of COE', 'Close of Escrow'",
      "date": "YYYY-MM-DD, or TBD if not determinable",
      "items": ["Any sub-items/tasks tied to this date, e.g. 'Seller delivery of documents'. Empty array if the label is self-explanatory (like a deposit amount or COE)."]
    }
  ],
  "feeAllocations": [
    "One string per fee/cost allocation term, e.g. 'Seller and Buyer to split escrow fee, title insurance policy, and home warranty not to exceed $1,000', 'Seller to pay county transfer tax and point of sale reports', 'Buyer to pay HOA transfer fees'"
  ],
  "notes": [
    "Any caveats worth flagging to the person reviewing this, e.g. 'Day 7 fell on a weekend and was moved to the next business day', or 'Counter #2 changed the close of escrow date from 8/1 to 8/3', or 'Could not determine escrow number — not present in any document'"
  ]
}

Include every date-driven milestone typically found in a CA residential purchase agreement and its counters/addenda: date of acceptance, initial and any additional deposits, contingency removal periods (inspection/loan/appraisal/insurance), document delivery deadlines, verification of property, home warranty, close of escrow, and any custom dates added via addenda. If a date is expressed as "X days from acceptance," calculate the actual calendar date from the acceptance date, and if it falls on a weekend or federal holiday, move it to the next business day and note that in "notes". If a field cannot be determined from the documents, use an empty string (or "TBD" for dates).`

  const content = []
  for (const doc of documents) {
    content.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: doc.pdfBase64 }
    })
  }
  content.push({ type: 'text', text: instructions })

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 16000,
        messages: [{ role: 'user', content }]
      })
    })

    const data = await response.json()
    if (!response.ok) {
      console.error('Anthropic error:', JSON.stringify(data))
      return res.status(500).json({ error: data.error?.message || 'AI error', details: data })
    }

    const text = data.content?.map(c => c.text || '').join('') || ''
    const clean = text.replace(/```json|```/g, '').trim()
    const extracted = JSON.parse(clean)

    return res.status(200).json({ extracted })
  } catch (err) {
    console.error('Parse-contract error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
