function firstName(fullName) {
  if (!fullName) return ''
  return fullName.split(' ')[0]
}

function formatDate(dateStr) {
  if (!dateStr || dateStr === 'TBD') return '[DATE]'
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function findGroup(timelineGroups, regex) {
  return (timelineGroups || []).find(g => regex.test(g.label))
}

function findDepositInfo(timelineGroups) {
  const group = findGroup(timelineGroups, /deposit/i)
  if (!group) return { amount: '[DEPOSIT AMOUNT]', dueDate: '[DATE]' }
  const amountMatch = group.label.match(/\$[\d,]+/)
  return { amount: amountMatch ? amountMatch[0] : '[DEPOSIT AMOUNT]', dueDate: formatDate(group.date) }
}

function findGroupDate(timelineGroups, regex) {
  const group = findGroup(timelineGroups, regex)
  return group ? formatDate(group.date) : '[DATE]'
}

export function buildBuyerEmail(tx) {
  const c = tx.contacts || {}
  const deposit = findDepositInfo(tx.timeline_groups)
  const proofOfFundsDate = findGroupDate(tx.timeline_groups, /verification of all cash|proof of funds/i)
  const loanDocsDate = findGroupDate(tx.timeline_groups, /prequalification|loan|lender/i)

  const body = `Hello ${firstName(c.buyerName) || '___'},

Congratulations on your accepted offer! My name is Chaney and I am the transaction coordinator working alongside Bill, Megan, and Diana to help guide you through the escrow and closing processes.

Escrow has been officially opened with ${c.escrowOfficer || '___'} at ${c.escrowCo || '___'}, File #${tx.escrow_number || '___'}. The title officer ${c.escrowOfficer || '___'} can be reached at ${c.escrowOfficerPhone || '[PHONE]'} or via email at ${c.escrowOfficerEmail || '[EMAIL]'} should you need assistance along the way.

Attached is a copy of the Purchase Agreement for your records, along with an Escrow Timeline for your review. This document outlines the important action dates you need to be aware of.

The first action items we need to address are:

Buyer proof of funds is required by ${proofOfFundsDate}. The easiest and least intrusive way to satisfy this is to have your banker or wealth advisor provide a letter indicating that you have sufficient liquid funds at your disposal to consummate this purchase. Alternatively, you may provide a bank or financial statement with any sensitive information redacted.

Your prequalification letter and verification of funds are due on ${loanDocsDate}. Can you kindly provide us with your Lender's contact information, so we can obtain this documentation on your behalf to meet the contractual obligations?

The initial deposit of ${deposit.amount} is due to the Title Company by ${deposit.dueDate}. ${c.escrowOfficer || 'The title officer'} will be sending you the secured wire instructions directly within the next 24 hours, so you can initiate the transfer.

Would you like us to schedule any inspections on your behalf?

Please do not hesitate to reach out with any questions. We are here to help!

Kindly,
Chaney`

return { to: c.buyerEmail || '', subject: `Introduction & Escrow Timeline - ${tx.address}`, body }
}

export function buildSellerEmail(tx) {
  const c = tx.contacts || {}
  const disclosureDate = findGroupDate(tx.timeline_groups, /disclosure/i)

  const body = `Hello ${firstName(c.sellerName) || '___'},

Congratulations on getting your property ${tx.address || '___'} into contract! My name is Chaney, I am the transaction coordinator working alongside Bill, Megan, and Diana throughout this transaction. If there is ever anything you need, please don't hesitate to reach out.

Escrow has been officially opened with ${c.escrowOfficer || '___'} at ${c.escrowCo || '___'}, File #${tx.escrow_number || '___'}. The title officer ${c.escrowOfficer || '___'} can be reached at ${c.escrowOfficerPhone || '[PHONE]'} or via email at ${c.escrowOfficerEmail || '[EMAIL]'} should you need assistance along the way.

Attached is a copy of the Purchase Agreement for your records, along with an Escrow Timeline for your review. This document outlines the important action dates you need to be aware of.

The first action items we need to address are:

The PUD requires sewer line testing and clearance as a point-of-sale condition. I will ask for confirmation of sewer clearance or a proposal from Tapco Construction. Once the quote is received, we will need your approval to get the test scheduled.

The Seller Disclosures are due on ${disclosureDate}. I just sent you the Transfer Disclosure Statement and Seller Property Questionnaire through a system called "Glide." Glide will walk you through filling out these forms. If for any reason you didn't get it, please check your spam/junk folders, and then reach out to me.

If you have any preliminary questions or concerns regarding these items please let us know. We are happy to help!

Thank you for your time, we look forward to a smooth and timely transaction.

Kindly,
Chaney`

  return { to: c.sellerEmail || '', subject: `Introduction & Escrow Timeline - ${tx.address}`, body }
}

export function buildTitleEmail(tx) {
  const c = tx.contacts || {}
  const deposit = findDepositInfo(tx.timeline_groups)

  const body = `Hello ${c.escrowOfficer || '___'},

Please see the attached executed purchase agreement to open escrow on the following transaction:

Property Address: ${tx.address || '___'}
Buyer(s): ${tx.buyer || c.buyerName || '___'}
Seller(s): ${tx.seller || c.sellerName || '___'} (${c.sellerPhone || '[PHONE]'}, ${c.sellerEmail || '[EMAIL]'})
Purchase Price: ${tx.price || '___'}
Acceptance Date: ${formatDate(tx.acceptance_date)}
Close of Escrow: ${formatDate(tx.coe)}
Deposit amount: ${deposit.amount} due by ${deposit.dueDate}
Buyer broker commission: [COMMISSION]
Seller broker commission: [COMMISSION]
Other side's broker: [BROKER NAME]

Please confirm receipt and send escrow instructions at your earliest convenience. Let me know if you need any additional documents to get started.

Thank you,
Chaney`

  return { to: c.escrowOfficerEmail || '', subject: `New Escrow — ${tx.address}`, body }
}

export function buildAgentEmail(tx, cooperatingSide) {
  const c = tx.contacts || {}
  const agentName = cooperatingSide === 'seller' ? c.sellerAgent : c.buyerAgent
  const agentEmail = cooperatingSide === 'seller' ? c.sellerAgentEmail : c.buyerAgentEmail

  const body = `Hello ${agentName || '___'},

My name is Chaney and I am the transaction coordinator for the Dietz Group on ${tx.address}. Feel free to send any documents, amendments, or requests to me, and please cc dietzgroup@tluxp.com on all further communications. I have included the escrow timeline, please confirm our dates match so we are all on the same page. I look forward to working with you toward a smooth closing!

Kindly,
Chaney`

  return { to: agentEmail || '', subject: `Introduction & Escrow Timeline - ${tx.address}`, body }
}

// ── Due-date drafts (created automatically by the daily automation) ──────────

function clientsFor(tx) {
  const c = tx.contacts || {}
  const people = []
  if (tx.side === 'buyer' || tx.side === 'both') people.push({ name: c.buyerName, email: c.buyerEmail })
  if (tx.side === 'seller' || tx.side === 'both' || !tx.side) people.push({ name: c.sellerName, email: c.sellerEmail })
  return people
}

function greetingNames(people) {
  const names = people.map(p => firstName(p.name)).filter(Boolean)
  return names.length ? names.join(' & ') : '___'
}

export function buildIncreaseDepositEmail(tx) {
  const c = tx.contacts || {}
  const group = findGroup(tx.timeline_groups, /increase|additional deposit|balance of deposit/i)
  const amountMatch = group?.label?.match(/\$[\d,]+/)
  const amount = amountMatch ? amountMatch[0] : '[DEPOSIT AMOUNT]'
  const dueDate = group ? formatDate(group.date) : '[DATE]'

  const body = `Hello ${firstName(c.buyerName) || '___'},

A friendly reminder that the increased deposit of ${amount} for ${tx.address || '___'} is due to ${c.escrowCo || 'escrow'} by ${dueDate}.

${c.escrowOfficer || 'The escrow officer'} will provide secure wire instructions. Before sending any funds, please call ${c.escrowOfficer || 'escrow'} at ${c.escrowOfficerPhone || '[PHONE]'} to verify the instructions by phone. Never rely on wiring instructions received only by email.

Please let us know once the wire has been sent so we can confirm receipt with escrow.

Kindly,
Chaney`

  return { to: c.buyerEmail || '', subject: `Increased Deposit Reminder - ${tx.address}`, body }
}

export function buildBuyerUtilitiesEmail(tx) {
  const c = tx.contacts || {}
  const body = `Hello ${firstName(c.buyerName) || '___'},

We're getting close! Close of escrow for ${tx.address || '___'} is scheduled for ${formatDate(tx.coe)}.

Now is a great time to transfer utilities (electric, gas, water/sewer, trash, internet) into your name effective on the close of escrow date, so there is no interruption in service.

Also, when are you planning your first visit to the property? We'd love to make sure everything is ready for your arrival.

Kindly,
Chaney`

  return { to: c.buyerEmail || '', subject: `Utilities & First Visit - ${tx.address}`, body }
}

export function buildSellerUtilityInfoEmail(tx) {
  const c = tx.contacts || {}
  const body = `Hello ${firstName(c.sellerName) || '___'},

As we approach close of escrow on ${formatDate(tx.coe)} for ${tx.address || '___'}, could you please send over the utility providers for the property (electric, gas, water/sewer, trash, internet, propane if applicable)?

We'll pass this along to the buyer so they can set up service in their name.

Thank you!

Kindly,
Chaney`

  return { to: c.sellerEmail || '', subject: `Utility Information - ${tx.address}`, body }
}

export function buildSellerCancelUtilitiesEmail(tx) {
  const c = tx.contacts || {}
  const body = `Hello ${firstName(c.sellerName) || '___'},

A reminder to schedule the cancellation (or transfer out of your name) of utilities at ${tx.address || '___'}, effective on the close of escrow date, ${formatDate(tx.coe)}.

Please keep services on through closing so the property stays ready for the buyer's final walkthrough. Let me know once this is scheduled.

Kindly,
Chaney`

  return { to: c.sellerEmail || '', subject: `Utility Cancellation Reminder - ${tx.address}`, body }
}

export function buildClosingStatementRequestEmail(tx) {
  const c = tx.contacts || {}
  const body = `Hello ${c.escrowOfficer || '___'},

When available, could you please send the estimated closing statement for ${tx.address || '___'} (File #${tx.escrow_number || '___'})? We are scheduled to close on ${formatDate(tx.coe)}.

Please make sure all inspector invoices and any credits are reflected so we can review them before closing.

Thank you,
Chaney`

  return { to: c.escrowOfficerEmail || '', subject: `Closing Statement Request - ${tx.address}`, body }
}

export function buildEscrowStatusCheckEmail(tx) {
  const c = tx.contacts || {}
  const body = `Hello ${c.escrowOfficer || '___'},

Checking in on ${tx.address || '___'} (File #${tx.escrow_number || '___'}), scheduled to close ${formatDate(tx.coe)}. Is there anything outstanding from our side, and are we on track to record?

Thank you,
Chaney`

  return { to: c.escrowOfficerEmail || '', subject: `Status Check - ${tx.address}`, body }
}

export function buildZillowReviewEmail(tx) {
  const people = clientsFor(tx)
  const body = `Hello ${greetingNames(people)},

Congratulations again on closing ${tx.address || 'your property'}! It was a pleasure working with you.

If you have a moment, Bill would be so grateful if you could leave a short review of your experience on Zillow: [ZILLOW REVIEW LINK]

Thank you for trusting us with your real estate needs!

Kindly,
Chaney`

  return { to: people.map(p => p.email).filter(Boolean), subject: `Thank you! - ${tx.address}`, body }
}

export function buildFinalStatementNadiaEmail(tx) {
  const body = `Hi Nadia,

Attached is the final closing statement for ${tx.address || '___'}, which closed ${formatDate(tx.coe)}.

Thank you,
Chaney`

  return { to: '', subject: `Final Closing Statement - ${tx.address}`, body }
}

export const DRAFT_BUILDERS = {
  increaseDeposit: buildIncreaseDepositEmail,
  buyerUtilities: buildBuyerUtilitiesEmail,
  sellerUtilityInfo: buildSellerUtilityInfoEmail,
  sellerCancelUtilities: buildSellerCancelUtilitiesEmail,
  closingStatementRequest: buildClosingStatementRequestEmail,
  escrowStatusCheck: buildEscrowStatusCheckEmail,
  zillowReview: buildZillowReviewEmail,
  finalStatementNadia: buildFinalStatementNadiaEmail,
}

// ── Daily task digest for a team member (created as a draft for Chaney to send) ─

const MAX_LINES = 15

function taskLines(tasks) {
  const lines = tasks.slice(0, MAX_LINES).map(t => `  • ${t.text} — ${t.address || 'Untitled'}${t.due ? ` (due ${formatDate(t.due)})` : ''}`)
  if (tasks.length > MAX_LINES) lines.push(`  …and ${tasks.length - MAX_LINES} more (see the Tasks tab on the dashboard)`)
  return lines.join('\n')
}

export function buildDigestEmail(personName, email, buckets, today) {
  const parts = []
  if (buckets.overdue.length) parts.push(`OVERDUE\n${taskLines(buckets.overdue)}`)
  if (buckets.today.length) parts.push(`DUE TODAY\n${taskLines(buckets.today)}`)
  if (buckets.upcoming.length) parts.push(`COMING UP THIS WEEK\n${taskLines(buckets.upcoming)}`)

  const body = `Good morning ${personName},

Here's what's on your list:

${parts.join('\n\n')}

Thank you!
Chaney`

  return { to: email || '', subject: `Your tasks for ${formatDate(today)}`, body }
}

// ── Morning notification email to Chaney ─────────────────────────────────────

export function buildNotificationEmail({ drafts, digests, closed, myBuckets, dashboardUrl }) {
  const parts = []
  if (drafts.length) {
    parts.push(`NEW DRAFTS IN YOUR OUTLOOK DRAFTS FOLDER (review and send)\n${drafts.map(d => `  • ${d.label} — ${d.address}${d.missingRecipient ? ' (no recipient — add one before sending)' : ''}`).join('\n')}`)
  }
  if (digests.length) {
    parts.push(`TEAM TASK DIGESTS (drafts, review and send)\n${digests.map(d => `  • ${d.person}: ${d.count} task${d.count !== 1 ? 's' : ''}${d.missingRecipient ? ' (no recipient — add one before sending)' : ''}`).join('\n')}`)
  }
  if (closed.length) {
    parts.push(`MOVED TO CLOSED\n${closed.map(a => `  • ${a}`).join('\n')}`)
  }
  if (myBuckets.overdue.length) parts.push(`YOUR OVERDUE TASKS\n${taskLines(myBuckets.overdue)}`)
  if (myBuckets.today.length) parts.push(`YOUR TASKS DUE TODAY\n${taskLines(myBuckets.today)}`)

  const subjectBits = []
  if (drafts.length + digests.length) subjectBits.push(`${drafts.length + digests.length} new draft${drafts.length + digests.length !== 1 ? 's' : ''}`)
  if (myBuckets.today.length + myBuckets.overdue.length) subjectBits.push(`${myBuckets.today.length + myBuckets.overdue.length} task${myBuckets.today.length + myBuckets.overdue.length !== 1 ? 's' : ''} due`)

  return {
    subject: `TC Dashboard: ${subjectBits.join(', ') || 'daily update'}`,
    body: `${parts.join('\n\n')}${dashboardUrl ? `\n\nOpen the dashboard: ${dashboardUrl}` : ''}`,
  }
}
