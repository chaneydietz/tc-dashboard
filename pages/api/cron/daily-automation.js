// Runs every morning (see vercel.json). It:
//   1. moves escrows to Pending once contingencies are removed and to Closed
//      once close of escrow has passed,
//   2. creates Outlook drafts in Chaney's mailbox for checklist emails due today,
//   3. creates task digest drafts for Megan and Diana (Chaney reviews and sends),
//   4. emails Chaney a summary of what was created and what's due.
// Nothing is ever sent to anyone other than Chaney.

import { supabaseAdmin } from '../../../lib/supabase'
import { createDraftEmail, sendMail } from '../../../lib/microsoftGraph'
import { DRAFT_BUILDERS, buildDigestEmail, buildNotificationEmail } from '../../../lib/emailTemplates'
import { pacificToday, addDays, collectTasks, bucketTasks, autoEscrowStatus } from '../../../lib/tasks'

export const config = { maxDuration: 60 }

const TC_NAME = 'Chaney'
const DIGEST_PEOPLE = ['Megan', 'Diana']
// Drafts are only created for items that came due in the last few days, so a
// long-overdue item doesn't suddenly produce a draft.
const DRAFT_LOOKBACK_DAYS = 3

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end()
  }

  const today = pacificToday()

  const { data: existing, error: notifError } = await supabaseAdmin
    .from('notifications')
    .select('key')
    .gte('created_at', addDays(today, -60))
  if (notifError) {
    console.error('Notifications table error:', notifError)
    return res.status(500).json({ error: 'notifications table missing — run supabase_automation.sql in Supabase' })
  }
  const seen = new Set((existing || []).map(n => n.key))

  const [{ data: transactions, error: txError }, { data: listings, error: lError }, { data: connections, error: cError }] = await Promise.all([
    supabaseAdmin.from('transactions').select('*'),
    supabaseAdmin.from('listings').select('*'),
    supabaseAdmin.from('outlook_connections').select('agent_name, email'),
  ])
  if (txError || lError || cError) {
    const err = txError || lError || cError
    console.error('Supabase error:', err)
    return res.status(500).json({ error: err.message })
  }

  const emailFor = name => (connections || []).find(c => c.agent_name === name)?.email || ''
  const tcConnected = (connections || []).some(c => c.agent_name === TC_NAME)

  async function record(notification) {
    seen.add(notification.key)
    const { error } = await supabaseAdmin.from('notifications').insert(notification)
    if (error) console.error('Failed to save notification:', error)
  }

  // 1. Contingent -> Pending after the contingency deadline, -> Closed after COE.
  const closed = []
  for (const tx of transactions || []) {
    const next = autoEscrowStatus(tx, today)
    if (!next) continue
    const { error } = await supabaseAdmin.from('transactions').update({ status: next }).eq('id', tx.id)
    if (error) { console.error('Status update failed:', error); continue }
    tx.status = next
    if (next === 'closed') {
      closed.push(tx.address || 'Untitled')
      await record({ key: `closed:${tx.id}`, kind: 'closed', title: 'Moved to Closed', body: tx.address, transaction_id: tx.id })
    }
  }

  const allTasks = collectTasks(transactions || [], listings || [])

  // 2. Drafts for checklist emails that are due.
  const drafts = []
  const warnings = []
  if (tcConnected) {
    const txById = Object.fromEntries((transactions || []).map(t => [t.id, t]))
    const due = allTasks.filter(t => t.draftRule && t.due <= today && t.due >= addDays(today, -DRAFT_LOOKBACK_DAYS))
    for (const task of due) {
      const key = `draft:${task.recordId}:${task.draftRule.key}`
      if (seen.has(key)) continue
      const tx = txById[task.recordId]
      const draft = DRAFT_BUILDERS[task.draftRule.key](tx)
      const result = await createDraftEmail(TC_NAME, draft)
      if (!result.id) { warnings.push(result.error || result.reason); continue }
      drafts.push({ label: task.draftRule.label, address: tx.address, missingRecipient: result.missingRecipient })
      await record({
        key, kind: 'draft', title: task.draftRule.label, body: tx.address, transaction_id: tx.id,
        meta: { template: task.draftRule.key, subject: draft.subject, itemText: task.text, missingRecipient: result.missingRecipient },
      })
    }
  } else {
    warnings.push(`${TC_NAME} is not connected to Outlook — no drafts created.`)
  }

  // 3. Task digests for the team, as drafts for Chaney to review and send.
  const digests = []
  if (tcConnected) {
    for (const person of DIGEST_PEOPLE) {
      const key = `digest:${person}:${today}`
      if (seen.has(key)) continue
      const buckets = bucketTasks(allTasks.filter(t => t.owner === person), today)
      if (buckets.overdue.length + buckets.today.length === 0) continue
      const draft = buildDigestEmail(person, emailFor(person), buckets, today)
      const result = await createDraftEmail(TC_NAME, draft)
      if (!result.id) { warnings.push(result.error || result.reason); continue }
      const count = buckets.overdue.length + buckets.today.length + buckets.upcoming.length
      digests.push({ person, count, missingRecipient: result.missingRecipient })
      await record({
        key, kind: 'digest', title: `Task digest for ${person}`, body: `${count} task${count !== 1 ? 's' : ''}`,
        meta: { person, subject: draft.subject, missingRecipient: result.missingRecipient },
      })
    }
  }

  // 4. Summary email to Chaney only.
  const myBuckets = bucketTasks(allTasks.filter(t => t.owner === TC_NAME), today)
  const hasNews = drafts.length || digests.length || closed.length || myBuckets.overdue.length || myBuckets.today.length
  let notified = false
  if (hasNews && tcConnected && emailFor(TC_NAME)) {
    const email = buildNotificationEmail({ drafts, digests, closed, myBuckets, dashboardUrl: process.env.NEXT_PUBLIC_BASE_URL })
    const result = await sendMail(TC_NAME, { to: [emailFor(TC_NAME)], subject: email.subject, body: email.body })
    notified = !!result.sent
    if (result.error) warnings.push(result.error)
  }

  return res.status(200).json({ today, closed: closed.length, drafts: drafts.length, digests: digests.length, notified, warnings })
}
