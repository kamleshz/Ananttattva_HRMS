import crypto from 'node:crypto'
import PDFDocument from 'pdfkit'
import { CandidateActivity, Notification } from '../models/Recruitment.js'
import { HttpError } from '../utils/httpError.js'

export const candidateStages = ['New Candidate','Screening','Shortlisted','Interview Scheduled','Interview In Progress','Interview Completed','Selected','Offer Draft','Pending Super Admin Approval','Approved','Offer Sent','Offer Viewed','Offer Accepted','Onboarding Pending','Joined','Rejected','Candidate Withdrew','Offer Rejected','Offer Declined','Offer Expired','Position On Hold']
const allowedTransitions = {
  'New Candidate':['Screening','Rejected','Candidate Withdrew'], Screening:['Shortlisted','Rejected','Position On Hold'], Shortlisted:['Interview Scheduled','Rejected'],
  'Interview Scheduled':['Interview In Progress','Interview Completed','Rejected','Candidate Withdrew'], 'Interview In Progress':['Interview Completed','Rejected'],
  'Interview Completed':['Selected','Rejected'], Selected:['Offer Draft','Rejected'], 'Offer Draft':['Pending Super Admin Approval'],
  'Pending Super Admin Approval':['Approved','Offer Rejected','Offer Draft'], Approved:['Offer Sent'], 'Offer Sent':['Offer Viewed','Offer Accepted','Offer Declined','Offer Expired'],
  'Offer Viewed':['Offer Accepted','Offer Declined','Offer Expired'], 'Offer Accepted':['Onboarding Pending'], 'Onboarding Pending':['Joined'],
}

export function validateCandidateTransition(from, to, role) {
  if (!candidateStages.includes(to)) throw new HttpError(422, 'Invalid recruitment stage')
  if (!(allowedTransitions[from] || []).includes(to)) throw new HttpError(409, `Cannot move candidate from ${from} to ${to}`)
  if (from === 'Pending Super Admin Approval' && to === 'Approved' && role !== 'super_admin') throw new HttpError(403, 'Only Super Admin can approve an offer')
}

export async function recordActivity(req, { action, candidate, offer, message, oldValues, newValues }) {
  return CandidateActivity.create({ action, candidate, offer, message, oldValues, newValues, performedBy:req.user?._id, ipAddress:req.ip, deviceInformation:req.get('user-agent') })
}

export async function notifyRoles(UserModel, roles, payload) {
  const users = await UserModel.find({ role:{ $in:roles }, isActive:true }).select('_id')
  if (users.length) await Notification.insertMany(users.map(user => ({ ...payload, recipient:user._id })))
}

export function createPublicOfferToken() {
  const token = crypto.randomBytes(32).toString('hex')
  return { token, hash:crypto.createHash('sha256').update(token).digest('hex') }
}

export function hashPublicToken(token) { return crypto.createHash('sha256').update(token).digest('hex') }

export function generateOfferPdf(offer, candidate, organization = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size:'A4', margin:55, info:{ Title:`Offer Letter - ${candidate.firstName} ${candidate.lastName}`, Author:organization.companyName || 'AT Connect' } })
    const chunks=[]
    doc.on('data', chunk => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject)
    const company = organization.companyName || 'AnanTTattva Private Limited'
    doc.fillColor('#135f58').fontSize(22).font('Helvetica-Bold').text(company)
    doc.moveDown(.25).fillColor('#667085').fontSize(9).font('Helvetica').text([organization.headOfficeAddress, organization.city, organization.state].filter(Boolean).join(', '))
    doc.moveDown(2).fillColor('#17213a').fontSize(11).text(new Intl.DateTimeFormat('en-IN',{dateStyle:'long'}).format(new Date()))
    doc.moveDown(1.5).font('Helvetica-Bold').fontSize(16).text('EMPLOYMENT OFFER')
    doc.moveDown(1.3).font('Helvetica').fontSize(11).text(`Dear ${candidate.firstName} ${candidate.lastName},`)
    doc.moveDown().text(`We are pleased to offer you the position of ${offer.designation || candidate.position} in the ${offer.department || candidate.department} department at ${company}. Your proposed date of joining is ${offer.joiningDate ? new Intl.DateTimeFormat('en-IN',{dateStyle:'long'}).format(offer.joiningDate) : 'as mutually agreed'}.`, { lineGap:5 })
    doc.moveDown(1.3).font('Helvetica-Bold').text('Employment details')
    const rows = [['Designation',offer.designation || candidate.position],['Department',offer.department || candidate.department],['Work location',offer.workLocation || candidate.workLocation || '-'],['Employment type',offer.employmentType || candidate.employmentType],['Probation period',offer.probationPeriod || '-'],['Annual CTC',formatCurrency(offer.compensation?.annualCTC)]]
    rows.forEach(([label,value]) => { doc.moveDown(.5).font('Helvetica-Bold').text(`${label}: `,{continued:true}).font('Helvetica').text(String(value || '-')) })
    doc.moveDown(1.4).font('Helvetica-Bold').text('Terms and conditions')
    doc.moveDown(.6).font('Helvetica').text(offer.terms?.additionalConditions || 'This offer is subject to satisfactory background verification, submission of required documents, company confidentiality and data-protection policies.', { lineGap:5 })
    if (offer.terms?.offerValidUntil) doc.moveDown().text(`Please confirm your acceptance before ${new Intl.DateTimeFormat('en-IN',{dateStyle:'long'}).format(new Date(offer.terms.offerValidUntil))}.`)
    doc.moveDown(2).text('We look forward to welcoming you to our organization.')
    doc.moveDown(2).font('Helvetica-Bold').text(offer.terms?.authorizedSignatory || 'Human Resources')
    doc.font('Helvetica').text(company)
    if (!['Approved','Sent','Viewed','Accepted','Declined'].includes(offer.status)) {
      doc.save().rotate(-35,{origin:[300,420]}).fillColor('#d9dfde').opacity(.35).fontSize(48).font('Helvetica-Bold').text('DRAFT – NOT APPROVED',50,390,{width:520,align:'center'}).restore().opacity(1)
    }
    doc.end()
  })
}

function formatCurrency(value) { return value ? new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(value) : '-' }
