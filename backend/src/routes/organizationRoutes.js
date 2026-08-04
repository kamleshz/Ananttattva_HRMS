import { Router } from 'express'
import { z } from 'zod'
import { authenticate, authorize } from '../middleware/auth.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { HttpError } from '../utils/httpError.js'
import { OrganizationContact, OrganizationProfile } from '../models/Organization.js'

const router=Router()
router.use(authenticate)
router.get('/',asyncHandler(async(req,res)=>{const profile=await OrganizationProfile.findOneAndUpdate({singletonKey:'organization'},{$setOnInsert:{singletonKey:'organization'}},{new:true,upsert:true});const contacts=await OrganizationContact.find({isActive:true,displayOnHome:true,$or:[{visibilityRoles:{$size:0}},{visibilityRoles:req.user.role}]}).sort({displayOrder:1});res.json({success:true,data:{profile,contacts}})}))
router.put('/',authorize('super_admin'),asyncHandler(async(req,res)=>{const profile=await OrganizationProfile.findOneAndUpdate({singletonKey:'organization'},{...req.body,singletonKey:'organization',updatedBy:req.user._id},{new:true,upsert:true,runValidators:true});res.json({success:true,data:profile})}))
router.get('/contacts/manage',authorize('super_admin'),asyncHandler(async(_req,res)=>res.json({success:true,data:await OrganizationContact.find().populate('employee','firstName lastName employeeCode').sort({displayOrder:1})})))
router.post('/contacts',authorize('super_admin'),asyncHandler(async(req,res)=>{const input=z.object({category:z.string().min(1),employee:z.string().optional(),displayName:z.string().min(1),designation:z.string().optional(),officialPhone:z.string().optional(),officialEmail:z.email().optional().or(z.literal('')),alternatePhone:z.string().optional(),availability:z.string().optional(),visibilityRoles:z.array(z.string()).optional(),displayOnHome:z.boolean().optional(),emergencyContact:z.boolean().optional(),displayOrder:z.number().optional(),isActive:z.boolean().optional()}).parse(req.body);res.status(201).json({success:true,data:await OrganizationContact.create(input)})}))
router.put('/contacts/:id',authorize('super_admin'),asyncHandler(async(req,res)=>{const contact=await OrganizationContact.findByIdAndUpdate(req.params.id,req.body,{new:true,runValidators:true});if(!contact)throw new HttpError(404,'Contact not found');res.json({success:true,data:contact})}))
router.delete('/contacts/:id',authorize('super_admin'),asyncHandler(async(req,res)=>{const contact=await OrganizationContact.findByIdAndUpdate(req.params.id,{isActive:false},{new:true});if(!contact)throw new HttpError(404,'Contact not found');res.json({success:true,data:contact})}))
export default router
