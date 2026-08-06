import mongoose from 'mongoose'

const locationSchema = new mongoose.Schema({
  latitude: Number,
  longitude: Number,
  accuracyMeters: Number,
  distanceMeters: Number,
  officeLocation: { type: mongoose.Schema.Types.ObjectId, ref: 'OfficeLocation' },
  officeName: String,
  address: String,
}, { _id:false })

const faceAttendanceRequestSchema = new mongoose.Schema({
  employee: { type:mongoose.Schema.Types.ObjectId, ref:'Employee', required:true, index:true },
  requestedBy: { type:mongoose.Schema.Types.ObjectId, ref:'User', required:true },
  date: { type:Date, required:true, index:true },
  attemptedAt: { type:Date, required:true },
  attendanceMode: { type:String, enum:['office','wfh','client_location','field_visit'], required:true },
  photo: { type:String, required:true },
  location: { type:locationSchema, required:true },
  locationVerified: { type:Boolean, default:true },
  ipAddress: String,
  device: String,
  faceMatchScore: { type:Number, required:true },
  livenessScore: { type:Number, required:true },
  reason: { type:String, required:true, trim:true, maxlength:1000 },
  status: { type:String, enum:['pending','approved','rejected','expired'], default:'pending', index:true },
  reviewedBy: { type:mongoose.Schema.Types.ObjectId, ref:'User', default:null },
  reviewedAt: Date,
  reviewNote: { type:String, trim:true, maxlength:500, default:'' },
  attendance: { type:mongoose.Schema.Types.ObjectId, ref:'Attendance', default:null },
}, { timestamps:true })

faceAttendanceRequestSchema.index(
  { employee:1, date:1, status:1 },
  { unique:true, partialFilterExpression:{ status:'pending' } },
)

export const FaceAttendanceRequest = mongoose.model('FaceAttendanceRequest', faceAttendanceRequestSchema)
