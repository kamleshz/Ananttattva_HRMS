import mongoose from 'mongoose'

const objectId = mongoose.Schema.Types.ObjectId

const activitySchema = new mongoose.Schema({
  action: { type: String, required: true, index: true }, module: { type: String, default: 'recruitment' },
  candidate: { type: objectId, ref: 'Candidate', index: true }, offer: { type: objectId, ref: 'OfferLetter', index: true },
  performedBy: { type: objectId, ref: 'User' }, oldValues: mongoose.Schema.Types.Mixed, newValues: mongoose.Schema.Types.Mixed,
  message: String, ipAddress: String, deviceInformation: String,
}, { timestamps: true, collection: 'candidateActivities' })

const candidateSchema = new mongoose.Schema({
  candidateCode: { type: String, required: true, unique: true, index: true },
  firstName: { type: String, required: true, trim: true }, middleName: { type: String, trim: true }, lastName: { type: String, required: true, trim: true }, photo: String,
  email: { type: String, required: true, lowercase: true, trim: true, index: true }, mobile: { type: String, required: true, trim: true, index: true }, alternateMobile: String,
  dateOfBirth: Date, gender: String, currentCity: String, address: String, preferredLocation: String, pan: { type: String, uppercase: true, trim: true, sparse: true, index: true },
  jobOpening: { type: objectId, ref: 'JobOpening' }, position: { type: String, required: true }, department: { type: String, required: true, index: true }, designation: String,
  employmentType: { type: String, enum: ['Permanent','Probation','Contract','Internship','Consultant'], default: 'Permanent' }, workLocation: String,
  hiringManager: { type: objectId, ref: 'User' }, recruiter: { type: objectId, ref: 'User' }, source: { type: String, default: 'Other', index: true }, expectedJoiningDate: Date,
  totalExperience: { type: Number, default: 0 }, relevantExperience: { type: Number, default: 0 }, currentCompany: String, currentDesignation: String,
  currentCTC: Number, expectedCTC: Number, noticePeriod: String, lastWorkingDate: Date, negotiableNoticePeriod: Boolean, skills: [String], qualification: String,
  employmentStatus: { type: String, enum: ['Employed','Serving Notice Period','Unemployed','Fresher'], default: 'Fresher' }, notes: String,
  status: { type: String, default: 'Active', index: true }, currentStage: { type: String, default: 'New Candidate', index: true },
  selectedDetails: mongoose.Schema.Types.Mixed, rejection: mongoose.Schema.Types.Mixed, onboardingEmployee: { type: objectId, ref: 'Employee' },
  createdBy: { type: objectId, ref: 'User', required: true }, updatedBy: { type: objectId, ref: 'User' }, duplicateOverride: Boolean,
}, { timestamps: true, collection: 'candidates' })
candidateSchema.index({ firstName:'text', middleName:'text', lastName:'text', email:'text', mobile:'text', candidateCode:'text', position:'text', skills:'text' })

const interviewSchema = new mongoose.Schema({
  candidate: { type: objectId, ref: 'Candidate', required: true, index: true }, round: { type: String, required: true }, interviewType: String,
  date: { type: Date, required: true, index: true }, startTime: String, endTime: String, interviewers: [{ type: objectId, ref: 'User' }],
  meetingMode: String, meetingLink: String, location: String, instructions: String, internalNotes: String,
  status: { type: String, enum: ['Scheduled','Completed','Cancelled','Rescheduled','No Show'], default: 'Scheduled', index: true },
  feedbackSubmitted: { type: Boolean, default: false }, scheduledBy: { type: objectId, ref: 'User', required: true },
}, { timestamps: true, collection: 'interviews' })

const feedbackSchema = new mongoose.Schema({
  interview: { type: objectId, ref: 'Interview', required: true, index: true }, candidate: { type: objectId, ref: 'Candidate', required: true, index: true }, interviewer: { type: objectId, ref: 'User', required: true },
  technicalSkills: Number, communication: Number, problemSolving: Number, roleKnowledge: Number, cultureFit: Number, experienceRelevance: Number,
  strengths: String, concerns: String, detailedFeedback: String, recommendation: { type: String, enum: ['Strong Hire','Hire','Hold','Reject','Strong Reject'], required: true }, locked: { type: Boolean, default: true },
}, { timestamps: true, collection: 'interviewFeedback' })
feedbackSchema.index({ interview:1, interviewer:1 }, { unique:true })

const documentSchema = new mongoose.Schema({
  candidate: { type: objectId, ref: 'Candidate', required: true, index: true }, documentType: { type: String, required: true }, fileName: String,
  mimeType: String, size: Number, storageProvider: { type: String, default: 'private-mongodb' }, storageKey: String, fileData: { type: Buffer, select: false },
  uploadedBy: { type: objectId, ref: 'User' }, verificationStatus: { type: String, enum: ['Pending Verification','Verified','Rejected'], default: 'Pending Verification' }, remarks: String,
}, { timestamps: true, collection: 'candidateDocuments' })

const compensationSchema = new mongoose.Schema({ annualCTC:Number, monthlyGross:Number, basicSalary:Number, hra:Number, conveyance:Number, specialAllowance:Number, bonus:Number, variablePay:Number, employerPF:Number, gratuity:Number, otherBenefits:Number, deductions:Number, netPayEstimate:Number }, { _id:false })
const offerSchema = new mongoose.Schema({
  offerCode: { type: String, required: true, unique: true, index:true }, candidate: { type: objectId, ref:'Candidate', required:true, index:true },
  designation:String, department:String, reportingManager:{ type:objectId, ref:'User' }, workLocation:String, employmentType:String, joiningDate:Date, probationPeriod:String, workTimings:String, weeklyOff:String, noticePeriod:String,
  compensation: compensationSchema, terms: mongoose.Schema.Types.Mixed, template:{ type:objectId, ref:'OfferTemplate' }, pdfData:{ type:Buffer, select:false }, pdfFileName:String,
  status:{ type:String, default:'Draft', index:true }, submittedBy:{ type:objectId, ref:'User' }, submittedAt:Date, approvedBy:{ type:objectId, ref:'User' }, approvedAt:Date, approvalRemarks:String,
  changesRequestedBy:{ type:objectId, ref:'User' }, changesRequestedAt:Date, changeRemarks:String, rejectedBy:{ type:objectId, ref:'User' }, rejectedAt:Date, rejectionReason:String,
  sentBy:{ type:objectId, ref:'User' }, sentAt:Date, sentTo:String, emailProviderMessageId:String, viewedAt:Date, acceptedAt:Date, declinedAt:Date, declineReason:String, candidateComment:String,
  secureTokenHash:{ type:String, select:false, index:true }, tokenExpiresAt:Date, signedCopy:{ fileName:String, mimeType:String, fileData:{ type:Buffer, select:false } }, version:{ type:Number, default:1 }, immutableSnapshot:mongoose.Schema.Types.Mixed,
}, { timestamps:true, collection:'offerLetters' })

const approvalSchema = new mongoose.Schema({ offer:{ type:objectId, ref:'OfferLetter', required:true, index:true }, candidate:{ type:objectId, ref:'Candidate', required:true }, version:Number, status:{ type:String, enum:['Pending','Approved','Changes Requested','Rejected'], default:'Pending', index:true }, submittedBy:{ type:objectId, ref:'User' }, reviewedBy:{ type:objectId, ref:'User' }, remarks:String, reviewedAt:Date }, { timestamps:true, collection:'offerApprovals' })
const templateSchema = new mongoose.Schema({ name:{ type:String, required:true }, company:String, branch:String, employmentType:String, headerLogo:String, companyAddress:String, authorizedSignatory:String, signature:String, footer:String, terms:String, emailSubject:String, emailBody:String, isActive:{ type:Boolean, default:true }, createdBy:{ type:objectId, ref:'User' } }, { timestamps:true, collection:'offerTemplates' })
const jobOpeningSchema = new mongoose.Schema({ code:String, title:{ type:String, required:true }, department:String, designation:String, employmentType:String, location:String, hiringManager:{ type:objectId, ref:'User' }, openings:Number, status:{ type:String, default:'Open' } }, { timestamps:true, collection:'jobOpenings' })
const communicationSchema = new mongoose.Schema({ candidate:{ type:objectId, ref:'Candidate' }, offer:{ type:objectId, ref:'OfferLetter' }, type:String, recipient:String, subject:String, status:String, providerMessageId:String, sentBy:{ type:objectId, ref:'User' } }, { timestamps:true, collection:'candidateCommunications' })
const settingsSchema = new mongoose.Schema({ key:{ type:String, unique:true }, value:mongoose.Schema.Types.Mixed, updatedBy:{ type:objectId, ref:'User' } }, { timestamps:true, collection:'recruitmentSettings' })
const notificationSchema = new mongoose.Schema({ recipient:{ type:objectId, ref:'User', required:true, index:true }, type:String, title:String, message:String, candidate:{ type:objectId, ref:'Candidate' }, offer:{ type:objectId, ref:'OfferLetter' }, employee:{ type:objectId, ref:'Employee' }, readAt:Date }, { timestamps:true, collection:'notifications' })

export const Candidate = mongoose.model('Candidate', candidateSchema)
export const Interview = mongoose.model('Interview', interviewSchema)
export const InterviewFeedback = mongoose.model('InterviewFeedback', feedbackSchema)
export const CandidateDocument = mongoose.model('CandidateDocument', documentSchema)
export const CandidateActivity = mongoose.model('CandidateActivity', activitySchema)
export const OfferLetter = mongoose.model('OfferLetter', offerSchema)
export const OfferApproval = mongoose.model('OfferApproval', approvalSchema)
export const OfferTemplate = mongoose.model('OfferTemplate', templateSchema)
export const JobOpening = mongoose.model('JobOpening', jobOpeningSchema)
export const CandidateCommunication = mongoose.model('CandidateCommunication', communicationSchema)
export const RecruitmentSetting = mongoose.model('RecruitmentSetting', settingsSchema)
export const Notification = mongoose.model('Notification', notificationSchema)
