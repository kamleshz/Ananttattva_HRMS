import mongoose from 'mongoose'

const attendanceCorrectionRequestSchema=new mongoose.Schema({
  attendance:{type:mongoose.Schema.Types.ObjectId,ref:'Attendance',required:true,index:true},
  employee:{type:mongoose.Schema.Types.ObjectId,ref:'Employee',required:true,index:true},
  requestedCheckinTime:{type:Date,default:null},
  requestedCheckoutTime:{type:Date,default:null},
  reason:{type:String,required:true,trim:true,maxlength:1000},
  status:{type:String,enum:['pending','approved','rejected'],default:'pending',index:true},
  reviewedBy:{type:mongoose.Schema.Types.ObjectId,ref:'User',default:null},
  reviewedAt:Date,
  reviewNote:{type:String,trim:true,maxlength:500,default:''},
  deadline:Date,
  kind:{type:String,enum:['missing_checkout','missing_checkin','missing_both','other'],default:'missing_checkout'},
  submittedWithinDeadline:{type:Boolean,default:false},
  isHrOverride:{type:Boolean,default:false},
  overrideBy:{type:mongoose.Schema.Types.ObjectId,ref:'User',default:null},
  hrCompensationDecision:{type:String,enum:['waive_no_deduction','unpaid'],default:null},
  finalPayMode:{type:String,enum:['waive_excused','unpaid_half','unpaid_full'],default:null},
},{timestamps:true})

attendanceCorrectionRequestSchema.pre('validate',function(next){
  if(!this.requestedCheckinTime && !this.requestedCheckoutTime){
    this.invalidate('requestedCheckoutTime','At least requestedCheckinTime or requestedCheckoutTime must be provided')
  }
  next()
})

attendanceCorrectionRequestSchema.index({attendance:1,status:1})
export const AttendanceCorrectionRequest=mongoose.model('AttendanceCorrectionRequest',attendanceCorrectionRequestSchema)
