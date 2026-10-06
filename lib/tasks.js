// Shared task logic, used by both the dashboard (browser) and the daily
// automation cron (server). Works on the checklist items already stored on
// each escrow/listing, so existing records don't need migrating: due dates
// come from each item's "timing" text, and automations are matched by the
// item's wording.

// ── Dates (all YYYY-MM-DD strings, Pacific time) ─────────────────────────────

export function pacificToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function validDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

export function formatShortDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

// ── Statuses ─────────────────────────────────────────────────────────────────

export const ESCROW_STATUSES = ['active', 'contingent', 'pending', 'closed']
export const LISTING_STATUSES = ['prelisting', 'active']

// Older escrows were saved as "escrow", which is now "contingent".
export function escrowStatus(tx) {
  const s = tx?.status || 'contingent'
  return s === 'escrow' ? 'contingent' : s
}

// The status an escrow should move to automatically, or null if it stays:
// pending once the last contingency removal date has passed, closed once
// close of escrow has passed.
export function autoEscrowStatus(tx, today = pacificToday()) {
  const status = escrowStatus(tx)
  if (status === 'closed') return null
  if (validDate(tx.coe) && tx.coe < today) return 'closed'
  if (status === 'pending') return null
  const crDate = timelineDate(tx, /contingency/i, 'last')
  if (crDate && crDate < today) return 'pending'
  return null
}

// ── Nevada properties: hide California-only items ────────────────────────────

const NV_PATTERN = /,\s*NV\b|\bNV\s+\d{5}|\bNevada\b|\b(Incline Village|Crystal Bay|Stateline|Zephyr Cove|Glenbrook|Carson City|Reno|Sparks|Minden|Gardnerville)\b/i

export function isNevada(record) {
  return NV_PATTERN.test(record?.address || '')
}

export function isCaOnlyItem(item) {
  return /\(CA only\)/i.test(item?.text || '')
}

export function isHiddenItem(item, record) {
  return isCaOnlyItem(item) && isNevada(record)
}

// ── Which checklist sections apply to which side ─────────────────────────────
// side 'seller' = we represent the seller (listing agent side),
// side 'buyer' = we represent the buyer (selling agent side).

export function sectionApplies(sectionKey, record) {
  const side = record?.side || 'seller'
  if (sectionKey === 'selling_agent') return side === 'buyer' || side === 'both'
  if (sectionKey === 'listing_agent') return side === 'seller' || side === 'both'
  return true
}

// ── Due dates ────────────────────────────────────────────────────────────────

function timelineDate(record, regex, pick = 'first') {
  const dates = (record.timeline_groups || [])
    .filter(g => regex.test(g.label || '') && validDate(g.date))
    .map(g => g.date)
    .sort()
  if (dates.length === 0) return null
  return pick === 'last' ? dates[dates.length - 1] : dates[0]
}

function startDate(record) {
  return validDate(record.acceptance_date) || validDate((record.created_at || '').slice(0, 10))
}

// Turns an escrow checklist item's timing ("5 days prior", "Prior to CR",
// "ASAP", ...) into a date. Returns null when the timing isn't tied to a date
// ("Once Received", "Prior to arrival") or the anchor date isn't known.
export function escrowDueDate(item, record) {
  const t = (item.timing || '').trim().toLowerCase()
  const coe = validDate(record.coe)
  const start = startDate(record)
  let m

  if ((m = t.match(/^(\d+)\s*days?\s*prior/))) {
    // "N days prior" is before close of escrow, except the increased deposit
    // reminder, which is N days before that deposit is due.
    const anchor = /increase deposit/i.test(item.text || '')
      ? timelineDate(record, /increase|additional deposit|balance of deposit/i)
      : coe
    return anchor ? addDays(anchor, -Number(m[1])) : null
  }
  if (t === 'asap') return start
  if ((m = t.match(/^within\s*(\d+)\s*days?/))) return start ? addDays(start, Number(m[1])) : null
  if ((m = t.match(/^within\s*(\d+)\s*(hrs?|hours?)/))) return start ? addDays(start, Math.ceil(Number(m[1]) / 24)) : null
  if (t === 'at coe' || t === 'prior to coe') return coe
  if (t === 'after coe') return coe ? addDays(coe, 1) : null
  if (t === 'prior to cr') {
    const cr = timelineDate(record, /contingency/i)
    return cr ? addDays(cr, -1) : null
  }
  if (t === 'before inspections') return start ? addDays(start, 1) : null
  if (t === 'prior to appraiser') {
    const appraisal = timelineDate(record, /apprais/i)
    return appraisal ? addDays(appraisal, -3) : null
  }
  if (t === 'with disclosures') return timelineDate(record, /disclosure/i)
  return null
}

// Listing items are anchored to the list date (or the day the listing was added).
export function listingDueDate(item, record) {
  const t = (item.timing || '').trim().toLowerCase()
  const anchor = validDate(record.list_date) || validDate((record.created_at || '').slice(0, 10))
  if (!anchor) return null
  if (['asap', 'at listing', 'pre-listing', 'pre-photos'].includes(t)) return anchor
  const m = t.match(/^within\s*(\d+)\s*(hrs?|hours?)/)
  if (m) return addDays(anchor, Math.ceil(Number(m[1]) / 24))
  return null
}

// ── Automations matched by item wording ──────────────────────────────────────

// Items the app checks off itself when it does the work.
export const AUTO_CHECK_RULES = {
  timeline: /create and email escrow timeline/i,
  intro: /send intro email with escrow timeline/i,
  calendar: /set up reminders for important dates/i,
}

// Items that get an Outlook draft created on their due date.
export const DRAFT_RULES = [
  { key: 'increaseDeposit', match: /increase deposit/i, label: 'Increased deposit reminder to buyer' },
  { key: 'buyerUtilities', match: /buyer reminder to transfer utilities/i, label: 'Utility transfer reminder to buyer' },
  { key: 'sellerUtilityInfo', match: /email seller asking for utility info/i, label: 'Utility info request to seller' },
  { key: 'sellerCancelUtilities', match: /seller to cancel utilities/i, label: 'Utility cancellation reminder to seller' },
  { key: 'closingStatementRequest', match: /ask for and review closing statements/i, label: 'Closing statement request to escrow' },
  { key: 'escrowStatusCheck', match: /email escrow officer.*status check/i, label: 'Status check to escrow officer' },
  { key: 'zillowReview', match: /zillow review request/i, label: "Bill's Zillow review request" },
  { key: 'finalStatementNadia', match: /email nadia.*final closing statement/i, label: 'Final closing statement to Nadia' },
]

export function draftRuleFor(item) {
  return DRAFT_RULES.find(r => r.match.test(item?.text || '')) || null
}

// Returns a new checklists object with every item matching the auto-check
// rule marked done, or null when nothing changed.
export function applyAutoCheck(checklists, ruleKey) {
  const rule = AUTO_CHECK_RULES[ruleKey]
  if (!rule || !checklists) return null
  let changed = false
  const next = {}
  for (const [sec, items] of Object.entries(checklists)) {
    if (!Array.isArray(items)) { next[sec] = items; continue }
    next[sec] = items.map(item => {
      if (!item.done && rule.test(item.text || '')) {
        changed = true
        return { ...item, done: true, autoChecked: true }
      }
      return item
    })
  }
  return changed ? next : null
}

// ── Collecting open tasks across records ─────────────────────────────────────

const ESCROW_SECTION_LABELS = {
  both_agents: 'Both agents', selling_agent: 'Selling agent', listing_agent: 'Listing agent', coe: 'COE actions',
}
const LISTING_OWNERS = { megan: 'Megan', diana: 'Diana', chaney: 'Chaney' }

// Every open (unchecked, visible, applicable) checklist item that has a due
// date. Escrow work is the TC's, so it's owned by Chaney.
export function collectTasks(transactions = [], listings = []) {
  const tasks = []
  for (const tx of transactions) {
    if (tx.status === 'closed' && !(validDate(tx.coe) && tx.coe >= addDays(pacificToday(), -14))) continue
    for (const [sec, items] of Object.entries(tx.checklists || {})) {
      if (!Array.isArray(items) || !sectionApplies(sec, tx)) continue
      items.forEach((item, index) => {
        if (item.done || isHiddenItem(item, tx)) return
        const due = escrowDueDate(item, tx)
        if (!due) return
        // Once closed, only the post-closing items (reviews, final statements) still count.
        if (tx.status === 'closed' && due < tx.coe) return
        tasks.push({
          kind: 'escrow', recordId: tx.id, address: tx.address, section: sec, index,
          sectionLabel: ESCROW_SECTION_LABELS[sec] || sec, owner: 'Chaney',
          text: item.text, due, draftRule: draftRuleFor(item),
        })
      })
    }
  }
  for (const l of listings) {
    if (l.status === 'closed') continue
    for (const [sec, items] of Object.entries(l.checklists || {})) {
      if (!Array.isArray(items)) continue
      items.forEach((item, index) => {
        if (item.done || isHiddenItem(item, l)) return
        const due = listingDueDate(item, l)
        if (!due) return
        tasks.push({
          kind: 'listing', recordId: l.id, address: l.address, section: sec, index,
          sectionLabel: LISTING_OWNERS[sec] || sec, owner: LISTING_OWNERS[sec] || 'Chaney',
          text: item.text, due, draftRule: null,
        })
      })
    }
  }
  return tasks.sort((a, b) => a.due.localeCompare(b.due))
}

// Splits tasks into overdue / today / upcoming (next `days` days).
export function bucketTasks(tasks, today = pacificToday(), days = 7) {
  const horizon = addDays(today, days)
  return {
    overdue: tasks.filter(t => t.due < today),
    today: tasks.filter(t => t.due === today),
    upcoming: tasks.filter(t => t.due > today && t.due <= horizon),
  }
}
