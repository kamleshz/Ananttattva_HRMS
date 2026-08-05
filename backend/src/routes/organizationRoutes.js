import { Router } from 'express'
import { z } from 'zod'
import { authenticate, authorize } from '../middleware/auth.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { HttpError } from '../utils/httpError.js'
import { OfficeLocation, OrganizationContact, OrganizationProfile } from '../models/Organization.js'

const router=Router()

function publicProfile(profile) {
  if (!profile) return null
  return {
    companyName:profile.companyName,
    shortName:profile.shortName,
    logo:profile.logo,
    description:profile.description,
    industry:profile.industry,
    email:profile.email,
    phone:profile.phone,
    website:profile.website,
    headOfficeAddress:profile.headOfficeAddress,
    city:profile.city,
    state:profile.state,
    country:profile.country,
    workingDays:profile.workingDays,
    workingHours:profile.workingHours,
    timeZone:profile.timeZone,
  }
}

router.get('/public-profile',asyncHandler(async(_req,res)=>{
  const profile=await OrganizationProfile.findOne({singletonKey:'organization'}).lean()
  res.json({success:true,data:publicProfile(profile)})
}))
router.get('/public-contacts',asyncHandler(async(_req,res)=>{
  const contacts=await OrganizationContact.find({isActive:true,displayOnLoginPage:true,category:{$regex:/^(information technology|it|it support)$/i}})
    .select('category displayName designation officialPhone officialEmail availability contactPriority displayOrder')
    .sort({displayOrder:1,contactPriority:1}).lean()
  res.json({success:true,data:contacts})
}))
router.use(authenticate)
router.get('/',asyncHandler(async(req,res)=>{const profile=await OrganizationProfile.findOneAndUpdate({singletonKey:'organization'},{$setOnInsert:{singletonKey:'organization'}},{new:true,upsert:true});const contacts=await OrganizationContact.find({isActive:true,displayOnHome:true,$or:[{visibilityRoles:{$size:0}},{visibilityRoles:req.user.role}]}).populate('employee','firstName lastName profilePhoto employeeStatus').sort({displayOrder:1});res.json({success:true,data:{profile,contacts}})}))
router.put('/',authorize('super_admin'),asyncHandler(async(req,res)=>{const profile=await OrganizationProfile.findOneAndUpdate({singletonKey:'organization'},{...req.body,singletonKey:'organization',updatedBy:req.user._id},{new:true,upsert:true,runValidators:true});res.json({success:true,data:profile})}))
router.get('/contacts/manage',authorize('super_admin'),asyncHandler(async(_req,res)=>res.json({success:true,data:await OrganizationContact.find().populate('employee','firstName lastName employeeCode').sort({displayOrder:1})})))
const contactInput=z.object({category:z.string().trim().min(1),employee:z.string().optional().or(z.literal('')),displayName:z.string().trim().min(1),designation:z.string().optional(),officialPhone:z.string().optional(),officialEmail:z.email().optional().or(z.literal('')),alternatePhone:z.string().optional(),availability:z.string().optional(),visibilityRoles:z.array(z.string()).optional(),displayOnHome:z.boolean().optional(),displayOnLoginPage:z.boolean().optional(),contactPriority:z.enum(['primary','backup']).optional(),emergencyContact:z.boolean().optional(),displayOrder:z.number().optional(),isActive:z.boolean().optional()})
router.post('/contacts',authorize('super_admin'),asyncHandler(async(req,res)=>{const input=contactInput.parse(req.body);if(!input.employee)delete input.employee;res.status(201).json({success:true,data:await OrganizationContact.create(input)})}))
router.put('/contacts/:id',authorize('super_admin'),asyncHandler(async(req,res)=>{const contact=await OrganizationContact.findByIdAndUpdate(req.params.id,req.body,{new:true,runValidators:true});if(!contact)throw new HttpError(404,'Contact not found');res.json({success:true,data:contact})}))
router.delete('/contacts/:id',authorize('super_admin'),asyncHandler(async(req,res)=>{const contact=await OrganizationContact.findByIdAndUpdate(req.params.id,{isActive:false},{new:true});if(!contact)throw new HttpError(404,'Contact not found');res.json({success:true,data:contact})}))
router.get('/office-locations',asyncHandler(async(_req,res)=>res.json({success:true,data:await OfficeLocation.find({isActive:true}).sort({isPrimary:-1,name:1})})))
router.get('/office-locations/manage',authorize('super_admin'),asyncHandler(async(_req,res)=>res.json({success:true,data:await OfficeLocation.find().sort({isPrimary:-1,name:1})})))
const officeInput=z.object({name:z.string().trim().min(2),address:z.string().trim().max(500).optional(),latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180),allowedRadiusMeters:z.number().min(10).max(10000),maximumAccuracyMeters:z.number().min(5).max(1000),isPrimary:z.boolean().optional(),isActive:z.boolean().optional()})
router.post('/office-locations',authorize('super_admin'),asyncHandler(async(req,res)=>{const input=officeInput.parse(req.body);if(input.isPrimary)await OfficeLocation.updateMany({},{$set:{isPrimary:false}});res.status(201).json({success:true,data:await OfficeLocation.create({...input,updatedBy:req.user._id})})}))
router.put('/office-locations/:id',authorize('super_admin'),asyncHandler(async(req,res)=>{const input=officeInput.partial().parse(req.body);if(input.isPrimary)await OfficeLocation.updateMany({_id:{$ne:req.params.id}},{$set:{isPrimary:false}});const office=await OfficeLocation.findByIdAndUpdate(req.params.id,{...input,updatedBy:req.user._id},{new:true,runValidators:true});if(!office)throw new HttpError(404,'Office location not found');res.json({success:true,data:office})}))
export default router
