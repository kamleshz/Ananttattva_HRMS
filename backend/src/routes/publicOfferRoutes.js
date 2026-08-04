import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { asyncHandler } from '../utils/asyncHandler.js'
import { HttpError } from '../utils/httpError.js'
import { Candidate, CandidateActivity, OfferLetter } from '../models/Recruitment.js'
import { hashPublicToken } from '../services/recruitmentService.js'

const router=Router()
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024},fileFilter:(_req,file,cb)=>cb(null,['application/pdf','image/jpeg','image/png'].includes(file.mimetype))})

async function findOffer(token,{pdf=false,signed=false}={}){
  let query=OfferLetter.findOne({secureTokenHash:hashPublicToken(token)})
  if(pdf)query=query.select('+pdfData')
  if(signed)query=query.select('+signedCopy.fileData')
  const offer=await query.populate('candidate','candidateCode firstName middleName lastName email mobile position department')
  if(!offer||!offer.tokenExpiresAt||offer.tokenExpiresAt<new Date())throw new HttpError(410,'This offer link is invalid or has expired')
  return offer
}

router.get('/:token',asyncHandler(async(req,res)=>{const offer=await findOffer(req.params.token);res.json({success:true,data:{offerCode:offer.offerCode,status:offer.status,candidate:offer.candidate,designation:offer.designation,department:offer.department,workLocation:offer.workLocation,employmentType:offer.employmentType,joiningDate:offer.joiningDate,compensation:{annualCTC:offer.compensation?.annualCTC,monthlyGross:offer.compensation?.monthlyGross},terms:{offerValidUntil:offer.terms?.offerValidUntil,probationPeriod:offer.probationPeriod,noticePeriod:offer.noticePeriod},viewedAt:offer.viewedAt,acceptedAt:offer.acceptedAt,declinedAt:offer.declinedAt}})}))
router.post('/:token/view',asyncHandler(async(req,res)=>{const offer=await findOffer(req.params.token);if(offer.status==='Sent'){offer.status='Viewed';offer.viewedAt=new Date();await offer.save();await Candidate.findByIdAndUpdate(offer.candidate._id,{currentStage:'Offer Viewed'});await CandidateActivity.create({action:'Candidate Viewed Offer',candidate:offer.candidate._id,offer:offer._id,message:'Candidate viewed the offer',ipAddress:req.ip,deviceInformation:req.get('user-agent')})}res.json({success:true,data:{status:offer.status}})}))
router.get('/:token/download',asyncHandler(async(req,res)=>{const offer=await findOffer(req.params.token,{pdf:true});if(!offer.pdfData)throw new HttpError(404,'Offer document is not available');res.set({'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${offer.pdfFileName}"`,'Cache-Control':'private, no-store'}).send(offer.pdfData)}))
router.post('/:token/accept',asyncHandler(async(req,res)=>{const input=z.object({expectedJoiningDate:z.coerce.date(),comment:z.string().optional()}).parse(req.body),offer=await findOffer(req.params.token);if(!['Sent','Viewed'].includes(offer.status))throw new HttpError(409,'This offer can no longer be accepted');offer.status='Accepted';offer.acceptedAt=new Date();offer.joiningDate=input.expectedJoiningDate;offer.candidateComment=input.comment;await offer.save();await Candidate.findByIdAndUpdate(offer.candidate._id,{currentStage:'Offer Accepted',expectedJoiningDate:input.expectedJoiningDate});await CandidateActivity.create({action:'Candidate Accepted Offer',candidate:offer.candidate._id,offer:offer._id,message:'Candidate accepted the offer',newValues:{expectedJoiningDate:input.expectedJoiningDate},ipAddress:req.ip,deviceInformation:req.get('user-agent')});res.json({success:true,data:{status:offer.status,acceptedAt:offer.acceptedAt}})}))
router.post('/:token/decline',asyncHandler(async(req,res)=>{const input=z.object({reason:z.string().min(2),comments:z.string().optional()}).parse(req.body),offer=await findOffer(req.params.token);if(!['Sent','Viewed'].includes(offer.status))throw new HttpError(409,'This offer can no longer be declined');offer.status='Declined';offer.declinedAt=new Date();offer.declineReason=input.reason;offer.candidateComment=input.comments;await offer.save();await Candidate.findByIdAndUpdate(offer.candidate._id,{currentStage:'Offer Declined'});await CandidateActivity.create({action:'Candidate Declined Offer',candidate:offer.candidate._id,offer:offer._id,message:`Offer declined: ${input.reason}`,ipAddress:req.ip,deviceInformation:req.get('user-agent')});res.json({success:true,data:{status:offer.status,declinedAt:offer.declinedAt}})}))
router.post('/:token/upload-signed-copy',upload.single('file'),asyncHandler(async(req,res)=>{if(!req.file)throw new HttpError(422,'Upload a signed PDF or image');const offer=await findOffer(req.params.token,{signed:true});if(offer.status!=='Accepted')throw new HttpError(409,'Accept the offer before uploading a signed copy');offer.signedCopy={fileName:req.file.originalname,mimeType:req.file.mimetype,fileData:req.file.buffer};await offer.save();res.status(201).json({success:true,data:{fileName:req.file.originalname}})}))

export default router
