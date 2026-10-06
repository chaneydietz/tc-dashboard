import { useState, useEffect, useRef } from 'react'
import Head from 'next/head'
import { useSession, signIn, signOut } from 'next-auth/react'
import { DEFAULT_CHECKLISTS, DEFAULT_LISTING_CHECKLISTS } from '../lib/checklists'
import {
  pacificToday, formatShortDate, isHiddenItem, escrowDueDate, listingDueDate, sectionApplies,
  draftRuleFor, applyAutoCheck, collectTasks, bucketTasks,
} from '../lib/tasks'

export const dynamic = 'force-dynamic'

// ── helpers ───────────────────────────────────────────────────────────────────

function daysUntil(dateStr) {
  if (!dateStr) return null
  const diff = new Date(dateStr) - new Date()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

function cdClass(days) {
  if (days === null) return 'cd-none'
  if (days < 0) return 'cd-none'
  if (days <= 5) return 'cd-urgent'
  if (days <= 14) return 'cd-soon'
  return 'cd-ok'
}

function cdText(days, label = 'COE') {
  if (days === null) return `No ${label} set`
  if (days < 0) return 'Closed'
  if (days === 0) return 'Today!'
  if (days === 1) return '1 day left'
  return `${days} days left`
}

function progress(record) {
  let total = 0, done = 0
  const cl = record.checklists || {}
  Object.values(cl).forEach(items => {
    if (Array.isArray(items)) {
      const visible = items.filter(i => !isHiddenItem(i, record))
      total += visible.length
      done += visible.filter(i => i.done).length
    }
  })
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0 }
}

function now() {
  return new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

// ── API calls ─────────────────────────────────────────────────────────────────

async function apiGet(table = 'transactions') {
  const r = await fetch(`/api/${table}`)
  return r.json()
}

async function apiCreate(table, body) {
  const r = await fetch(`/api/${table}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  return r.json()
}

async function apiUpdate(table, id, updates) {
  const r = await fetch(`/api/${table}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  })
  return r.json()
}

async function apiDelete(table, id) {
  await fetch(`/api/${table}/${id}`, { method: 'DELETE' })
}

async function uploadPdf(file) {
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
  const response = await fetch('/api/upload-contract-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pdfBase64: base64, filename: file.name })
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Upload failed')
  return data.fileId
}

function dueChipClass(due, today) {
  if (due < today) return 'due-chip overdue'
  if (due === today) return 'due-chip today'
  return 'due-chip'
}

function dueChipText(due, today) {
  if (due < today) return `Overdue · ${formatShortDate(due)}`
  if (due === today) return 'Due today'
  return `Due ${formatShortDate(due)}`
}

// ── Shared checklist UI ───────────────────────────────────────────────────────

function ChecklistSection({ sectionKey, label, items, record, dueFn, draftTemplates, onToggle, onEditText, onDelete, onAdd }) {
  const [newText, setNewText] = useState('')
  const today = pacificToday()

  function handleAdd() {
    const t = newText.trim()
    if (!t) return
    onAdd(sectionKey, t)
    setNewText('')
  }

  return (
    <div className="cl-section">
      <div className="cl-section-header">
        <span className="cl-section-name">{label}</span>
      </div>
      {(items || []).map((item, i) => {
        if (record && isHiddenItem(item, record)) return null
        const due = !item.done && dueFn ? dueFn(item, record) : null
        const rule = draftRuleFor(item)
        const hasDraft = rule && draftTemplates?.has(rule.key)
        return (
          <div key={i} className="check-item">
            <input
              type="checkbox"
              checked={item.done}
              onChange={e => onToggle(sectionKey, i, e.target.checked)}
            />
            <span
              className={`check-label${item.done ? ' done' : ''}`}
              contentEditable
              suppressContentEditableWarning
              onBlur={e => onEditText(sectionKey, i, e.target.innerText)}
            >{item.text}</span>
            {item.done && item.autoChecked && <span className="item-tag" title="Checked off automatically">auto</span>}
            {hasDraft && !item.done && <span className="item-tag draft" title="A draft is waiting in your Outlook Drafts folder">✉ Draft ready</span>}
            {due && <span className={dueChipClass(due, today)}>{dueChipText(due, today)}</span>}
            <span className="check-timing">{item.timing}</span>
            <button className="icon-btn" onClick={() => onDelete(sectionKey, i)} title="Remove">×</button>
          </div>
        )
      })}
      <div className="add-item-row">
        <input
          className="add-item-input"
          placeholder="Add item..."
          value={newText}
          onChange={e => setNewText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
        <button className="mini-btn green" onClick={handleAdd}>+ Add</button>
      </div>
    </div>
  )
}

// ── Escrow checklist ──────────────────────────────────────────────────────────

// After close, only post-closing items keep a due date.
function closedEscrowDueDate(item, tx) {
  const due = escrowDueDate(item, tx)
  return due && due >= tx.coe ? due : null
}

function Checklist({ tx, draftTemplates, onChange }) {
  const sections = [
    { key: 'both_agents', label: 'Both agents' },
    { key: 'selling_agent', label: 'Selling agent' },
    { key: 'listing_agent', label: 'Listing agent' },
    { key: 'coe', label: 'COE actions' },
  ]

  function mutate(fn) {
    const cl = JSON.parse(JSON.stringify(tx.checklists))
    fn(cl)
    onChange({ checklists: cl })
  }

  return (
    <div>
      {sections.map(s => (
        <ChecklistSection
          key={s.key}
          sectionKey={s.key}
          label={s.label}
          items={tx.checklists[s.key]}
          record={tx}
          dueFn={!sectionApplies(s.key, tx) ? null : tx.status === 'closed' ? closedEscrowDueDate : escrowDueDate}
          draftTemplates={draftTemplates}
          onToggle={(sec, i, val) => mutate(cl => { cl[sec][i].done = val; delete cl[sec][i].autoChecked })}
          onEditText={(sec, i, text) => mutate(cl => { cl[sec][i].text = text })}
          onDelete={(sec, i) => mutate(cl => { cl[sec].splice(i, 1) })}
          onAdd={(sec, text) => mutate(cl => {
            cl[sec] = cl[sec] || []
            cl[sec].push({ text, timing: '', done: false })
          })}
        />
      ))}
    </div>
  )
}

// ── Listing checklist ─────────────────────────────────────────────────────────

function ListingChecklist({ listing, onChange }) {
  const sections = [
    { key: 'megan', label: 'Megan' },
    { key: 'diana', label: 'Diana' },
    { key: 'chaney', label: 'Chaney' },
  ]

  function mutate(fn) {
    const cl = JSON.parse(JSON.stringify(listing.checklists))
    fn(cl)
    onChange({ checklists: cl })
  }

  return (
    <div>
      {sections.map(s => (
        <ChecklistSection
          key={s.key}
          sectionKey={s.key}
          label={s.label}
          items={listing.checklists[s.key]}
          record={listing}
          dueFn={listingDueDate}
          onToggle={(sec, i, val) => mutate(cl => { cl[sec][i].done = val; delete cl[sec][i].autoChecked })}
          onEditText={(sec, i, text) => mutate(cl => { cl[sec][i].text = text })}
          onDelete={(sec, i) => mutate(cl => { cl[sec].splice(i, 1) })}
          onAdd={(sec, text) => mutate(cl => {
            cl[sec] = cl[sec] || []
            cl[sec].push({ text, timing: '', done: false })
          })}
        />
      ))}
    </div>
  )
}

// ── Deadlines (escrow only) ───────────────────────────────────────────────────

function Deadlines({ tx, onChange }) {
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const [calMsg, setCalMsg] = useState('')
  const { data: session } = useSession()

  async function syncToCalendar(deadlines) {
    if (!session?.accessToken) return
    try {
      const r = await fetch('/api/calendar-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deadlines, address: tx.address })
      })
      const data = await r.json()
      setCalMsg(`📅 ${data.created} event${data.created !== 1 ? 's' : ''} added to Google Calendar`)
      setTimeout(() => setCalMsg(''), 4000)
    } catch (err) {
      console.error('Calendar sync error:', err)
    }
  }

  function add() {
    if (!name.trim() || !date) return
    const newDeadline = { name: name.trim(), date }
    const dl = [...(tx.deadlines || []), newDeadline]
    dl.sort((a, b) => new Date(a.date) - new Date(b.date))
    onChange({ deadlines: dl })
    if (session?.accessToken) syncToCalendar([newDeadline])
    setName(''); setDate('')
  }

  function del(i) {
    const dl = [...(tx.deadlines || [])]
    dl.splice(i, 1)
    onChange({ deadlines: dl })
  }

  async function handlePdfUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    setImporting(true)
    setImportMsg('Reading PDF...')
    try {
      const base64 = await new Promise((res, rej) => {
        const reader = new FileReader()
        reader.onload = () => res(reader.result.split(',')[1])
        reader.onerror = rej
        reader.readAsDataURL(file)
      })
      setImportMsg('Extracting deadlines with AI...')
      const response = await fetch('/api/parse-escrow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfBase64: base64 })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Server error')
      const parsed = data.deadlines
      if (!Array.isArray(parsed) || parsed.length === 0) {
        setImportMsg('No dates found in document.')
        setTimeout(() => setImportMsg(''), 3000)
        setImporting(false)
        return
      }
      const existing = tx.deadlines || []
      const existingNames = new Set(existing.map(d => d.name.toLowerCase()))
      const newItems = parsed.filter(d => d.name && d.date && !existingNames.has(d.name.toLowerCase()))
      const merged = [...existing, ...newItems].sort((a, b) => new Date(a.date) - new Date(b.date))
      onChange({ deadlines: merged })
      setImportMsg(`✓ Imported ${newItems.length} deadline${newItems.length !== 1 ? 's' : ''}!`)
      setTimeout(() => setImportMsg(''), 3000)
      if (session?.accessToken && newItems.length > 0) syncToCalendar(newItems)
    } catch (err) {
      console.error(err)
      setImportMsg('Error reading PDF. Please try again.')
      setTimeout(() => setImportMsg(''), 4000)
    }
    setImporting(false)
    e.target.value = ''
  }

  const chipStyle = (days) => {
    const styles = {
      'cd-urgent': { background: '#FCEBEB', color: '#A32D2D' },
      'cd-soon': { background: '#FAEEDA', color: '#854F0B' },
      'cd-ok': { background: '#E1F5EE', color: '#085041' },
      'cd-none': { background: 'var(--divider)', color: '#666' },
    }
    return styles[cdClass(days)] || {}
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, padding: '8px 12px', background: session?.accessToken ? '#E1F5EE' : 'var(--bg-muted)', borderRadius: 8 }}>
        <span style={{ fontSize: 13, color: '#444', flex: 1 }}>
          {session?.accessToken ? `📅 Google Calendar connected — deadlines will auto-sync` : '📅 Connect Google Calendar to auto-sync deadlines'}
        </span>
        {session?.accessToken
          ? <button className="mini-btn" onClick={() => signOut()}>Disconnect</button>
          : <button className="mini-btn green" onClick={() => signIn('google')}>Connect</button>
        }
      </div>
      {calMsg && <div style={{ fontSize: 12, color: '#1D9E75', fontWeight: 500, marginBottom: 8 }}>{calMsg}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, padding: '10px 12px', background: 'var(--bg-muted)', borderRadius: 8 }}>
        <span style={{ fontSize: 13, color: '#444', flex: 1 }}>📄 Import deadlines from an escrow timeline PDF</span>
        <label style={{ cursor: importing ? 'not-allowed' : 'pointer' }}>
          <input type="file" accept="application/pdf" style={{ display: 'none' }} onChange={handlePdfUpload} disabled={importing} />
          <span className="mini-btn green" style={{ pointerEvents: importing ? 'none' : 'auto', opacity: importing ? 0.6 : 1 }}>
            {importing ? 'Importing...' : '⬆ Upload PDF'}
          </span>
        </label>
        {importMsg && <span style={{ fontSize: 12, color: importMsg.startsWith('✓') ? '#1D9E75' : '#A32D2D', fontWeight: 500 }}>{importMsg}</span>}
      </div>
      {(tx.deadlines || []).length === 0 && (
        <p style={{ fontSize: 13, color: '#888', paddingBottom: 8 }}>No deadlines yet. Upload a PDF or add manually below.</p>
      )}
      {(tx.deadlines || []).map((d, i) => {
        const days = daysUntil(d.date)
        return (
          <div key={i} className="deadline-item">
            <span className="dl-name">{d.name}</span>
            <span className="dl-date">{d.date}</span>
            <span className="dl-chip" style={chipStyle(days)}>{cdText(days)}</span>
            <button className="icon-btn" onClick={() => del(i)}>×</button>
          </div>
        )
      })}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <input className="add-item-input" placeholder="Deadline name" value={name} onChange={e => setName(e.target.value)} style={{ flex: 2, minWidth: 120 }} />
        <input type="date" className="add-item-input" value={date} onChange={e => setDate(e.target.value)} style={{ flex: 1, minWidth: 130 }} />
        <button className="mini-btn green" onClick={add}>+ Add</button>
      </div>
    </div>
  )
}

// ── Contacts ──────────────────────────────────────────────────────────────────

function Contacts({ tx, onChange }) {
  const fields = [
  ['buyerName', 'Buyer name'], ['buyerPhone', 'Buyer phone'],
  ['buyerEmail', 'Buyer email'], ['buyerAgent', 'Buyer agent'], ['buyerAgentEmail', 'Buyer agent email'],
  ['sellerName', 'Seller name'], ['sellerPhone', 'Seller phone'],
  ['sellerEmail', 'Seller email'], ['sellerAgent', 'Seller agent'], ['sellerAgentEmail', 'Seller agent email'],
  ['escrowOfficer', 'Escrow officer'], ['escrowOfficerPhone', 'Escrow officer phone'], ['escrowOfficerEmail', 'Escrow officer email'],
  ['escrowCo', 'Escrow / title co.'],
  ['tcName', 'TC name'], ['tcPhone', 'TC phone'],
]
  const c = tx.contacts || {}
  return (
    <div className="detail-grid">
      {fields.map(([key, label]) => (
        <div key={key} className="field-group">
          <label>{label}</label>
          <input defaultValue={c[key] || ''} onBlur={e => onChange({ contacts: { ...c, [key]: e.target.value } })} placeholder="—" />
        </div>
      ))}
    </div>
  )
}

// ── Listing contacts ──────────────────────────────────────────────────────────

function ListingContacts({ listing, onChange }) {
  const fields = [
    ['sellerName', 'Seller name'], ['sellerPhone', 'Seller phone'],
    ['sellerEmail', 'Seller email'], ['sellerMailingAddress', 'Seller mailing address'],
    ['listingAgent', 'Listing agent'], ['listingAgentPhone', 'Listing agent phone'],
    ['tcName', 'TC name'], ['tcPhone', 'TC phone'],
  ]
  const c = listing.contacts || {}
  return (
    <div className="detail-grid">
      {fields.map(([key, label]) => (
        <div key={key} className="field-group">
          <label>{label}</label>
          <input defaultValue={c[key] || ''} onBlur={e => onChange({ contacts: { ...c, [key]: e.target.value } })} placeholder="—" />
        </div>
      ))}
    </div>
  )
}

// ── Notes ─────────────────────────────────────────────────────────────────────

function Notes({ record, onChange }) {
  const [text, setText] = useState('')

  function add() {
    if (!text.trim()) return
    const notes = [{ text: text.trim(), date: now(), author: 'TC' }, ...(record.notes || [])]
    onChange({ notes })
    setText('')
  }

  function del(i) {
    const notes = [...(record.notes || [])]
    notes.splice(i, 1)
    onChange({ notes })
  }

  return (
    <div>
      {(record.notes || []).map((n, i) => (
        <div key={i} className="note-item">
          <div className="note-meta">{n.date}{n.author ? ` · ${n.author}` : ''}</div>
          <div className="note-text">{n.text}</div>
          <div style={{ marginTop: 6 }}>
            <button className="mini-btn danger" onClick={() => del(i)}>Delete</button>
          </div>
        </div>
      ))}
      <div className="note-input-row">
        <textarea placeholder="Add a note..." value={text} onChange={e => setText(e.target.value)} />
        <button className="mini-btn green" onClick={add} style={{ alignSelf: 'flex-end' }}>+ Add</button>
      </div>
    </div>
  )
}

// ── Escrow details ────────────────────────────────────────────────────────────

function Details({ tx, onChange }) {
  const fields = [
    ['address', 'Property address', 'text'],
    ['coe', 'COE date', 'date'],
    ['agentName', 'Listing agent', 'text'],
    ['price', 'Purchase price', 'text'],
    ['mls', 'MLS number', 'text'],
    ['skyslope', 'Skyslope file', 'text'],
  ]
  const contractFields = [
    ['seller', 'Seller'],
    ['buyer', 'Buyer'],
    ['apn', 'APN'],
    ['escrow_company', 'Escrow company'],
    ['escrow_number', 'Escrow number'],
    ['acceptance_date', 'Acceptance date', 'date'],
  ]
  const hasTimeline = Array.isArray(tx.timeline_groups) && tx.timeline_groups.length > 0
  return (
    <div>
      <div className="detail-grid" style={{ marginBottom: 12 }}>
        {fields.map(([key, label, type]) => (
          <div key={key} className="field-group">
            <label>{label}</label>
            <input type={type} defaultValue={tx[key] || ''} onBlur={e => onChange({ [key]: e.target.value })} placeholder="—" />
          </div>
        ))}
        <div className="field-group">
          <label>Transaction side</label>
          <select defaultValue={tx.side || 'seller'} onChange={e => onChange({ side: e.target.value })}>
            {['seller', 'buyer', 'both'].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
        <div className="field-group">
          <label>Status</label>
          <select defaultValue={tx.status || 'active'} onChange={e => onChange({ status: e.target.value })}>
            {['active', 'pending', 'escrow', 'closed'].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
      </div>

      <div style={{ fontWeight: 600, fontSize: 13, margin: '4px 0 8px', color: 'var(--navy)' }}>Contract details</div>
      <div className="detail-grid" style={{ marginBottom: 12 }}>
        {contractFields.map(([key, label, type]) => (
          <div key={key} className="field-group">
            <label>{label}</label>
            <input type={type || 'text'} defaultValue={tx[key] || ''} onBlur={e => onChange({ [key]: e.target.value })} placeholder="—" />
          </div>
        ))}
      </div>

      {hasTimeline && (
        <button className="mini-btn green" onClick={() => {
          window.open(`/api/generate-timeline-doc/${tx.id}`, '_blank')
          const cl = applyAutoCheck(tx.checklists, 'timeline')
          if (cl) onChange({ checklists: cl })
        }}>
          ⬇ Download Escrow Timeline Doc
        </button>
      )}
    </div>
  )
}

// ── Listing details ───────────────────────────────────────────────────────────

function ListingDetails({ listing, onChange }) {
  const fields = [
    ['address', 'Property address', 'text'],
    ['list_date', 'List date', 'date'],
    ['agent_name', 'Listing agent', 'text'],
    ['price', 'List price', 'text'],
    ['mls', 'MLS number', 'text'],
    ['skyslope', 'Skyslope file', 'text'],
  ]
  return (
    <div>
      <div className="detail-grid" style={{ marginBottom: 12 }}>
        {fields.map(([key, label, type]) => (
          <div key={key} className="field-group">
            <label>{label}</label>
            <input type={type} defaultValue={listing[key] || ''} onBlur={e => onChange({ [key]: e.target.value })} placeholder="—" />
          </div>
        ))}
        <div className="field-group">
          <label>Status</label>
          <select defaultValue={listing.status || 'active'} onChange={e => onChange({ status: e.target.value })}>
            {['active', 'pending', 'closed'].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
        <div className="field-group">
          <label>On rental program</label>
          <select
            defaultValue={listing.on_rental_program ? 'yes' : 'no'}
            onChange={e => onChange({ on_rental_program: e.target.value === 'yes' })}
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </div>
      </div>
    </div>
  )
}

// ── TxCard (escrow) ───────────────────────────────────────────────────────────

function TxCard({ tx, expanded, onExpand, onUpdate, onDelete, draftTemplates }) {
  const [activeTab, setActiveTab] = useState('checklist')
  const days = daysUntil(tx.coe)
  const prog = progress(tx)
  const dueBuckets = bucketTasks(collectTasks([tx], []))
  const dueNow = dueBuckets.overdue.length + dueBuckets.today.length

  const sideClass = { buyer: 'side-buyer', seller: 'side-seller', both: 'side-both' }[tx.side] || 'side-seller'
  const statusClass = `status-${tx.status || 'active'}`

  async function handleChange(updates) {
    const merged = { ...tx, ...updates }
    onUpdate(merged)
    await apiUpdate('transactions', tx.id, updates)
  }
const [generatingDrafts, setGeneratingDrafts] = useState(false)
const [draftMsg, setDraftMsg] = useState('')

async function generateDrafts() {
  setGeneratingDrafts(true)
  setDraftMsg('')
  try {
    const res = await fetch('/api/create-intro-drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tx)
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed')
    setDraftMsg(`✓ ${data.created}/${data.total} draft(s) created in Outlook`)
    if (data.created > 0) {
      const cl = applyAutoCheck(tx.checklists, 'intro')
      if (cl) handleChange({ checklists: cl })
    }
    if (data.warnings?.length) setDraftMsg(prev => prev + ' — ' + data.warnings.join('; '))
  } catch (err) {
    setDraftMsg('Error: ' + err.message)
  }
  setGeneratingDrafts(false)
  setTimeout(() => setDraftMsg(''), 8000)
}
  const tabs = [
    { key: 'checklist', label: 'Checklist' },
    { key: 'deadlines', label: 'Deadlines' },
    { key: 'contacts', label: 'Contacts' },
    { key: 'notes', label: `Notes (${(tx.notes || []).length})` },
    { key: 'details', label: 'Details' },
    { key: 'closing', label: 'Closing review' },
  ]

  return (
    <div className="tx-card">
      <div className="tx-card-header" onClick={onExpand}>
        <span className={`side-badge ${sideClass}`}>{tx.side || 'seller'}</span>
        <div className="tx-main">
          <div className="tx-address">{tx.address || 'Untitled'}</div>
          <div className="tx-meta">
            {tx.agentName && <span>👤 {tx.agentName}</span>}
            {tx.coe && <span>📅 COE {tx.coe}</span>}
            <span className={`status-badge ${statusClass}`}>{tx.status || 'active'}</span>
            <span>{prog.done}/{prog.total} tasks ({prog.pct}%)</span>
            {dueNow > 0 && <span className="due-chip overdue">{dueNow} due</span>}
          </div>
        </div>
        <span className={`countdown ${tx.status === 'closed' ? 'cd-none' : cdClass(days)}`}>{tx.status === 'closed' ? 'Closed' : cdText(days)}</span>
      </div>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${prog.pct}%` }} />
      </div>
      {expanded && (
        <div className="tx-body">
          <div className="inner-tabs">
            {tabs.map(t => (
              <button key={t.key} className={`inner-tab${activeTab === t.key ? ' active' : ''}`} onClick={() => setActiveTab(t.key)}>{t.label}</button>
            ))}
           <button className="mini-btn" onClick={generateDrafts} disabled={generatingDrafts}>
  {generatingDrafts ? 'Generating...' : '✉ Generate Intro Emails'}
</button>
<button className="mini-btn ml-auto" onClick={() => onDelete(tx.id)}>🗑 Delete</button>
  {draftMsg && <div style={{ fontSize: 12, color: draftMsg.startsWith('Error') ? '#A32D2D' : '#1D9E75', marginBottom: 8 }}>{draftMsg}</div>}
          </div>
          {activeTab === 'checklist' && <Checklist tx={tx} draftTemplates={draftTemplates} onChange={handleChange} />}
          {activeTab === 'deadlines' && <Deadlines tx={tx} onChange={handleChange} />}
          {activeTab === 'contacts' && <Contacts tx={tx} onChange={handleChange} />}
          {activeTab === 'notes' && <Notes record={tx} onChange={handleChange} />}
          {activeTab === 'details' && <Details tx={tx} onChange={handleChange} />}
          {activeTab === 'closing' && <ClosingReview tx={tx} onChange={handleChange} />}
        </div>
      )}
    </div>
  )
}

// ── Closing statement review ──────────────────────────────────────────────────

const REVIEW_STATUS = {
  ok: { label: 'OK', className: 'review-ok' },
  mismatch: { label: 'Mismatch', className: 'review-bad' },
  missing: { label: 'Missing', className: 'review-bad' },
  review: { label: 'Check', className: 'review-check' },
}

function ClosingReview({ tx, onChange }) {
  const [statement, setStatement] = useState(null) // { name, fileId, status }
  const [invoices, setInvoices] = useState([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [review, setReview] = useState(null)

  function upload(file, set) {
    const entry = { name: file.name, fileId: null, status: 'uploading' }
    set(entry)
    uploadPdf(file)
      .then(fileId => set({ ...entry, fileId, status: 'ready' }))
      .catch(() => set({ ...entry, status: 'error' }))
  }

  function pickStatement(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) upload(f, setStatement)
  }

  function pickInvoices(e) {
    const picked = Array.from(e.target.files || [])
    e.target.value = ''
    picked.forEach(f => {
      const key = `${f.name}-${Math.random()}`
      setInvoices(prev => [...prev, { key, name: f.name, status: 'uploading' }])
      upload(f, entry => setInvoices(prev => prev.map(x => x.key === key ? { ...entry, key } : x)))
    })
  }

  async function run() {
    setError('')
    setRunning(true)
    setReview(null)
    try {
      const res = await fetch('/api/review-closing-statement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId: tx.id,
          statementFileIds: [statement.fileId],
          invoiceFileIds: invoices.filter(i => i.status === 'ready').map(i => i.fileId),
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Review failed')
      setReview(data.review)
      const flagged = data.review.checks.filter(c => c.status !== 'ok')
      const noteText = `Closing statement review: ${data.review.summary}` +
        (flagged.length ? `\n\nNeeds attention:\n${flagged.map(c => `• ${c.item}: expected ${c.expected}, statement shows ${c.found}. ${c.note}`).join('\n')}` : '\n\nEverything checked matched.')
      onChange({ notes: [{ text: noteText, date: now(), author: 'Closing review' }, ...(tx.notes || [])] })
    } catch (err) {
      setError(err.message)
    }
    setRunning(false)
  }

  const uploading = statement?.status === 'uploading' || invoices.some(i => i.status === 'uploading')
  const fileStatus = f => f.status === 'uploading' ? 'Uploading...' : f.status === 'error' ? 'Failed' : '✓'

  return (
    <div>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
        Upload the closing statement from escrow, plus any inspector or vendor invoices. The review compares them with the contract terms and fee allocations on file and flags anything that doesn't match. The result is saved to Notes.
      </p>
      <div className="upload-row">
        <span className="upload-label">Closing statement</span>
        <label className="mini-btn green" style={{ cursor: 'pointer' }}>
          <input type="file" accept="application/pdf" style={{ display: 'none' }} onChange={pickStatement} />
          ⬆ {statement ? 'Replace' : 'Upload PDF'}
        </label>
        {statement && <span className="upload-file">{statement.name} · {fileStatus(statement)}</span>}
      </div>
      <div className="upload-row">
        <span className="upload-label">Invoices (optional)</span>
        <label className="mini-btn green" style={{ cursor: 'pointer' }}>
          <input type="file" accept="application/pdf" multiple style={{ display: 'none' }} onChange={pickInvoices} />
          ⬆ Add PDF(s)
        </label>
        {invoices.map(inv => (
          <span key={inv.key} className="upload-file">
            {inv.name} · {fileStatus(inv)}
            <button className="icon-btn" onClick={() => setInvoices(prev => prev.filter(x => x.key !== inv.key))}>×</button>
          </span>
        ))}
      </div>
      <button className="btn-primary" style={{ marginTop: 8 }} onClick={run} disabled={!statement || statement.status !== 'ready' || uploading || running}>
        {running ? 'Reviewing... this can take a minute' : 'Review closing statement'}
      </button>
      {error && <p style={{ fontSize: 13, color: 'var(--red-text)', marginTop: 10 }}>{error}</p>}
      {review && (
        <div style={{ marginTop: 16 }}>
          <div className="review-summary">{review.summary}</div>
          <div className="review-table">
            {review.checks.map((c, i) => (
              <div key={i} className="review-row">
                <span className={`review-status ${REVIEW_STATUS[c.status]?.className || ''}`}>{REVIEW_STATUS[c.status]?.label || c.status}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="review-item">{c.item}</div>
                  <div className="review-detail">Expected: {c.expected} · Statement: {c.found}</div>
                  {c.note && <div className="review-detail">{c.note}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tasks view ────────────────────────────────────────────────────────────────

function TasksView({ transactions, listings, onComplete }) {
  const [person, setPerson] = useState('all')
  const today = pacificToday()
  const all = collectTasks(transactions, listings)
  const tasks = person === 'all' ? all : all.filter(t => t.owner === person)
  const buckets = bucketTasks(tasks, today)
  const groups = [
    { key: 'overdue', label: 'Overdue', items: buckets.overdue },
    { key: 'today', label: 'Due today', items: buckets.today },
    { key: 'upcoming', label: 'Next 7 days', items: buckets.upcoming },
  ]

  return (
    <>
      <div className="stats">
        <div className="stat-card"><div className="slabel">Overdue</div><div className="svalue" style={{ color: 'var(--red-text)' }}>{buckets.overdue.length}</div></div>
        <div className="stat-card"><div className="slabel">Due today</div><div className="svalue">{buckets.today.length}</div></div>
        <div className="stat-card"><div className="slabel">Next 7 days</div><div className="svalue">{buckets.upcoming.length}</div></div>
        <div className="stat-card"><div className="slabel">Drafts on due date</div><div className="svalue">{tasks.filter(t => t.draftRule && t.due >= today).length}</div></div>
      </div>
      <div className="filter-bar">
        {['all', 'Chaney', 'Megan', 'Diana'].map(p => (
          <button key={p} className={`chip${person === p ? ' active' : ''}`} onClick={() => setPerson(p)}>
            {p === 'all' ? 'Everyone' : p}
          </button>
        ))}
      </div>
      {groups.every(g => g.items.length === 0) ? (
        <div className="empty-state">
          <div className="eicon">✅</div>
          <p>Nothing due in the next 7 days.</p>
        </div>
      ) : groups.filter(g => g.items.length > 0).map(g => (
        <div key={g.key} className="task-group">
          <div className={`task-group-title${g.key === 'overdue' ? ' overdue' : ''}`}>{g.label} <span>{g.items.length}</span></div>
          <div className="task-list">
            {g.items.map(t => (
              <div key={`${t.kind}-${t.recordId}-${t.section}-${t.index}`} className="task-row">
                <input type="checkbox" checked={false} onChange={() => onComplete(t)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="task-text">{t.text}</div>
                  <div className="task-meta">
                    <span className={`task-kind ${t.kind}`}>{t.kind === 'escrow' ? 'Escrow' : 'Listing'}</span>
                    <span>{t.address || 'Untitled'}</span>
                    <span>· {t.sectionLabel}</span>
                    {t.draftRule && <span className="item-tag draft">✉ Auto-draft</span>}
                  </div>
                </div>
                <span className={dueChipClass(t.due, today)}>{dueChipText(t.due, today)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

// ── Notifications bell ────────────────────────────────────────────────────────

function NotificationsBell({ notifications, onOpen }) {
  const [open, setOpen] = useState(false)
  const unread = notifications.filter(n => !n.read).length
  const icons = { draft: '✉', digest: '📋', closed: '🏁' }

  function toggle() {
    const next = !open
    setOpen(next)
    if (next && unread > 0) onOpen()
  }

  return (
    <div className="bell-wrap">
      <button className="bell-btn" onClick={toggle} aria-label="Notifications">
        🔔{unread > 0 && <span className="bell-count">{unread}</span>}
      </button>
      {open && (
        <div className="bell-panel">
          <div className="bell-title">Notifications</div>
          {notifications.length === 0 && <div className="bell-empty">No notifications yet. New drafts created each morning will show up here.</div>}
          {notifications.map(n => (
            <div key={n.id} className={`bell-item${n.read ? '' : ' unread'}`}>
              <span className="bell-icon">{icons[n.kind] || '•'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="bell-item-title">{n.title}{n.kind !== 'closed' ? ' — draft in Outlook' : ''}</div>
                <div className="bell-item-body">{n.body}{n.meta?.missingRecipient ? ' · add a recipient before sending' : ''}</div>
                <div className="bell-item-time">{new Date(n.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── ListingCard ───────────────────────────────────────────────────────────────

function ListingCard({ listing, expanded, onExpand, onUpdate, onDelete }) {
  const [activeTab, setActiveTab] = useState('checklist')
  const prog = progress(listing)
  const statusClass = `status-${listing.status || 'active'}`

  async function handleChange(updates) {
    const merged = { ...listing, ...updates }
    onUpdate(merged)
    await apiUpdate('listings', listing.id, updates)
  }

  const tabs = [
    { key: 'checklist', label: 'Checklist' },
    { key: 'contacts', label: 'Contacts' },
    { key: 'notes', label: `Notes (${(listing.notes || []).length})` },
    { key: 'details', label: 'Details' },
  ]

  return (
    <div className="tx-card">
      <div className="tx-card-header" onClick={onExpand}>
        <span className="side-badge" style={{ background: '#FEF3E2', color: '#854F0B' }}>listing</span>
        <div className="tx-main">
          <div className="tx-address">{listing.address || 'Untitled'}</div>
          <div className="tx-meta">
            {listing.agent_name && <span>👤 {listing.agent_name}</span>}
            {listing.list_date && <span>📅 Listed {listing.list_date}</span>}
            {listing.on_rental_program && <span style={{ background: '#EEEDFE', color: '#3C3489', fontSize: 11, padding: '2px 7px', borderRadius: 6, fontWeight: 500 }}>Rental program</span>}
            <span className={`status-badge ${statusClass}`}>{listing.status || 'active'}</span>
            <span>{prog.done}/{prog.total} tasks ({prog.pct}%)</span>
          </div>
        </div>
        <span className={`countdown ${listing.status === 'active' ? 'cd-ok' : 'cd-none'}`}>
          {listing.price || '—'}
        </span>
      </div>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${prog.pct}%` }} />
      </div>
      {expanded && (
        <div className="tx-body">
          <div className="inner-tabs">
            {tabs.map(t => (
              <button key={t.key} className={`inner-tab${activeTab === t.key ? ' active' : ''}`} onClick={() => setActiveTab(t.key)}>{t.label}</button>
            ))}
            <button className="mini-btn ml-auto" onClick={() => onDelete(listing.id)}>🗑 Delete</button>
          </div>
          {activeTab === 'checklist' && <ListingChecklist listing={listing} onChange={handleChange} />}
          {activeTab === 'contacts' && <ListingContacts listing={listing} onChange={handleChange} />}
          {activeTab === 'notes' && <Notes record={listing} onChange={handleChange} />}
          {activeTab === 'details' && <ListingDetails listing={listing} onChange={handleChange} />}
        </div>
      )}
    </div>
  )
}

// ── NewTxModal ────────────────────────────────────────────────────────────────

function NewTxModal({ onClose, onCreate, onAutoCheck }) {
  const [form, setForm] = useState({ address: '', coe: '', agentName: '', price: '', side: 'seller', status: 'active', mls: '', skyslope: '' })
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  async function submit() {
  if (!form.address.trim()) { alert('Please enter a property address.'); return }
  const tx = {
    ...form,
    checklists: JSON.parse(JSON.stringify(DEFAULT_CHECKLISTS)),
    deadlines: [],
    notes: [],
    contacts: { sellerAgent: form.agentName || 'Bill Dietz' },
  }
  const created = await apiCreate('transactions', tx)
  onCreate(created)
  fetch('/api/create-intro-drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tx)
  })
    .then(r => r.json())
    .then(d => { if (d.created > 0) onAutoCheck(created.id, 'intro') })
    .catch(err => console.error('Draft creation error:', err))
  if (tx.coe) {
    fetch('/api/sync-calendar-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: tx.address,
        coe: tx.coe,
        timelineGroups: [], // manual escrows have no contingency dates to parse yet
        agentName: tx.agentName
      })
    })
      .then(r => r.json())
      .then(d => { if (d.created > 0) onAutoCheck(created.id, 'calendar') })
      .catch(err => console.error('Calendar sync error:', err))
  }

  onClose()
}

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-title">
          <span>New Escrow</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-row">
          <div className="modal-field"><label>Property address *</label><input value={form.address} onChange={e => set('address', e.target.value)} placeholder="123 Main St" autoFocus /></div>
          <div className="modal-field"><label>COE date</label><input type="date" value={form.coe} onChange={e => set('coe', e.target.value)} /></div>
        </div>
        <div className="modal-row">
          <div className="modal-field"><label>Listing agent</label><input value={form.agentName} onChange={e => set('agentName', e.target.value)} placeholder="Name" /></div>
          <div className="modal-field"><label>Purchase price</label><input value={form.price} onChange={e => set('price', e.target.value)} placeholder="$0" /></div>
        </div>
        <div className="modal-row">
          <div className="modal-field">
            <label>Side</label>
            <select value={form.side} onChange={e => set('side', e.target.value)}>
              {['seller', 'buyer', 'both'].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>
          <div className="modal-field">
            <label>Status</label>
            <select value={form.status} onChange={e => set('status', e.target.value)}>
              {['active', 'pending', 'escrow', 'closed'].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>
        </div>
        <div className="modal-row">
          <div className="modal-field"><label>MLS number</label><input value={form.mls} onChange={e => set('mls', e.target.value)} placeholder="—" /></div>
          <div className="modal-field"><label>Skyslope file</label><input value={form.skyslope} onChange={e => set('skyslope', e.target.value)} placeholder="—" /></div>
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit}>Create escrow</button>
        </div>
      </div>
    </div>
  )
}

// ── NewTxFromContractModal ─────────────────────────────────────────────────────

function NewTxFromContractModal({ onClose, onCreate, onAutoCheck }) {
  const [step, setStep] = useState('upload') // 'upload' | 'analyzing' | 'review'
  const [files, setFiles] = useState([]) // [{ name, fileId, status: 'uploading' | 'ready' | 'error' }]
  const [error, setError] = useState('')
  const [extracted, setExtracted] = useState(null)
  const [saving, setSaving] = useState(false)

  async function uploadOne(file) {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result.split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    const response = await fetch('/api/upload-contract-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdfBase64: base64, filename: file.name })
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Upload failed')
    return data.fileId
  }

  function onFilesSelected(e) {
    const picked = Array.from(e.target.files || [])
    e.target.value = ''
    picked.forEach(f => {
      const entry = { name: f.name, fileId: null, status: 'uploading' }
      setFiles(prev => [...prev, entry])
      uploadOne(f).then(fileId => {
        setFiles(prev => prev.map(x => (x.name === f.name && x.status === 'uploading') ? { ...x, fileId, status: 'ready' } : x))
      }).catch(err => {
        console.error(err)
        setFiles(prev => prev.map(x => (x.name === f.name && x.status === 'uploading') ? { ...x, status: 'error' } : x))
      })
    })
  }

  function removeFile(i) {
    setFiles(prev => prev.filter((_, idx) => idx !== i))
  }

  function moveFile(i, dir) {
    setFiles(prev => {
      const arr = [...prev]
      const j = i + dir
      if (j < 0 || j >= arr.length) return arr
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
      return arr
    })
  }

  async function analyze() {
    if (files.length === 0) { setError('Add at least the purchase agreement.'); return }
    if (files.some(f => f.status === 'uploading')) { setError('Still uploading documents — wait a moment and try again.'); return }
    if (files.some(f => f.status === 'error')) { setError('One or more files failed to upload. Remove it and try re-adding it.'); return }
    setError('')
    setStep('analyzing')
    try {
      const response = await fetch('/api/parse-contract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documents: files.map(f => ({ name: f.name, fileId: f.fileId })) })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Server error')
      setExtracted(data.extracted)
      setStep('review')
    } catch (err) {
      console.error(err)
      setError('Could not analyze documents: ' + err.message)
      setStep('upload')
    }
  }

  function updateField(k, v) {
    setExtracted(prev => ({ ...prev, [k]: v }))
  }

  function updateGroupField(i, k, v) {
    setExtracted(prev => {
      const groups = [...(prev.timelineGroups || [])]
      groups[i] = { ...groups[i], [k]: v }
      return { ...prev, timelineGroups: groups }
    })
  }

  function removeGroup(i) {
    setExtracted(prev => ({ ...prev, timelineGroups: (prev.timelineGroups || []).filter((_, idx) => idx !== i) }))
  }

  function updateFee(i, v) {
    setExtracted(prev => {
      const fees = [...(prev.feeAllocations || [])]
      fees[i] = v
      return { ...prev, feeAllocations: fees }
    })
  }

  function removeFee(i) {
    setExtracted(prev => ({ ...prev, feeAllocations: (prev.feeAllocations || []).filter((_, idx) => idx !== i) }))
  }

  async function confirmCreate() {
    if (!extracted.propertyAddress?.trim()) { alert('Property address is required.'); return }
    setSaving(true)
    try {
      const deadlines = (extracted.timelineGroups || [])
        .filter(g => g.date && g.date !== 'TBD')
        .map(g => ({ name: g.label, date: g.date }))
        .sort((a, b) => new Date(a.date) - new Date(b.date))

        const tx = {
  address: extracted.propertyAddress,
  coe: extracted.closeOfEscrow && extracted.closeOfEscrow !== 'TBD' ? extracted.closeOfEscrow : '',
  agentName: extracted.agentName || 'Bill Dietz',
  price: extracted.purchasePrice || '',
  side: 'seller',
  status: 'active',
  seller: extracted.seller || '',
  buyer: extracted.buyer || '',
  apn: extracted.apn || '',
  escrow_company: extracted.escrowCompany || '',
  escrow_number: extracted.escrowNumber || '',
  acceptance_date: extracted.acceptanceDate && extracted.acceptanceDate !== 'TBD' ? extracted.acceptanceDate : null,
  timeline_groups: extracted.timelineGroups || [],
  fee_allocations: extracted.feeAllocations || [],
  checklists: JSON.parse(JSON.stringify(DEFAULT_CHECKLISTS)),
  deadlines,
  notes: [],
  contacts: { sellerAgent: extracted.agentName || 'Bill Dietz' },
}
      const created = await apiCreate('transactions', tx)
      onCreate(created)
      window.open(`/api/generate-timeline-doc/${created.id}`, '_blank')
      onAutoCheck(created.id, 'timeline')

      fetch('/api/sync-calendar-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: tx.address,
          coe: tx.coe,
          timelineGroups: tx.timeline_groups,
          agentName: tx.agentName
        })
      })
        .then(r => r.json())
        .then(d => { if (d.created > 0) onAutoCheck(created.id, 'calendar') })
        .catch(err => console.error('Calendar sync error:', err))

      fetch('/api/create-intro-drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tx)
      })
        .then(r => r.json())
        .then(d => { if (d.created > 0) onAutoCheck(created.id, 'intro') })
        .catch(err => console.error('Draft creation error:', err))

      onClose()
    } catch (err) {
      console.error(err)
      alert('Error creating escrow: ' + err.message)
    }
    setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 640 }}>
        <div className="modal-title">
          <span>New Escrow from Contract</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {step === 'upload' && (
          <>
            <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
              Upload the purchase agreement first, then any counters or addenda <strong>in the order they were signed</strong>. Later documents override earlier terms where they conflict.
            </p>
            <label style={{ cursor: 'pointer' }}>
              <input type="file" accept="application/pdf" multiple style={{ display: 'none' }} onChange={onFilesSelected} />
              <span className="mini-btn green">⬆ Add PDF(s)</span>
            </label>
            <div style={{ marginTop: 14 }}>
              {files.length === 0 && <p style={{ fontSize: 13, color: '#888' }}>No documents added yet.</p>}
              {files.map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--bg-muted)', borderRadius: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: '#888', width: 18 }}>{i + 1}.</span>
                  <span style={{ fontSize: 13, flex: 1 }}>{f.name}</span>
                  {f.status === 'uploading' && <span style={{ fontSize: 11, color: '#888' }}>Uploading...</span>}
                  {f.status === 'error' && <span style={{ fontSize: 11, color: '#A32D2D' }}>Failed</span>}
                  {f.status === 'ready' && <span style={{ fontSize: 11, color: '#1D9E75' }}>✓</span>}
                  <button className="icon-btn" onClick={() => moveFile(i, -1)} disabled={i === 0}>↑</button>
                  <button className="icon-btn" onClick={() => moveFile(i, 1)} disabled={i === files.length - 1}>↓</button>
                  <button className="icon-btn" onClick={() => removeFile(i)}>×</button>
                </div>
              ))}
            </div>
            {error && <p style={{ fontSize: 13, color: '#A32D2D', marginTop: 8 }}>{error}</p>}
            <div className="modal-actions">
              <button className="btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn-primary" onClick={analyze} disabled={files.some(f => f.status === 'uploading')}>Analyze Documents</button>
            </div>
          </>
        )}

        {step === 'analyzing' && (
          <div style={{ padding: '30px 0', textAlign: 'center', color: '#666' }}>
            Reading contract, counters, and addenda... this can take a moment for longer documents.
          </div>
        )}

        {step === 'review' && extracted && (
          <>
            <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
              Review and correct anything before creating the escrow. Nothing is saved yet.
            </p>
            {(extracted.notes || []).length > 0 && (
              <div style={{ background: '#FAEEDA', color: '#854F0B', fontSize: 12, padding: '8px 10px', borderRadius: 6, marginBottom: 12 }}>
                {extracted.notes.map((n, i) => <div key={i}>⚠ {n}</div>)}
              </div>
            )}
            <div className="modal-row">
              <div className="modal-field"><label>Property address *</label><input value={extracted.propertyAddress || ''} onChange={e => updateField('propertyAddress', e.target.value)} /></div>
              <div className="modal-field"><label>Purchase price</label><input value={extracted.purchasePrice || ''} onChange={e => updateField('purchasePrice', e.target.value)} /></div>
            </div>
            <div className="modal-row">
              <div className="modal-field"><label>Seller</label><input value={extracted.seller || ''} onChange={e => updateField('seller', e.target.value)} /></div>
              <div className="modal-field"><label>Buyer</label><input value={extracted.buyer || ''} onChange={e => updateField('buyer', e.target.value)} /></div>
            </div>
            <div className="modal-row">
              <div className="modal-field"><label>APN</label><input value={extracted.apn || ''} onChange={e => updateField('apn', e.target.value)} /></div>
              <div className="modal-field"><label>Acceptance date</label><input type="date" value={extracted.acceptanceDate === 'TBD' ? '' : extracted.acceptanceDate || ''} onChange={e => updateField('acceptanceDate', e.target.value)} /></div>
            </div>
            <div className="modal-row">
              <div className="modal-field"><label>Escrow company</label><input value={extracted.escrowCompany || ''} onChange={e => updateField('escrowCompany', e.target.value)} /></div>
              <div className="modal-field"><label>Escrow number</label><input value={extracted.escrowNumber || ''} onChange={e => updateField('escrowNumber', e.target.value)} /></div>
            </div>
            <div className="modal-field" style={{ marginBottom: 14 }}>
              <label>Close of escrow</label>
              <input type="date" value={extracted.closeOfEscrow === 'TBD' ? '' : extracted.closeOfEscrow || ''} onChange={e => updateField('closeOfEscrow', e.target.value)} />
            </div>

            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, color: 'var(--navy)' }}>Timeline</div>
            {(extracted.timelineGroups || []).map((g, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6, padding: 8, background: 'var(--bg-muted)', borderRadius: 6 }}>
                <input style={{ flex: 2 }} value={g.label} onChange={e => updateGroupField(i, 'label', e.target.value)} />
                <input style={{ flex: 1 }} type="date" value={g.date === 'TBD' ? '' : g.date} onChange={e => updateGroupField(i, 'date', e.target.value)} />
                <button className="icon-btn" onClick={() => removeGroup(i)}>×</button>
              </div>
            ))}

            <div style={{ fontWeight: 600, fontSize: 13, margin: '14px 0 6px', color: 'var(--navy)' }}>Fee & Cost Allocations</div>
            {(extracted.feeAllocations || []).map((f, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                <input style={{ flex: 1 }} value={f} onChange={e => updateFee(i, e.target.value)} />
                <button className="icon-btn" onClick={() => removeFee(i)}>×</button>
              </div>
            ))}

            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setStep('upload')}>Back</button>
              <button className="btn-primary" onClick={confirmCreate} disabled={saving}>
                {saving ? 'Creating...' : 'Create Escrow + Generate Doc'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── NewListingModal ───────────────────────────────────────────────────────────

function NewListingModal({ onClose, onCreate }) {
  const [form, setForm] = useState({ address: '', list_date: '', agent_name: '', price: '', status: 'active', mls: '', skyslope: '', on_rental_program: false })
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  async function submit() {
    if (!form.address.trim()) { alert('Please enter a property address.'); return }
    const listing = {
      ...form,
      checklists: JSON.parse(JSON.stringify(DEFAULT_LISTING_CHECKLISTS)),
      notes: [],
      contacts: { listingAgent: 'Bill Dietz' }
    }
    const created = await apiCreate('listings', listing)
    onCreate(created)
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-title">
          <span>New Listing</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-row">
          <div className="modal-field"><label>Property address *</label><input value={form.address} onChange={e => set('address', e.target.value)} placeholder="123 Main St" autoFocus /></div>
          <div className="modal-field"><label>List date</label><input type="date" value={form.list_date} onChange={e => set('list_date', e.target.value)} /></div>
        </div>
        <div className="modal-row">
          <div className="modal-field"><label>Listing agent</label><input value={form.agent_name} onChange={e => set('agent_name', e.target.value)} placeholder="Name" /></div>
          <div className="modal-field"><label>List price</label><input value={form.price} onChange={e => set('price', e.target.value)} placeholder="$0" /></div>
        </div>
        <div className="modal-row">
          <div className="modal-field"><label>MLS number</label><input value={form.mls} onChange={e => set('mls', e.target.value)} placeholder="—" /></div>
          <div className="modal-field"><label>Skyslope file</label><input value={form.skyslope} onChange={e => set('skyslope', e.target.value)} placeholder="—" /></div>
        </div>
        <div className="modal-row">
          <div className="modal-field">
            <label>Status</label>
            <select value={form.status} onChange={e => set('status', e.target.value)}>
              {['active', 'pending', 'closed'].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>
          <div className="modal-field">
            <label>On rental program?</label>
            <select value={form.on_rental_program ? 'yes' : 'no'} onChange={e => set('on_rental_program', e.target.value === 'yes')}>
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit}>Create listing</button>
        </div>
      </div>
    </div>
  )
}

// ── Templates (escrow) ────────────────────────────────────────────────────────

function Templates() {
  const [templates, setTemplates] = useState(JSON.parse(JSON.stringify(DEFAULT_CHECKLISTS)))
  const sections = [
    { key: 'both_agents', label: 'Both agents actions' },
    { key: 'selling_agent', label: 'Selling agent actions' },
    { key: 'listing_agent', label: 'Listing agent actions' },
    { key: 'coe', label: 'COE actions' },
  ]

  function editText(section, i, val) {
    const t = JSON.parse(JSON.stringify(templates))
    t[section][i].text = val
    setTemplates(t)
    DEFAULT_CHECKLISTS[section][i].text = val
  }

  function editTiming(section, i, val) {
    const t = JSON.parse(JSON.stringify(templates))
    t[section][i].timing = val
    setTemplates(t)
    DEFAULT_CHECKLISTS[section][i].timing = val
  }

  function deleteItem(section, i) {
    const t = JSON.parse(JSON.stringify(templates))
    t[section].splice(i, 1)
    setTemplates(t)
    DEFAULT_CHECKLISTS[section].splice(i, 1)
  }

  function addItem(section) {
    const t = JSON.parse(JSON.stringify(templates))
    t[section].push({ text: 'New item', timing: '', done: false })
    setTemplates(t)
    DEFAULT_CHECKLISTS[section].push({ text: 'New item', timing: '', done: false })
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Escrow checklist templates</div>
        <div style={{ fontSize: 13, color: '#666' }}>Edit items here — every new escrow will start with this checklist.</div>
      </div>
      {sections.map(s => (
        <div key={s.key} className="template-card">
          <div className="template-header">
            <span className="template-name">{s.label}</span>
            <button className="mini-btn green" onClick={() => addItem(s.key)}>+ Add item</button>
          </div>
          {(templates[s.key] || []).map((item, i) => (
            <div key={i} className="template-item">
              <input className="template-item-text" defaultValue={item.text} onBlur={e => editText(s.key, i, e.target.value)} />
              <input className="template-timing" defaultValue={item.timing} placeholder="timing" onBlur={e => editTiming(s.key, i, e.target.value)} />
              <button className="icon-btn" onClick={() => deleteItem(s.key, i)}>×</button>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
const TEAM_MEMBERS = ['Bill', 'Diana', 'Megan', 'Chaney']

function TeamOutlookConnections({ onClose }) {
  const [connections, setConnections] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/outlook-connections')
      .then(r => r.json())
      .then(data => { setConnections(Array.isArray(data) ? data : []); setLoading(false) })
  }, [])

  function isConnected(name) {
    return connections.some(c => c.agent_name === name)
  }

  async function disconnect(name) {
    if (!confirm(`Disconnect ${name}'s Outlook?`)) return
    await fetch(`/api/auth/microsoft/disconnect?agent=${encodeURIComponent(name)}`, { method: 'DELETE' })
    setConnections(prev => prev.filter(c => c.agent_name !== name))
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-title">
          <span>Team Outlook Connections</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
          Connect each team member's Outlook so contingency removal and COE dates sync to their calendar, with reminders.
        </p>
        {loading ? (
          <div className="loading">Loading...</div>
        ) : (
          TEAM_MEMBERS.map(name => (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg-muted)', borderRadius: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13, flex: 1 }}>{name}</span>
              {isConnected(name) ? (
                <>
                  <span style={{ fontSize: 12, color: '#1D9E75', fontWeight: 500 }}>✓ Connected</span>
                  <button className="mini-btn" onClick={() => disconnect(name)}>Disconnect</button>
                </>
              ) : (
                <a href={`/api/auth/microsoft/login?agent=${encodeURIComponent(name)}`}>
                  <button className="mini-btn green">Connect</button>
                </a>
              )}
            </div>
          ))
        )}
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
// ── Main page ─────────────────────────────────────────────────────────────────

export default function Home() {
  // mode: 'escrows' | 'tasks' | 'listings' | 'closed'
  const [mode, setMode] = useState('escrows')
  const [notifications, setNotifications] = useState([])
  const [view, setView] = useState('main') // 'main' | 'templates'
  const [showOutlookModal, setShowOutlookModal] = useState(false)

  const [transactions, setTransactions] = useState([])
  const [listings, setListings] = useState([])
  const [loading, setLoading] = useState(true)

  const [expandedId, setExpandedId] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [showContractModal, setShowContractModal] = useState(false)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    Promise.all([apiGet('transactions'), apiGet('listings')]).then(([txData, listingData]) => {
      setTransactions(Array.isArray(txData) ? txData : [])
      setListings(Array.isArray(listingData) ? listingData : [])
      setLoading(false)
    })
    apiGet('notifications').then(data => setNotifications(Array.isArray(data) ? data : []))
  }, [])

  // Latest records for async callbacks (auto check-offs that finish after a modal closes).
  const txRef = useRef(transactions)
  txRef.current = transactions

  async function autoCheck(txId, ruleKey) {
    const tx = txRef.current.find(t => t.id === txId)
    const cl = tx && applyAutoCheck(tx.checklists, ruleKey)
    if (!cl) return
    txRef.current = txRef.current.map(t => t.id === txId ? { ...t, checklists: cl } : t)
    setTransactions(prev => prev.map(t => t.id === txId ? { ...t, checklists: cl } : t))
    await apiUpdate('transactions', txId, { checklists: cl })
  }

  async function completeTask(task) {
    const list = task.kind === 'escrow' ? transactions : listings
    const record = list.find(r => r.id === task.recordId)
    if (!record) return
    const cl = JSON.parse(JSON.stringify(record.checklists))
    cl[task.section][task.index].done = true
    const updated = { ...record, checklists: cl }
    if (task.kind === 'escrow') updateTx(updated)
    else updateListing(updated)
    await apiUpdate(task.kind === 'escrow' ? 'transactions' : 'listings', record.id, { checklists: cl })
  }

  function markNotificationsRead() {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    fetch('/api/notifications', { method: 'POST' }).catch(err => console.error(err))
  }

  // Template keys of drafts already created, per escrow.
  const draftTemplatesByTx = {}
  notifications.filter(n => n.kind === 'draft' && n.transaction_id).forEach(n => {
    (draftTemplatesByTx[n.transaction_id] = draftTemplatesByTx[n.transaction_id] || new Set()).add(n.meta?.template)
  })

  // Reset filter/search/expanded when switching modes
  function switchMode(newMode) {
    setMode(newMode)
    setFilter('all')
    setSearch('')
    setExpandedId(null)
    setView('main')
  }

  function flashSaved() {
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  // Escrow handlers
  function updateTx(updated) {
    setTransactions(prev => prev.map(t => t.id === updated.id ? updated : t))
    flashSaved()
  }
  async function deleteTx(id) {
    if (!confirm('Delete this escrow? This cannot be undone.')) return
    setTransactions(prev => prev.filter(t => t.id !== id))
    await apiDelete('transactions', id)
  }
  function onCreateTx(tx) {
    setTransactions(prev => [...prev, tx])
    setExpandedId(tx.id)
  }

  // Listing handlers
  function updateListing(updated) {
    setListings(prev => prev.map(l => l.id === updated.id ? updated : l))
    flashSaved()
  }
  async function deleteListing(id) {
    if (!confirm('Delete this listing? This cannot be undone.')) return
    setListings(prev => prev.filter(l => l.id !== id))
    await apiDelete('listings', id)
  }
  function onCreateListing(listing) {
    setListings(prev => [...prev, listing])
    setExpandedId(listing.id)
  }

  // Filtered escrows
  const sortedTx = [...transactions].sort((a, b) => {
    if (!a.coe && !b.coe) return 0
    if (!a.coe) return 1
    if (!b.coe) return -1
    return new Date(a.coe) - new Date(b.coe)
  })
  const openTx = sortedTx.filter(t => t.status !== 'closed')
  const closedTx = sortedTx.filter(t => t.status === 'closed').reverse()
  const filteredClosed = closedTx.filter(t => {
    if (!search) return true
    const q = search.toLowerCase()
    return (t.address || '').toLowerCase().includes(q) || (t.agentName || '').toLowerCase().includes(q)
  })
  const filteredTx = openTx.filter(t => {
    if (filter === 'buyer') return t.side === 'buyer' || t.side === 'both'
    if (filter === 'seller') return t.side === 'seller' || t.side === 'both'
    if (filter !== 'all') return t.status === filter
    return true
  }).filter(t => {
    if (!search) return true
    const q = search.toLowerCase()
    return (t.address || '').toLowerCase().includes(q) || (t.agentName || '').toLowerCase().includes(q)
  })

  // Filtered listings
  const sortedListings = [...listings].sort((a, b) => {
    if (!a.list_date && !b.list_date) return 0
    if (!a.list_date) return 1
    if (!b.list_date) return -1
    return new Date(b.list_date) - new Date(a.list_date)
  })
  const filteredListings = sortedListings.filter(l => {
    if (filter !== 'all') return l.status === filter
    return true
  }).filter(l => {
    if (!search) return true
    const q = search.toLowerCase()
    return (l.address || '').toLowerCase().includes(q) || (l.agent_name || '').toLowerCase().includes(q)
  })

  // Stats
  const escrowStats = {
    total: openTx.length,
    active: openTx.filter(t => t.status === 'active').length,
    closing7: openTx.filter(t => { const d = daysUntil(t.coe); return d !== null && d >= 0 && d <= 7 }).length,
    avgPct: openTx.length ? Math.round(openTx.reduce((a, t) => a + progress(t).pct, 0) / openTx.length) : 0,
  }
  const taskBuckets = bucketTasks(collectTasks(transactions, listings))
  const tasksDueNow = taskBuckets.overdue.length + taskBuckets.today.length
  const listingStats = {
    total: listings.length,
    active: listings.filter(l => l.status === 'active').length,
    rental: listings.filter(l => l.on_rental_program).length,
    avgPct: listings.length ? Math.round(listings.reduce((a, l) => a + progress(l).pct, 0) / listings.length) : 0,
  }

  const escrowFilters = ['all', 'buyer', 'seller', 'active', 'pending', 'escrow']
  const listingFilters = ['all', 'active', 'pending', 'closed']

  return (
    <>
      <Head><title>TC Dashboard</title></Head>

      <div className="topbar">
        <div className="logo">TC <span>Dashboard</span></div>

        {/* Mode toggle */}
        <div className="mode-toggle">
          <button
            className={`tab-btn${mode === 'escrows' ? ' active' : ''}`}
            onClick={() => switchMode('escrows')}
          >Escrows</button>
          <button
            className={`tab-btn${mode === 'tasks' ? ' active' : ''}`}
            onClick={() => switchMode('tasks')}
          >Tasks{tasksDueNow > 0 && <span className="tab-count">{tasksDueNow}</span>}</button>
          <button
            className={`tab-btn${mode === 'listings' ? ' active' : ''}`}
            onClick={() => switchMode('listings')}
          >Listings</button>
          <button
            className={`tab-btn${mode === 'closed' ? ' active' : ''}`}
            onClick={() => switchMode('closed')}
          >Closed</button>
        </div>

        {mode === 'escrows' && (
          <button
            className={`tab-btn${view === 'templates' ? ' active' : ''}`}
            onClick={() => setView(view === 'templates' ? 'main' : 'templates')}
          >Templates</button>
        )}

        <span className={`save-flash${saved ? ' show' : ''}`}>✓ Saved</span>

        {mode === 'escrows' && (
          <button className="add-btn outline" onClick={() => setShowContractModal(true)}>
            📄 New from Contract
          </button>
        )}

        <button className="add-btn" onClick={() => setShowModal(true)}>
          {mode === 'listings' ? '+ New Listing' : '+ New Escrow'}
        </button>
        <NotificationsBell notifications={notifications} onOpen={markNotificationsRead} />
        <button className="mini-btn" onClick={() => setShowOutlookModal(true)}>⚙ Outlook</button>
      </div>

      <div className="main">

        {/* ── LISTINGS ── */}
        {mode === 'listings' && (
          <>
            <div className="page-header">
              <div className="page-title">Listings</div>
              <div className="page-subtitle">Newest first</div>
            </div>
            <div className="stats">
              <div className="stat-card"><div className="slabel">Total listings</div><div className="svalue">{listingStats.total}</div></div>
              <div className="stat-card"><div className="slabel">Active</div><div className="svalue" style={{ color: 'var(--green)' }}>{listingStats.active}</div></div>
              <div className="stat-card"><div className="slabel">On rental program</div><div className="svalue" style={{ color: 'var(--navy-mid)' }}>{listingStats.rental}</div></div>
              <div className="stat-card"><div className="slabel">Avg. completion</div><div className="svalue">{listingStats.avgPct}%</div></div>
            </div>

            <div className="filter-bar">
              <input
                placeholder="Search by address or agent..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {listingFilters.map(f => (
                <button key={f} className={`chip${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="loading">Loading listings...</div>
            ) : filteredListings.length === 0 ? (
              <div className="empty-state">
                <div className="eicon">🏡</div>
                <p>{listings.length === 0 ? 'No listings yet. Click "+ New Listing" to get started.' : 'No listings match your filter.'}</p>
              </div>
            ) : (
              <div className="tx-grid">
                {filteredListings.map(l => (
                  <ListingCard
                    key={l.id}
                    listing={l}
                    expanded={expandedId === l.id}
                    onExpand={() => setExpandedId(expandedId === l.id ? null : l.id)}
                    onUpdate={updateListing}
                    onDelete={deleteListing}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* ── ESCROWS ── */}
        {mode === 'escrows' && view === 'main' && (
          <>
            <div className="page-header">
              <div className="page-title">Escrows</div>
              <div className="page-subtitle">Sorted by close of escrow</div>
            </div>
            <div className="stats">
              <div className="stat-card"><div className="slabel">Total</div><div className="svalue">{escrowStats.total}</div></div>
              <div className="stat-card"><div className="slabel">Active</div><div className="svalue" style={{ color: 'var(--green)' }}>{escrowStats.active}</div></div>
              <div className="stat-card"><div className="slabel">Closing in 7 days</div><div className="svalue" style={{ color: '#A32D2D' }}>{escrowStats.closing7}</div></div>
              <div className="stat-card"><div className="slabel">Avg. completion</div><div className="svalue">{escrowStats.avgPct}%</div></div>
            </div>

            <div className="filter-bar">
              <input
                placeholder="Search by address or agent..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {escrowFilters.map(f => (
                <button key={f} className={`chip${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="loading">Loading escrows...</div>
            ) : filteredTx.length === 0 ? (
              <div className="empty-state">
                <div className="eicon">📋</div>
                <p>{openTx.length === 0 ? 'No open escrows. Click "+ New Escrow" to get started.' : 'No escrows match your filter.'}</p>
              </div>
            ) : (
              <div className="tx-grid">
                {filteredTx.map(tx => (
                  <TxCard
                    key={tx.id}
                    tx={tx}
                    draftTemplates={draftTemplatesByTx[tx.id]}
                    expanded={expandedId === tx.id}
                    onExpand={() => setExpandedId(expandedId === tx.id ? null : tx.id)}
                    onUpdate={updateTx}
                    onDelete={deleteTx}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {mode === 'escrows' && view === 'templates' && <Templates />}

        {/* ── TASKS ── */}
        {mode === 'tasks' && (
          <>
            <div className="page-header">
              <div className="page-title">Tasks</div>
              <div className="page-subtitle">Due dates come from each item's timing and the escrow dates</div>
            </div>
            {loading
              ? <div className="loading">Loading tasks...</div>
              : <TasksView transactions={transactions} listings={listings} onComplete={completeTask} />}
          </>
        )}

        {/* ── CLOSED ── */}
        {mode === 'closed' && (
          <>
            <div className="page-header">
              <div className="page-title">Closed escrows</div>
              <div className="page-subtitle">Most recent first · moved here automatically the day after COE</div>
            </div>
            <div className="filter-bar">
              <input
                placeholder="Search by address or agent..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            {loading ? (
              <div className="loading">Loading closed escrows...</div>
            ) : filteredClosed.length === 0 ? (
              <div className="empty-state">
                <div className="eicon">🏁</div>
                <p>{closedTx.length === 0 ? 'No closed escrows yet.' : 'No closed escrows match your search.'}</p>
              </div>
            ) : (
              <div className="tx-grid">
                {filteredClosed.map(tx => (
                  <TxCard
                    key={tx.id}
                    tx={tx}
                    draftTemplates={draftTemplatesByTx[tx.id]}
                    expanded={expandedId === tx.id}
                    onExpand={() => setExpandedId(expandedId === tx.id ? null : tx.id)}
                    onUpdate={updateTx}
                    onDelete={deleteTx}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {showModal && mode === 'listings' && (
        <NewListingModal onClose={() => setShowModal(false)} onCreate={onCreateListing} />
      )}
      {showModal && mode !== 'listings' && (
        <NewTxModal onClose={() => setShowModal(false)} onCreate={onCreateTx} onAutoCheck={autoCheck} />
      )}
      {showContractModal && (
        <NewTxFromContractModal onClose={() => setShowContractModal(false)} onCreate={onCreateTx} onAutoCheck={autoCheck} />
      )}
{showOutlookModal && <TeamOutlookConnections onClose={() => setShowOutlookModal(false)} />}
    </>
  )
}
