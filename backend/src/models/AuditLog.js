import mongoose from 'mongoose'

const auditLogSchema=new mongoose.Schema({
  actorUserId:{type:mongoose.Schema.Types.ObjectId,ref:'User',default:null},actorEmployeeId:{type:mongoose.Schema.Types.ObjectId,ref:'Employee',default:null},
  role:String,action:{type:String,required:true,index:true},entityType:{type:String,required:true,index:true},entityId:{type:String,required:true,index:true},
  beforeSnapshot:mongoose.Schema.Types.Mixed,afterSnapshot:mongoose.Schema.Types.Mixed,metadata:mongoose.Schema.Types.Mixed,
  ip:String,userAgent:String,requestId:String,timestamp:{type:Date,default:Date.now,index:true},
},{versionKey:false,collection:'auditLogs'})

auditLogSchema.index({entityType:1,entityId:1,timestamp:-1})
auditLogSchema.pre(['updateOne','updateMany','findOneAndUpdate','deleteOne','deleteMany'],function(){throw new Error('Audit logs are immutable')})

export const AuditLog=mongoose.model('AuditLog',auditLogSchema)
