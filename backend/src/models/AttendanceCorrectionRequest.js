import mongoose from 'mongoose'

const attendanceCorrectionRequestSchema=new mongoose.Schema({
  attendance:{type:mongoose.Schema.Types.ObjectId,ref:'Attendance',required:true,index:true},
  employee:{type:mongoose.Schema.Types.ObjectId,ref:'Employee',required:true,index:true},
  requestedCheckoutTime:{type:Date,required:true},
  reason:{type:String,required:true,trim:true,maxlength:1000},
  status:{type:String,enum:['pending','approved','rejected'],default:'pending',index:true},
  reviewedBy:{type:mongoose.Schema.Types.ObjectId,ref:'User',default:null},
  reviewedAt:Date,
  reviewNote:{type:String,trim:true,maxlength:500,default:''},
  deadline:Date,
  kind:{type:String,enum:['missing_checkout','other'],default:'missing_checkout'},
  submittedWithinDeadline:{type:Boolean,default:false},
  isHrOverride:{type:Boolean,default:false},
  overrideBy:{type:mongoose.Schema.Types.ObjectId,ref:'User',default:null},
},{timestamps:true})

attendanceCorrectionRequestSchema.index({attendance:1,status:1})
export const AttendanceCorrectionRequest=mongoose.model('AttendanceCorrectionRequest',attendanceCorrectionRequestSchema)
