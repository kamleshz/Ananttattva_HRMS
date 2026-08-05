import mongoose from 'mongoose'

const destinationSchema=new mongoose.Schema({
  name:{type:String,trim:true,maxlength:150},
  address:{type:String,trim:true,maxlength:500},
  latitude:{type:Number,min:-90,max:90},
  longitude:{type:Number,min:-180,max:180},
  allowedRadiusMeters:{type:Number,min:25,max:10000,default:250},
},{_id:false})

const workArrangementRequestSchema=new mongoose.Schema({
  employee:{type:mongoose.Schema.Types.ObjectId,ref:'Employee',required:true,index:true},
  type:{type:String,enum:['wfh','client_location','field_visit'],required:true,index:true},
  startDate:{type:Date,required:true,index:true},
  endDate:{type:Date,required:true,index:true},
  startTime:{type:String,default:'00:00'},
  endTime:{type:String,default:'23:59'},
  reason:{type:String,required:true,trim:true,minlength:10,maxlength:1000},
  clientName:{type:String,trim:true,maxlength:150},
  destination:destinationSchema,
  proof:{fileName:String,mimeType:String,data:String},
  status:{type:String,enum:['pending','approved','rejected','cancelled'],default:'pending',index:true},
  reviewedBy:{type:mongoose.Schema.Types.ObjectId,ref:'User',default:null},
  reviewedAt:Date,
  reviewNote:{type:String,trim:true,maxlength:500,default:''},
},{timestamps:true})

workArrangementRequestSchema.index({employee:1,startDate:1,endDate:1,status:1})
export const WorkArrangementRequest=mongoose.model('WorkArrangementRequest',workArrangementRequestSchema)
