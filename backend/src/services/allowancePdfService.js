import PDFKitDocument from 'pdfkit'
import { PDFDocument as PDFLibDocument, StandardFonts, rgb } from 'pdf-lib'
import sharp from 'sharp'

const date = (value, includeTime = false) => value
  ? new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium',
      ...(includeTime ? { timeStyle: 'short' } : {}),
      timeZone: 'Asia/Kolkata',
    }).format(new Date(value))
  : '—'

const money = (value) => `Rs. ${new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(value) || 0)}`

const personName = (person) => [person?.firstName, person?.lastName].filter(Boolean).join(' ') || '—'

function proofBuffer(proof) {
  const raw = String(proof?.data || '')
  const comma = raw.indexOf(',')
  if (comma < 0) return Buffer.from(raw, 'base64')
  return Buffer.from(raw.slice(comma + 1), 'base64')
}

function buildSummaryPdf(claim, organization) {
  return new Promise((resolve, reject) => {
    const doc = new PDFKitDocument({
      size: 'A4',
      margin: 44,
      info: {
        Title: `Allowance claim - ${claim.employee?.employeeCode || claim._id}`,
        Author: organization.companyName || 'AT Connect',
      },
    })
    const chunks = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const rule = () => doc.moveDown(.45).strokeColor('#dce7e4').lineWidth(.7).moveTo(44, doc.y).lineTo(551, doc.y).stroke().moveDown(.7)
    const heading = (text) => {
      doc.moveDown(.65).fillColor('#087d68').font('Helvetica-Bold').fontSize(12).text(text)
      rule()
    }
    const row = (label, value) => {
      const startY = doc.y
      doc.fillColor('#667085').font('Helvetica-Bold').fontSize(9).text(label, 44, startY, { width: 155 })
      doc.fillColor('#263b37').font('Helvetica').text(String(value ?? '—'), 205, startY, { width: 346 })
      doc.y = Math.max(doc.y, startY + 15)
    }

    doc.fillColor('#087d68').font('Helvetica-Bold').fontSize(20).text(organization.companyName || 'Ananttattva Private Limited')
    doc.moveDown(.25).fillColor('#667085').font('Helvetica').fontSize(10).text('Allowance Claim — Complete Record')
    doc.moveDown(.8)
    const boxY = doc.y
    doc.roundedRect(44, boxY, 507, 48, 8).fill('#f0f8f5')
    const summaryY = boxY + 9
    doc.fillColor('#54645f').font('Helvetica').fontSize(8).text('CLAIM TOTAL', 58, summaryY)
    doc.fillColor('#173832').font('Helvetica-Bold').fontSize(14).text(money(claim.totalAmount), 58, summaryY + 14)
    doc.fillColor('#267153').font('Helvetica').fontSize(8).text('ACCEPTABLE', 226, summaryY)
    doc.font('Helvetica-Bold').fontSize(14).text(money(claim.acceptableAmount ?? claim.totalAmount), 226, summaryY + 14)
    doc.fillColor('#a54355').font('Helvetica').fontSize(8).text('NOT ACCEPTABLE', 394, summaryY)
    doc.font('Helvetica-Bold').fontSize(14).text(money(claim.nonAcceptableAmount || 0), 394, summaryY + 14)
    doc.y = boxY + 55

    heading('Employee details')
    row('Employee name', personName(claim.employee))
    row('Employee ID', claim.employee?.employeeCode)
    row('Department', claim.employee?.department)
    row('Designation', claim.employee?.designation)
    row('Official email', claim.employee?.officialEmail)

    heading('Claim details')
    row('Claim ID', String(claim._id))
    row('Allowance month', claim.allowanceMonth)
    row('Travel date', date(claim.travelDate))
    row('Travel location', claim.travelLocation)
    row('Travel allowance', money(claim.travelAllowance))
    row('Extra allowance', money(claim.extraAllowance))
    row('Extra allowance details', claim.extraAllowanceReason || 'No extra allowance claimed')
    row('Total amount', money(claim.totalAmount))
    row('Monthly limit', money(claim.monthlyLimit || 2000))
    row('Submitted at', date(claim.createdAt, true))

    heading('Review and approval')
    row('Claim status', String(claim.status || 'pending').toUpperCase())
    row('Reviewed by', personName(claim.reviewedBy))
    row('Reviewed at', date(claim.reviewedAt, true))
    row('Reviewer note', claim.reviewNote || '—')
    row('Special approval status', String(claim.specialApproval?.status || 'not_requested').replaceAll('_', ' ').toUpperCase())
    if (claim.specialApproval?.status && claim.specialApproval.status !== 'not_requested') {
      row('Special approval amount', money(claim.specialApproval.amount))
      row('Special approval explanation', claim.specialApproval.explanation || '—')
      row('Requested by', personName(claim.specialApproval.requestedBy))
      row('Requested at', date(claim.specialApproval.requestedAt, true))
      row('Special approval reviewed by', personName(claim.specialApproval.reviewedBy))
      row('Special approval reviewed at', date(claim.specialApproval.reviewedAt, true))
      row('Special approval review note', claim.specialApproval.reviewNote || '—')
    }

    heading('Supporting document')
    row('Original file name', claim.proof?.fileName)
    row('Document type', claim.proof?.mimeType)
    if (claim.specialApproval?.proof?.data) {
      row('Special approval document', claim.specialApproval.proof.fileName)
      row('Special document type', claim.specialApproval.proof.mimeType)
    }
    doc.moveDown(.35).fillColor('#667085').font('Helvetica-Oblique').fontSize(8).text('The original supporting document is included on the following page(s).')

    doc.moveDown(1.4).fillColor('#7b8985').font('Helvetica').fontSize(7.5).text(`Generated by AT Connect on ${date(new Date(), true)} · This document contains confidential employee information.`)

    doc.end()
  })
}

export async function generateAllowancePdf(claim, organization = {}) {
  const summary = await buildSummaryPdf(claim, organization)
  const output = await PDFLibDocument.load(summary)
  const documents = [
    { ...claim.proof, label: 'Allowance supporting document' },
    ...(claim.specialApproval?.proof?.data
      ? [{ ...claim.specialApproval.proof, label: 'Special approval supporting document' }]
      : []),
  ]
  const headingFont = await output.embedFont(StandardFonts.HelveticaBold)
  const bodyFont = await output.embedFont(StandardFonts.Helvetica)

  for (const document of documents) {
    const source = proofBuffer(document)
    if (!source.length) throw new Error(`${document.fileName || 'A supporting document'} is empty`)
    if (document.mimeType === 'application/pdf') {
      const proof = await PDFLibDocument.load(source)
      const proofPages = await output.copyPages(proof, proof.getPageIndices())
      proofPages.forEach((page) => output.addPage(page))
      continue
    }
    const normalizedImage = await sharp(source).rotate().png().toBuffer()
    const image = await output.embedPng(normalizedImage)
    const page = output.addPage([595.28, 841.89])
    page.drawText(document.label, { x: 36, y: 803, size: 13, font: headingFont, color: rgb(.09, .22, .20) })
    page.drawText(document.fileName || 'Uploaded proof', { x: 36, y: 786, size: 8, font: bodyFont, color: rgb(.40, .45, .44) })
    const scale = Math.min(523 / image.width, 720 / image.height, 1)
    const width = image.width * scale
    const height = image.height * scale
    page.drawImage(image, { x: (595.28 - width) / 2, y: 42 + (720 - height) / 2, width, height })
  }
  return Buffer.from(await output.save())
}
