import mongoose from 'mongoose'
const objectId = mongoose.Schema.Types.ObjectId
const profileSchema = new mongoose.Schema({
  singletonKey:{ type:String, default:'organization', unique:true }, logo:String, companyName:{ type:String, default:'AnanTTattva Private Limited' }, legalCompanyName:String, shortName:String,
  description:{ type:String, default:'Environmental compliance, sustainability and technology services.' }, industry:{ type:String, default:'Environmental Services & Technology' }, registrationNumber:String, gstNumber:String, pan:String,
  email:String, phone:String, website:String, headOfficeAddress:String, city:{ type:String, default:'Mumbai' }, state:{ type:String, default:'Maharashtra' }, country:{ type:String, default:'India' }, pinCode:String,
  workingDays:{ type:String, default:'Monday to Friday' }, workingHours:{ type:String, default:'9:30 AM – 6:30 PM' }, timeZone:{ type:String, default:'Asia/Kolkata' }, dateFormat:{ type:String, default:'DD/MM/YYYY' }, socialLinks:mongoose.Schema.Types.Mixed, updatedBy:{ type:objectId, ref:'User' },
}, { timestamps:true, collection:'organizationProfiles' })
const contactSchema = new mongoose.Schema({ category:{ type:String, required:true }, employee:{ type:objectId, ref:'Employee' }, displayName:{ type:String, required:true }, designation:String, officialPhone:String, officialEmail:String, alternatePhone:String, availability:String, visibilityRoles:[String], displayOnHome:{ type:Boolean, default:true }, emergencyContact:{ type:Boolean, default:false }, displayOrder:{ type:Number, default:0 }, isActive:{ type:Boolean, default:true } }, { timestamps:true, collection:'organizationContacts' })
export const OrganizationProfile = mongoose.model('OrganizationProfile', profileSchema)
export const OrganizationContact = mongoose.model('OrganizationContact', contactSchema)
