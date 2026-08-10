import mongoose from 'mongoose'

const locationSchema = new mongoose.Schema({
  latitude: Number,
  longitude: Number,
  accuracyMeters: Number,
  distanceMeters: Number,
  officeLocation: { type: mongoose.Schema.Types.ObjectId, ref: 'OfficeLocation' },
  officeName: String,
  address: String,
  locationVerified: { type:Boolean, default:false },
  geofenceVerified: { type:Boolean, default:false },
  arrangement: { type:mongoose.Schema.Types.ObjectId, ref:'WorkArrangementRequest', default:null },
}, { _id:false })

const biometricAttemptSchema = new mongoose.Schema({
  attempted:{type:Boolean,default:false},attempts:{type:Number,min:0,max:20,default:0},technicalErrorCode:String,
  cameraStatus:{type:String,enum:['not_attempted','working','failed'],default:'not_attempted'},
  livenessStatus:{type:String,enum:['not_attempted','passed','failed','unknown'],default:'not_attempted'},
  faceMatchStatus:{type:String,enum:['not_attempted','passed','failed','unknown'],default:'not_attempted'},
  faceMatchScore:Number,photoAvailable:{type:Boolean,default:false},proofPhotoStorageKey:String,proofPhotoFormat:String,
  proofPhotoVersion:Number,proofPhotoBytes:Number,proofPhotoHash:String,trusted:{type:Boolean,default:false},
},{_id:false})

const deviceSchema = new mongoose.Schema({ userAgent:String,browser:String,os:String,deviceType:String },{_id:false})

const faceAttendanceRequestSchema = new mongoose.Schema({
  employee: { type:mongoose.Schema.Types.ObjectId, ref:'Employee', required:true, index:true },
  requestedBy: { type:mongoose.Schema.Types.ObjectId, ref:'User', required:true },
  date: { type:Date, required:true, index:true },
  attemptedAt: { type:Date, required:true },
  requestedAt: { type:Date, required:true, index:true },
  action: { type:String, enum:['check_in','check_out'], default:'check_in', index:true },
  attendanceMode: { type:String, enum:['office','wfh','client_location','field_visit'], required:true },
  photo: { type:String, select:false },
  location: { type:locationSchema, default:()=>({}) },
  locationVerified: { type:Boolean, default:false },
  riskLevel: { type:String, enum:['normal','high'], default:'normal', index:true },
  ipAddress: String,
  device: String,
  deviceDetails: deviceSchema,
  faceMatchScore: Number,
  livenessScore: Number,
  biometricAttempt: biometricAttemptSchema,
  reasonCode:String,
  reasonLabel:String,
  remarks:{type:String,trim:true,maxlength:1000,default:''},
  reason: { type:String, required:true, trim:true, maxlength:1000 },
  clientRequestId:{type:String,trim:true},
  status: { type:String, enum:['pending','processing','approved','rejected','cancelled','expired'], default:'pending', index:true },
  reviewedBy: { type:mongoose.Schema.Types.ObjectId, ref:'User', default:null },
  reviewedAt: Date,
  reviewNote: { type:String, trim:true, maxlength:500, default:'' },
  attendance: { type:mongoose.Schema.Types.ObjectId, ref:'Attendance', default:null },
}, { timestamps:true })

faceAttendanceRequestSchema.index(
  { employee:1, date:1, status:1 },
  { unique:true, partialFilterExpression:{ status:'pending' } },
)
faceAttendanceRequestSchema.index({employee:1,date:1,action:1,status:1})
faceAttendanceRequestSchema.index({requestedBy:1,clientRequestId:1},{unique:true,sparse:true})
faceAttendanceRequestSchema.pre('validate',function(){if(!this.requestedAt)this.requestedAt=this.attemptedAt||this.createdAt||new Date();if(!this.action)this.action='check_in'})

export const FaceAttendanceRequest = mongoose.model('FaceAttendanceRequest', faceAttendanceRequestSchema)
