import { useState, useEffect, useCallback } from 'react'
import Head from 'next/head'
import { useSession, signIn, signOut } from 'next-auth/react'
import { DEFAULT_CHECKLISTS } from '../lib/checklists'

export const dynamic = 'force-dynamic'

// ── helpers ──────────────────────────────────────────────────────────────────

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

function cdText(days) {
  if (days === null) return 'No COE set'
  if (days < 0) return 'Closed'
  if (days === 0) return 'Closes today!'
  if (days === 1) return '1 day left'
  return `${days} days left`
}

function progress(tx) {
  let total = 0, done = 0
  const cl = tx.checklists || {}
  Object.values(cl).forEach(items => {
    if (Array.isArray(items)) {
      total += items.length
      done += items.filter(i => i.done).length
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

async function apiGet() {
  const r = await fetch('/api/transactions')
  return r.json()
}

async function apiCreate(tx) {
  const r = await fetch('/api/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tx)
  })
  return r.json()
}

async function apiUpdate(id, updates) {
  const r = await fetch(`/api/transactions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  })
  return r.json()
}

async function apiDelete(id) {
  await fetch(`/api/transactions/${id}`, { method: 'DELETE' })
}

// ── sub-components ────────────────────────────────────────────────────────────

function Checklist({ tx, onChange }) {
  const sections = [
    { key: 'both_agents', label: 'Both agents' },
    { key: 'selling_agent', label: 'Selling agent' },
    { key: 'listing_agent', label: 'Listing agent' },
    { key: 'coe', label: 'COE actions' },
  ]
  const [newText, setNewText] = useState({})

  function toggle(section, idx, val) {
    const cl = JSON.parse(JSON.stringify(tx.checklists))
    cl[section][idx].done = val
    onChange({ checklists: cl })
  }

  function editText(section, idx, text) {
    const cl = JSON.parse(JSON.stringify(tx.checklists))
    cl[section][idx].text = text
    onChange({ checklists: cl })
  }

  function deleteItem(section, idx) {
    const cl = JSON.parse(JSON.stringify(tx.checklists))
    cl[section].splice(idx, 1)
    onChange({ checklists: cl })
  }

  function addItem(section) {
    const text = (newText[section] || '').trim()
    if (!text) return
    const cl = JSON.parse(JSON.stringify(tx.checklists))
    cl[section] = cl[section] || []
    cl[section].push({ text, timing: '', done: false })
    onChange({ checklists: cl })
    setNewText(p => ({ ...p, [section]: '' }))
  }

  return (
    <div>
      {sections.map(s => (
        <div key={s.key} className="cl-section">
          <div className="cl-section-header">
            <span className="cl-section-name">{s.label}</span>
          </div>
          {(tx.checklists[s.key] || []).map((item, i) => (
            <div key={i} className="check-item">
              <input
                type="checkbox"
                checked={item.done}
                onChange={e => toggle(s.key, i, e.target.checked)}
              />
              <span
                className={`check-label${item.done ? ' done' : ''}`}
                contentEditable
                suppressContentEditableWarning
                onBlur={e => editText(s.key, i, e.target.innerText)}
              >{item.text}</span>
              <span className="check-timing">{item.timing}</span>
              <button className="icon-btn" onClick={() => deleteItem(s.key, i)} title="Remove">×</button>
            </div>
          ))}
          <div className="add-item-row">
            <input
              className="add-item-input"
              placeholder="Add item..."
              value={newText[s.key] || ''}
              onChange={e => setNewText(p => ({ ...p, [s.key]: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && addItem(s.key)}
            />
            <button className="mini-btn green" onClick={() => addItem(s.key)}>+ Add</button>
          </div>
        </div>
      ))}
    </div>
  )
}

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
      // Convert PDF to base64
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

      // Merge with existing deadlines, avoiding duplicates by name
      const existing = tx.deadlines || []
      const existingNames = new Set(existing.map(d => d.name.toLowerCase()))
      const newItems = parsed.filter(d => d.name && d.date && !existingNames.has(d.name.toLowerCase()))
      const merged = [...existing, ...newItems].sort((a, b) => new Date(a.date) - new Date(b.date))

      onChange({ deadlines: merged })
      setImportMsg(`✓ Imported ${newItems.length} deadline${newItems.length !== 1 ? 's' : ''}!`)
      setTimeout(() => setImportMsg(''), 3000)
      if (session?.accessToken && newItems.length > 0) {
        syncToCalendar(newItems)
      }
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
      'cd-none': { background: '#f0f0ec', color: '#666' },
    }
    return styles[cdClass(days)] || {}
  }

  return (
    <div>
      {/* Google Calendar connect */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, padding: '8px 12px', background: session?.accessToken ? '#E1F5EE' : '#f4f4f0', borderRadius: 8 }}>
        <span style={{ fontSize: 13, color: '#444', flex: 1 }}>
          {session?.accessToken ? `📅 Google Calendar connected — deadlines will auto-sync` : '📅 Connect Google Calendar to auto-sync deadlines'}
        </span>
        {session?.accessToken
          ? <button className="mini-btn" onClick={() => signOut()}>Disconnect</button>
          : <button className="mini-btn green" onClick={() => signIn('google')}>Connect</button>
        }
      </div>
      {calMsg && <div style={{ fontSize: 12, color: '#1D9E75', fontWeight: 500, marginBottom: 8 }}>{calMsg}</div>}

      {/* PDF Import */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, padding: '10px 12px', background: '#f4f4f0', borderRadius: 8 }}>
        <span style={{ fontSize: 13, color: '#444', flex: 1 }}>📄 Import deadlines from an escrow timeline PDF</span>
        <label style={{ cursor: importing ? 'not-allowed' : 'pointer' }}>
          <input
            type="file"
            accept="application/pdf"
            style={{ display: 'none' }}
            onChange={handlePdfUpload}
            disabled={importing}
          />
          <span className={`mini-btn green${importing ? '' : ''}`} style={{ pointerEvents: importing ? 'none' : 'auto', opacity: importing ? 0.6 : 1 }}>
            {importing ? 'Importing...' : '⬆ Upload PDF'}
          </span>
        </label>
        {importMsg && <span style={{ fontSize: 12, color: importMsg.startsWith('✓') ? '#1D9E75' : '#A32D2D', fontWeight: 500 }}>{importMsg}</span>}
      </div>

      {(tx.deadlines || []).length === 0 && (
        <p style={{ fontSize: 13, color: '#888', paddingBottom: 8 }}>No deadlines added yet. Upload a PDF or add manually below.</p>
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
        <input
          className="add-item-input"
          placeholder="Deadline name"
          value={name}
          onChange={e => setName(e.target.value)}
          style={{ flex: 2, minWidth: 120 }}
        />
        <input
          type="date"
          className="add-item-input"
          value={date}
          onChange={e => setDate(e.target.value)}
          style={{ flex: 1, minWidth: 130 }}
        />
        <button className="mini-btn green" onClick={add}>+ Add</button>
      </div>
    </div>
  )
}

function Contacts({ tx, onChange }) {
  const fields = [
    ['buyerName', 'Buyer name'], ['buyerPhone', 'Buyer phone'],
    ['buyerEmail', 'Buyer email'], ['buyerAgent', 'Buyer agent'],
    ['sellerName', 'Seller name'], ['sellerPhone', 'Seller phone'],
    ['sellerEmail', 'Seller email'], ['sellerAgent', 'Seller agent'],
    ['escrowOfficer', 'Escrow officer'], ['escrowCo', 'Escrow / title co.'],
    ['tcName', 'TC name'], ['tcPhone', 'TC phone'],
  ]
  const c = tx.contacts || {}

  function update(field, val) {
    onChange({ contacts: { ...c, [field]: val } })
  }

  return (
    <div className="detail-grid">
      {fields.map(([key, label]) => (
        <div key={key} className="field-group">
          <label>{label}</label>
          <input
            defaultValue={c[key] || ''}
            onBlur={e => update(key, e.target.value)}
            placeholder="—"
          />
        </div>
      ))}
    </div>
  )
}

function Notes({ tx, onChange }) {
  const [text, setText] = useState('')

  function add() {
    if (!text.trim()) return
    const notes = [{ text: text.trim(), date: now(), author: 'TC' }, ...(tx.notes || [])]
    onChange({ notes })
    setText('')
  }

  function del(i) {
    const notes = [...(tx.notes || [])]
    notes.splice(i, 1)
    onChange({ notes })
  }

  return (
    <div>
      {(tx.notes || []).map((n, i) => (
        <div key={i} className="note-item">
          <div className="note-meta">{n.date}{n.author ? ` · ${n.author}` : ''}</div>
          <div className="note-text">{n.text}</div>
          <div style={{ marginTop: 6 }}>
            <button className="mini-btn danger" onClick={() => del(i)}>Delete</button>
          </div>
        </div>
      ))}
      <div className="note-input-row">
        <textarea
          placeholder="Add a note or activity log entry..."
          value={text}
          onChange={e => setText(e.target.value)}
        />
        <button className="mini-btn green" onClick={add} style={{ alignSelf: 'flex-end' }}>+ Add</button>
      </div>
    </div>
  )
}

function Details({ tx, onChange }) {
  const fields = [
    ['address', 'Property address', 'text'],
    ['coe', 'COE date', 'date'],
    ['agentName', 'Listing agent', 'text'],
    ['price', 'Purchase price', 'text'],
    ['mls', 'MLS number', 'text'],
    ['skyslope', 'Skyslope file', 'text'],
  ]

  return (
    <div>
      <div className="detail-grid" style={{ marginBottom: 12 }}>
        {fields.map(([key, label, type]) => (
          <div key={key} className="field-group">
            <label>{label}</label>
            <input
              type={type}
              defaultValue={tx[key] || ''}
              onBlur={e => onChange({ [key]: e.target.value })}
              placeholder="—"
            />
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
    </div>
  )
}

// ── TxCard ────────────────────────────────────────────────────────────────────

function TxCard({ tx, expanded, onExpand, onUpdate, onDelete }) {
  const [activeTab, setActiveTab] = useState('checklist')
  const days = daysUntil(tx.coe)
  const prog = progress(tx)

  const sideClass = { buyer: 'side-buyer', seller: 'side-seller', both: 'side-both' }[tx.side] || 'side-seller'
  const statusClass = `status-${tx.status || 'active'}`

  async function handleChange(updates) {
    const merged = { ...tx, ...updates }
    onUpdate(merged)
    await apiUpdate(tx.id, updates)
  }

  const tabs = [
    { key: 'checklist', label: `Checklist` },
    { key: 'deadlines', label: `Deadlines` },
    { key: 'contacts', label: 'Contacts' },
    { key: 'notes', label: `Notes (${(tx.notes || []).length})` },
    { key: 'details', label: 'Details' },
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
          </div>
        </div>
        <span className={`countdown ${cdClass(days)}`}>{cdText(days)}</span>
      </div>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${prog.pct}%` }} />
      </div>
      {expanded && (
        <div className="tx-body">
          <div className="inner-tabs">
            {tabs.map(t => (
              <button
                key={t.key}
                className={`inner-tab${activeTab === t.key ? ' active' : ''}`}
                onClick={() => setActiveTab(t.key)}
              >{t.label}</button>
            ))}
            <button className="mini-btn ml-auto" onClick={() => onDelete(tx.id)}>🗑 Delete</button>
          </div>
          {activeTab === 'checklist' && <Checklist tx={tx} onChange={handleChange} />}
          {activeTab === 'deadlines' && <Deadlines tx={tx} onChange={handleChange} />}
          {activeTab === 'contacts' && <Contacts tx={tx} onChange={handleChange} />}
          {activeTab === 'notes' && <Notes tx={tx} onChange={handleChange} />}
          {activeTab === 'details' && <Details tx={tx} onChange={handleChange} />}
        </div>
      )}
    </div>
  )
}

// ── NewTxModal ────────────────────────────────────────────────────────────────

function NewTxModal({ onClose, onCreate }) {
  const [form, setForm] = useState({ address: '', coe: '', agentName: '', price: '', side: 'seller', status: 'active', mls: '', skyslope: '' })

  async function submit() {
    if (!form.address.trim()) { alert('Please enter a property address.'); return }
    const tx = {
      ...form,
      checklists: JSON.parse(JSON.stringify(DEFAULT_CHECKLISTS)),
      deadlines: [],
      notes: [],
      contacts: { sellerAgent: 'Bill Dietz' },
      created_at: new Date().toISOString(),
    }
    const created = await apiCreate(tx)
    onCreate(created)
    onClose()
  }

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-title">
          <span>New Transaction</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-row">
          <div className="modal-field">
            <label>Property address *</label>
            <input value={form.address} onChange={e => set('address', e.target.value)} placeholder="123 Main St" autoFocus />
          </div>
          <div className="modal-field">
            <label>COE date</label>
            <input type="date" value={form.coe} onChange={e => set('coe', e.target.value)} />
          </div>
        </div>
        <div className="modal-row">
          <div className="modal-field">
            <label>Listing agent</label>
            <input value={form.agentName} onChange={e => set('agentName', e.target.value)} placeholder="Name" />
          </div>
          <div className="modal-field">
            <label>Purchase price</label>
            <input value={form.price} onChange={e => set('price', e.target.value)} placeholder="$0" />
          </div>
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
          <div className="modal-field">
            <label>MLS number</label>
            <input value={form.mls} onChange={e => set('mls', e.target.value)} placeholder="—" />
          </div>
          <div className="modal-field">
            <label>Skyslope file</label>
            <input value={form.skyslope} onChange={e => set('skyslope', e.target.value)} placeholder="—" />
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit}>Create transaction</button>
        </div>
      </div>
    </div>
  )
}

// ── Templates ─────────────────────────────────────────────────────────────────

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
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Default checklist templates</div>
        <div style={{ fontSize: 13, color: '#666' }}>Edit items here — every new transaction will start with this checklist.</div>
      </div>
      {sections.map(s => (
        <div key={s.key} className="template-card">
          <div className="template-header">
            <span className="template-name">{s.label}</span>
            <button className="mini-btn green" onClick={() => addItem(s.key)}>+ Add item</button>
          </div>
          {(templates[s.key] || []).map((item, i) => (
            <div key={i} className="template-item">
              <input
                className="template-item-text"
                defaultValue={item.text}
                onBlur={e => editText(s.key, i, e.target.value)}
              />
              <input
                className="template-timing"
                defaultValue={item.timing}
                placeholder="timing"
                onBlur={e => editTiming(s.key, i, e.target.value)}
              />
              <button className="icon-btn" onClick={() => deleteItem(s.key, i)}>×</button>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('transactions')
  const [expandedId, setExpandedId] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    apiGet().then(data => {
      setTransactions(Array.isArray(data) ? data : [])
      setLoading(false)
    })
  }, [])

  function flashSaved() {
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  function updateTx(updated) {
    setTransactions(prev => prev.map(t => t.id === updated.id ? updated : t))
    flashSaved()
  }

  async function deleteTx(id) {
    if (!confirm('Delete this transaction? This cannot be undone.')) return
    setTransactions(prev => prev.filter(t => t.id !== id))
    await apiDelete(id)
  }

  function onCreate(tx) {
    setTransactions(prev => [...prev, tx])
    setExpandedId(tx.id)
  }

  const sorted = [...transactions].sort((a, b) => {
    if (!a.coe && !b.coe) return 0
    if (!a.coe) return 1
    if (!b.coe) return -1
    return new Date(a.coe) - new Date(b.coe)
  })

  const filtered = sorted.filter(t => {
    if (filter === 'buyer') return t.side === 'buyer' || t.side === 'both'
    if (filter === 'seller') return t.side === 'seller' || t.side === 'both'
    if (filter !== 'all') return t.status === filter
    return true
  }).filter(t => {
    if (!search) return true
    const q = search.toLowerCase()
    return (t.address || '').toLowerCase().includes(q) || (t.agentName || '').toLowerCase().includes(q)
  })

  const stats = {
    total: transactions.length,
    active: transactions.filter(t => t.status === 'active').length,
    closing7: transactions.filter(t => { const d = daysUntil(t.coe); return d !== null && d >= 0 && d <= 7 }).length,
    avgPct: transactions.length ? Math.round(transactions.reduce((a, t) => a + progress(t).pct, 0) / transactions.length) : 0,
  }

  const filterChips = ['all', 'buyer', 'seller', 'active', 'pending', 'escrow']

  return (
    <>
      <Head><title>TC Dashboard</title></Head>

      <div className="topbar">
        <div className="logo">TC <span>Dashboard</span></div>
        <button className={`tab-btn${view === 'transactions' ? ' active' : ''}`} onClick={() => setView('transactions')}>Transactions</button>
        <button className={`tab-btn${view === 'templates' ? ' active' : ''}`} onClick={() => setView('templates')}>Templates</button>
        <span className={`save-flash${saved ? ' show' : ''}`}>✓ Saved</span>
        <button className="add-btn" onClick={() => setShowModal(true)}>+ New Transaction</button>
      </div>

      <div className="main">
        {view === 'transactions' && (
          <>
            <div className="stats">
              <div className="stat-card"><div className="slabel">Total</div><div className="svalue">{stats.total}</div></div>
              <div className="stat-card"><div className="slabel">Active</div><div className="svalue" style={{ color: '#1D9E75' }}>{stats.active}</div></div>
              <div className="stat-card"><div className="slabel">Closing in 7 days</div><div className="svalue" style={{ color: '#A32D2D' }}>{stats.closing7}</div></div>
              <div className="stat-card"><div className="slabel">Avg. completion</div><div className="svalue">{stats.avgPct}%</div></div>
            </div>

            <div className="filter-bar">
              <input
                placeholder="Search by address or agent..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {filterChips.map(f => (
                <button key={f} className={`chip${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="loading">Loading transactions...</div>
            ) : filtered.length === 0 ? (
              <div className="empty-state">
                <div className="eicon">🏡</div>
                <p>{transactions.length === 0 ? 'No transactions yet. Click "+ New Transaction" to get started.' : 'No transactions match your filter.'}</p>
              </div>
            ) : (
              <div className="tx-grid">
                {filtered.map(tx => (
                  <TxCard
                    key={tx.id}
                    tx={tx}
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

        {view === 'templates' && <Templates />}
      </div>

      {showModal && <NewTxModal onClose={() => setShowModal(false)} onCreate={onCreate} />}
    </>
  )
}
