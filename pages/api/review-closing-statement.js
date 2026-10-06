// Reviews an estimated/final closing statement against the escrow's contract
// terms and any inspector/vendor invoices, and flags anything that doesn't
// match. PDFs are uploaded first via /api/upload-contract-file (one at a time,
// to stay under Vercel's request size limit) and passed here by file id.

import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '../../lib/supabase'

export const config = { maxDuration: 300 }

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'checks'],
  properties: {
    summary: { type: 'string' },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['item', 'expected', 'found', 'status', 'note'],
        properties: {
          item: { type: 'string' },
          expected: { type: 'string' },
          found: { type: 'string' },
          status: { type: 'string', enum: ['ok', 'mismatch', 'missing', 'review'] },
          note: { type: 'string' },
        },
      },
    },
  },
}

function contractFacts(tx) {
  const c = tx.contacts || {}
  const lines = [
    `Property: ${tx.address || 'unknown'}`,
    `We represent: ${tx.side === 'both' ? 'both buyer and seller' : tx.side === 'buyer' ? 'the buyer' : 'the seller'}`,
    `Purchase price: ${tx.price || 'unknown'}`,
    `Buyer: ${tx.buyer || c.buyerName || 'unknown'}`,
    `Seller: ${tx.seller || c.sellerName || 'unknown'}`,
    `Close of escrow: ${tx.coe || 'unknown'}`,
    `Escrow company / number: ${tx.escrow_company || c.escrowCo || 'unknown'} / ${tx.escrow_number || 'unknown'}`,
  ]
  const deposits = (tx.timeline_groups || []).filter(g => /deposit/i.test(g.label || ''))
  if (deposits.length) lines.push(`Deposits per contract:\n${deposits.map(g => `  - ${g.label} (${g.date})`).join('\n')}`)
  const fees = tx.fee_allocations || []
  if (fees.length) lines.push(`Fee and cost allocations per contract:\n${fees.map(f => `  - ${f}`).join('\n')}`)
  return lines.join('\n')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' })
  }

  const { transactionId, statementFileIds, invoiceFileIds } = req.body
  if (!transactionId || !Array.isArray(statementFileIds) || statementFileIds.length === 0) {
    return res.status(400).json({ error: 'Upload the closing statement first.' })
  }

  const { data: tx, error } = await supabaseAdmin.from('transactions').select('*').eq('id', transactionId).single()
  if (error || !tx) return res.status(404).json({ error: 'Escrow not found' })

  const invoices = Array.isArray(invoiceFileIds) ? invoiceFileIds : []
  const content = [
    ...statementFileIds.map(id => ({ type: 'document', source: { type: 'file', file_id: id }, title: 'Closing statement' })),
    ...invoices.map((id, i) => ({ type: 'document', source: { type: 'file', file_id: id }, title: `Invoice ${i + 1}` })),
    {
      type: 'text',
      text: `You are helping a real estate transaction coordinator check a closing statement before close of escrow.

The first document(s) are the closing (settlement) statement. ${invoices.length ? `The remaining ${invoices.length} document(s) are inspector or vendor invoices that should be paid through escrow.` : 'No invoices were provided.'}

Contract terms on file for this escrow:
${contractFacts(tx)}

Check the statement against these terms and invoices. Cover at least:
- purchase price
- deposits credited to the buyer
- each fee/cost allocation term (is each cost charged to the party the contract says?)
- commissions (report the amounts; mark "review" since the contract terms here don't include them)
- each invoice: is it on the statement, charged to the right party, and for the right amount?
- seller/buyer credits and anything charged that looks unusual, duplicated, or missing

For each check, give what was expected, what the statement shows, and a status: "ok" if it matches, "mismatch" if it differs, "missing" if it isn't on the statement, or "review" if it needs a human look. Put a one-line plain-English note on each. The summary should be two or three sentences highlighting anything that needs action.`,
    },
  ]

  try {
    const client = new Anthropic()
    const response = await client.beta.messages.stream({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high', format: { type: 'json_schema', schema: RESULT_SCHEMA } },
      messages: [{ role: 'user', content }],
    }).finalMessage()

    if (response.stop_reason === 'refusal') {
      return res.status(422).json({ error: 'The review was declined. Please check the statement manually.' })
    }
    if (response.stop_reason === 'max_tokens') {
      return res.status(500).json({ error: 'The review was cut off before finishing. Try with fewer documents.' })
    }

    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('')
    return res.status(200).json({ review: JSON.parse(text) })
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.error(`Anthropic API error ${err.status}:`, err.message)
      return res.status(502).json({ error: err.message })
    }
    console.error('Closing statement review error:', err)
    return res.status(500).json({ error: err.message })
  }
}
