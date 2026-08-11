import mongoose from 'mongoose'

const schema=new mongoose.Schema({
  jti:{type:String,required:true,unique:true,index:true},employee:{type:mongoose.Schema.Types.ObjectId,ref:'Employee',required:true,index:true},
  action:{type:String,enum:['check-in','check-out'],required:true},engineName:String,usedAt:{type:Date,default:Date.now},expiresAt:{type:Date,required:true,index:{expires:0}},
},{versionKey:false})

export const BiometricVerificationUse=mongoose.model('BiometricVerificationUse',schema)
