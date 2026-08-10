import PDFDocument from 'pdfkit'

const rupee = '₹'
const inrFmt = (n) => (n == null || isNaN(n) ? '-' : `${rupee}${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n))}`)
const dateFmt = (d) => d ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d)) : '-'
const periodFmt = (start, end) => {
  const s = start ? dateFmt(start) : ''
  const e = end ? dateFmt(end) : ''
  if (!s && !e) return '-'
  if (s && e) return `${s} – ${e}`
  return s || e
}
const wrapText = (text, maxChars) => {
  const str = String(text || '')
  if (str.length <= maxChars) return [str]
  const words = str.split(/\s+/)
  const lines = []
  let line = ''
  words.forEach((w) => {
    if ((line + ' ' + w).trim().length > maxChars) {
      if (line) lines.push(line)
      line = w
    } else {
      line = (line + ' ' + w).trim()
    }
  })
  if (line) lines.push(line)
  return lines
}

const TABLE_HEADERS = [
  { key: 'businessCategory', label: 'BUSINESS CATEGORY', width: 115 },
  { key: 'serviceCategory', label: 'SERVICE CATEGORY', width: 125 },
  { key: 'period', label: 'EPR / SERVICE PERIOD', width: 135 },
  { key: 'servicesOffered', label: 'SERVICES OFFERED', width: 155 },
  { key: 'unit', label: 'UNIT', width: 45 },
  { key: 'basicAmount', label: 'BASIC AMOUNT (INR)', width: 90 }
]

const HEADER_BG = '#f2761f'
const HEADER_TEXT = '#ffffff'
const ROW_ALT = '#faf7f2'
const GRID = '#1f2937'

export function generateQuotationPdf(quotation, organization = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, layout: 'landscape', info: { Title: `Quotation - ${quotation.quotationCode}`, Author: organization.companyName || 'AT Connect' } })
    const chunks = []
    doc.on('data', (c) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const companyName = organization.companyName || 'AnanTTattva Private Limited'
    const address = [organization.headOfficeAddress, organization.city, organization.state].filter(Boolean).join(', ')
    const phone = organization.phone
    const email = organization.email

    doc.fillColor('#135f58').font('Helvetica-Bold').fontSize(20).text(companyName, 40, 38, { width: 440, align: 'left' })
    doc.fillColor('#6b7280').font('Helvetica').fontSize(9)
    let y = 60
    if (address) { doc.text(address, 40, y, { width: 440 }); y += 12 }
    if (phone || email) { doc.text([phone, email].filter(Boolean).join('   •   '), 40, y, { width: 440 }); y += 4 }

    doc.rect(40, 90, 1043, 1).fill('#d1d5db')

    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(16).text('QUOTATION / PROFORMA INVOICE', 40, 100, { width: 700, align: 'left' })

    const metaX = 40
    const metaY = 130
    doc.font('Helvetica').fontSize(10).fillColor('#374151')
    const metaItems = [
      ['Quotation No.', quotation.quotationCode],
      ['Date', dateFmt(quotation.quotationDate)],
      ['Valid Until', dateFmt(quotation.validUntil)],
      ['Status', quotation.status]
    ]
    let metaCol = 0
    metaItems.forEach(([label, value], idx) => {
      const x = metaX + (idx % 2) * 360
      const yy = metaY + Math.floor(idx / 2) * 18
      doc.fillColor('#6b7280').fontSize(9).text(label + ':', x, yy, { continued: false, width: 140 })
      doc.fillColor('#111827').font('Helvetica-Bold').text(String(value || '-'), x + 95, yy, { width: 260 })
    })

    const clientX = 760
    const clientY = 100
    doc.fillColor(HEADER_BG).fontSize(10).font('Helvetica-Bold').text('CLIENT', clientX, clientY, { width: 320 })
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(11).text(String(quotation.clientName || '-'), clientX, clientY + 14, { width: 320 })
    doc.fillColor('#374151').font('Helvetica').fontSize(9.5)
    let cy = clientY + 30
    if (quotation.clientContactPerson) { doc.text(quotation.clientContactPerson, clientX, cy, { width: 320 }); cy += 12 }
    if (quotation.clientPhone || quotation.clientEmail) { doc.text([quotation.clientPhone, quotation.clientEmail].filter(Boolean).join('  •  '), clientX, cy, { width: 320 }); cy += 12 }
    if (quotation.clientAddress) { doc.text(quotation.clientAddress, clientX, cy, { width: 320 }); cy += 12 }
    if (quotation.gstNumber) { doc.fillColor('#6b7280').fontSize(8.5).text('GSTIN: ' + quotation.gstNumber, clientX, cy + 2, { width: 320 }) }

    let tableY = 210

    const tableX = 40
    const totalTableWidth = TABLE_HEADERS.reduce((s, h) => s + h.width, 0)

    doc.rect(tableX, tableY, totalTableWidth, 28).fill(HEADER_BG)
    doc.fillColor(HEADER_TEXT).font('Helvetica-Bold').fontSize(10)
    let hx = tableX
    TABLE_HEADERS.forEach((h) => {
      doc.text(h.label, hx + 6, tableY + 9, { width: h.width - 12, align: 'left' })
      hx += h.width
    })
    tableY += 28

    const rows = quotation.services || []
    rows.forEach((row, idx) => {
      const values = {
        businessCategory: String(row.businessCategory || '-'),
        serviceCategory: String(row.serviceCategory || '-'),
        period: periodFmt(row.servicePeriodStart, row.servicePeriodEnd),
        servicesOffered: String(row.servicesOffered || '-'),
        unit: String(row.unit || '-'),
        basicAmount: inrFmt(row.basicAmount)
      }
      const linesPerCell = TABLE_HEADERS.map((h) => {
        const maxChars = Math.max(4, Math.floor(h.width / 6.5))
        return wrapText(values[h.key], maxChars).length
      })
      const rowHeight = 14 + Math.max(1, ...linesPerCell) * 11

      if (idx % 2 === 1) {
        doc.rect(tableX, tableY, totalTableWidth, rowHeight).fill(ROW_ALT)
      }

      doc.rect(tableX, tableY, totalTableWidth, rowHeight).stroke(GRID)
      let cx = tableX
      TABLE_HEADERS.forEach((h, colIdx) => {
        const maxChars = Math.max(4, Math.floor(h.width / 6.5))
        const lines = wrapText(values[h.key], maxChars)
        let ly = tableY + 7
        const textColor = h.key === 'basicAmount' ? '#135f58' : '#111827'
        doc.fillColor(textColor).font(h.key === 'basicAmount' ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5)
        lines.forEach((ln) => {
          if (h.key === 'basicAmount') {
            doc.text(ln, cx + 6, ly, { width: h.width - 12, align: 'right' })
          } else {
            doc.text(ln, cx + 6, ly, { width: h.width - 12, align: 'left' })
          }
          ly += 11
        })
        doc.rect(cx, tableY, 0, rowHeight).stroke('#d1d5db')
        cx += h.width
      })
      tableY += rowHeight
    })

    tableY += 8

    const totalsWidth = 320
    const totalsX = tableX + totalTableWidth - totalsWidth
    doc.rect(totalsX, tableY, totalsWidth, 90).stroke('#d1d5db')
    doc.fillColor('#6b7280').font('Helvetica').fontSize(9.5)
    doc.text('Subtotal', totalsX + 10, tableY + 10, { width: 190, align: 'left' })
    doc.fillColor('#111827').font('Helvetica').text(inrFmt(quotation.subtotal), totalsX + 210, tableY + 10, { width: 100, align: 'right' })
    doc.fillColor('#6b7280').font('Helvetica').fontSize(9.5)
    doc.text(`GST @ ${Number(quotation.gstRate || 0).toFixed(2)}%`, totalsX + 10, tableY + 32, { width: 190, align: 'left' })
    doc.fillColor('#111827').font('Helvetica').text(inrFmt(quotation.gstAmount), totalsX + 210, tableY + 32, { width: 100, align: 'right' })
    doc.rect(totalsX, tableY + 54, totalsWidth, 1).fill('#d1d5db')
    doc.fillColor(HEADER_BG).font('Helvetica-Bold').fontSize(11)
    doc.text('GRAND TOTAL', totalsX + 10, tableY + 64, { width: 190, align: 'left' })
    doc.fillColor('#135f58').font('Helvetica-Bold').fontSize(13)
    doc.text(inrFmt(quotation.grandTotal), totalsX + 210, tableY + 63, { width: 100, align: 'right' })

    tableY += 106

    if (quotation.terms) {
      doc.fillColor(HEADER_BG).font('Helvetica-Bold').fontSize(10).text('TERMS & CONDITIONS', tableX, tableY, { width: 700 })
      tableY += 16
      doc.fillColor('#374151').font('Helvetica').fontSize(9.5)
      const termLines = wrapText(quotation.terms, 130)
      termLines.forEach((ln) => { doc.text(ln, tableX, tableY, { width: 800 }); tableY += 12 })
      tableY += 4
    }
    if (quotation.notes) {
      doc.fillColor(HEADER_BG).font('Helvetica-Bold').fontSize(10).text('NOTES', tableX, tableY, { width: 700 })
      tableY += 16
      doc.fillColor('#374151').font('Helvetica').fontSize(9.5)
      const noteLines = wrapText(quotation.notes, 130)
      noteLines.forEach((ln) => { doc.text(ln, tableX, tableY, { width: 800 }); tableY += 12 })
    }

    doc.end()
  })
}
