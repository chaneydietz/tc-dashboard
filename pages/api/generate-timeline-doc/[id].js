import { createClient } from '@supabase/supabase-js'
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, BorderStyle, ShadingType
} from 'docx'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const NAVY = '1F3864'
const LIGHT_BG = 'F4F4F0'

function fmtDate(d) {
  if (!d || d === 'TBD') return 'TBD'
  const dt = new Date(d + 'T00:00:00')
  if (isNaN(dt)) return d
  return dt.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
}

function labelField(label, value) {
  return new Paragraph({
    spacing: { after: 60 },
    children: [
      new TextRun({ text: `${label}: `, bold: true, color: NAVY, size: 22 }),
      new TextRun({ text: value || '', size: 22 }),
    ]
  })
}

function timelineRow(group) {
  const itemLines = (group.items || []).map(it =>
    new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: it, size: 20 })] })
  )
  const labelPara = new Paragraph({ children: [new TextRun({ text: group.label, bold: true, size: 20 })] })

  return new TableRow({
    children: [
      new TableCell({
        width: { size: 75, type: WidthType.PERCENTAGE },
        margins: { top: 80, bottom: 80, left: 100, right: 100 },
        children: itemLines.length ? [labelPara, ...itemLines] : [labelPara],
      }),
      new TableCell({
        width: { size: 25, type: WidthType.PERCENTAGE },
        margins: { top: 80, bottom: 80, left: 100, right: 100 },
        verticalAlign: 'center',
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: fmtDate(group.date), size: 20 })]
        })],
      }),
    ]
  })
}

export default async function handler(req, res) {
  const { id } = req.query
  if (req.method !== 'GET') return res.status(405).end()

  const { data: tx, error } = await supabase.from('transactions').select('*').eq('id', id).single()
  if (error || !tx) return res.status(404).json({ error: error?.message || 'Transaction not found' })

  const groups = Array.isArray(tx.timeline_groups) ? tx.timeline_groups : []
  const fees = Array.isArray(tx.fee_allocations) ? tx.fee_allocations : []

  const rows = groups.map(timelineRow)
  // Bold "Close of Escrow" row styling if present
  const coeIdx = groups.findIndex(g => /close of escrow/i.test(g.label))
  if (coeIdx !== -1) {
    rows[coeIdx] = new TableRow({
      children: [
        new TableCell({
          width: { size: 75, type: WidthType.PERCENTAGE },
          shading: { fill: LIGHT_BG, type: ShadingType.SOLID },
          margins: { top: 80, bottom: 80, left: 100, right: 100 },
          children: [new Paragraph({ children: [new TextRun({ text: groups[coeIdx].label.toUpperCase(), bold: true, size: 20 })] })],
        }),
        new TableCell({
          width: { size: 25, type: WidthType.PERCENTAGE },
          shading: { fill: LIGHT_BG, type: ShadingType.SOLID },
          margins: { top: 80, bottom: 80, left: 100, right: 100 },
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: fmtDate(groups[coeIdx].date), bold: true, size: 20 })]
          })],
        }),
      ]
    })
  }

  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          shading: { fill: NAVY, type: ShadingType.SOLID },
          spacing: { after: 200 },
          children: [new TextRun({ text: 'TAHOE LUXURY PROPERTIES', bold: true, color: 'FFFFFF', size: 28 })],
        }),
        new Paragraph({
          spacing: { after: 100 },
          children: [new TextRun({ text: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), size: 20 })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 40 },
          children: [new TextRun({ text: 'Escrow Timeline for', bold: true, size: 26, color: NAVY })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [new TextRun({ text: tx.address || '', bold: true, size: 26, color: NAVY })]
        }),
        labelField('Seller', tx.seller),
        labelField('Buyer', tx.buyer),
        labelField('Purchase Price', tx.price),
        labelField('APN', tx.apn),
        labelField('Escrow Company', tx.escrow_company),
        labelField('Escrow Number', tx.escrow_number),
        new Paragraph({ text: '', spacing: { after: 100 } }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows,
          borders: {
            top: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
            left: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
            right: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
            insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' },
          }
        }),
        new Paragraph({ text: '', spacing: { after: 150 } }),
        new Paragraph({ children: [new TextRun({ text: 'Additional Items:', bold: true, size: 22 })] }),
        ...fees.map(f => new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: f, size: 20 })] })),
        new Paragraph({ text: '', spacing: { after: 300 } }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: 'TLUXP.com | 530.584.3444 | CA DRE 01403242 | NV RED B0027100', size: 16, color: '888888' })]
        }),
      ]
    }]
  })

  const buffer = await Packer.toBuffer(doc)
  const filename = `Escrow_Timeline_${(tx.address || 'transaction').replace(/[^a-z0-9]+/gi, '_')}.docx`
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  return res.status(200).send(buffer)
}
