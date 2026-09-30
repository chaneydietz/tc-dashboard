import { createDraftEmail } from '../../lib/microsoftGraph'
import { buildBuyerEmail, buildSellerEmail, buildTitleEmail, buildAgentEmail } from '../../lib/emailTemplates'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const tx = req.body

  const drafts = []
  if (tx.side === 'buyer') {
    drafts.push(buildBuyerEmail(tx))
    drafts.push(buildTitleEmail(tx))
    drafts.push(buildAgentEmail(tx, 'seller')) // cooperating = seller's agent
  } else if (tx.side === 'seller') {
    drafts.push(buildSellerEmail(tx))
    drafts.push(buildAgentEmail(tx, 'buyer')) // cooperating = buyer's agent
  } else if (tx.side === 'both') {
    drafts.push(buildBuyerEmail(tx))
    drafts.push(buildSellerEmail(tx))
    drafts.push(buildTitleEmail(tx))
  }

  let created = 0
  const warnings = []
  for (const draft of drafts) {
    const result = await createDraftEmail('Chaney', draft)
    if (result.id) {
      created++
      if (result.missingRecipient) warnings.push(`"${draft.subject}" created with no recipient — add one before sending.`)
    } else if (result.error) {
      warnings.push(result.error)
    } else if (result.skipped) {
      warnings.push('Chaney is not connected to Outlook — no drafts created.')
      break
    }
  }

  return res.status(200).json({ created, total: drafts.length, warnings })
}
