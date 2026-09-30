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

  return { to: c.buyerEmail || '', subject: `Escrow Opened — ${tx.address}`, body }
}

export function buildSellerEmail(tx) {
  const c = tx.contacts || {}
  const disclosureDate = findGroupDate(tx.timeline_groups, /disclosure/i)

  const body = `Hello ${firstName(c.sellerName) || '___'},

Congratulations on getting your property ${tx.address || '___'} into contract! My name is Chaney, I am the transaction coordinator working alongside Bill, Megan, and Diana throughout this transaction. If there is ever anything you need, please don't hesitate to reach out.

Escrow has been officially opened with ${c.escrowOfficer || '___'} at ${c.escrowCo || '___'}, File #${tx.escrow_number || '___'}. The title officer ${c.escrowOfficer || '___'} can be reached at ${c.escrowOfficerPhone || '[PHONE]'} or via email at ${c.escrowOfficerEmail || '[EMAIL]'} should you need assistance along the way.

Attached is a copy of the Purchase Agreement for your records, along with an Escrow Timeline for your review. This document outlines the important action dates you need to be aware of.

The first action items we need to address are:

[Point-of-sale / property-specific conditions go here — e.g. sewer clearance, HOA requirements. Edit or remove for this deal.]

The Seller Disclosures are due on ${disclosureDate}. I just sent you the Transfer Disclosure Statement and Seller Property Questionnaire through a system called "Glide." Glide will walk you through filling out these forms. If for any reason you didn't get it, please check your spam/junk folders, and then reach out to me.

If you have any preliminary questions or concerns regarding these items please let us know. We are happy to help!

Thank you for your time, we look forward to a smooth and timely transaction.

Kindly,
Chaney`

  return { to: c.sellerEmail || '', subject: `Escrow Opened — ${tx.address}`, body }
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

  return { to: agentEmail || '', subject: `Escrow Opened — ${tx.address}`, body }
}
