import mongoose from 'mongoose'
const objectId = mongoose.Schema.Types.ObjectId
const profileSchema = new mongoose.Schema({
  singletonKey:{ type:String, default:'organization', unique:true }, logo:String, companyName:{ type:String, default:'Ananttattva Private Limited' }, legalCompanyName:String, shortName:String,
  description:{ type:String, default:'Environmental compliance, sustainability and technology services.' }, industry:{ type:String, default:'Environmental Services & Technology' }, registrationNumber:String, gstNumber:String, pan:String,
  email:String, phone:String, website:String, headOfficeAddress:String, city:{ type:String, default:'Mumbai' }, state:{ type:String, default:'Maharashtra' }, country:{ type:String, default:'India' }, pinCode:String,
  workingDays:{ type:String, default:'Monday to Friday' }, workingHours:{ type:String, default:'9:30 AM – 6:30 PM' }, timeZone:{ type:String, default:'Asia/Kolkata' }, dateFormat:{ type:String, default:'DD/MM/YYYY' }, socialLinks:mongoose.Schema.Types.Mixed, updatedBy:{ type:objectId, ref:'User' },
}, { timestamps:true, collection:'organizationProfiles' })
const contactSchema = new mongoose.Schema({
  category:{ type:String, required:true, trim:true },
  employee:{ type:objectId, ref:'Employee' },
  displayName:{ type:String, required:true, trim:true },
  designation:String,
  officialPhone:String,
  officialEmail:{ type:String, lowercase:true, trim:true },
  alternatePhone:String,
  availability:String,
  visibilityRoles:[String],
  displayOnHome:{ type:Boolean, default:true },
  displayOnLoginPage:{ type:Boolean, default:false },
  contactPriority:{ type:String, enum:['primary','backup'], default:'primary' },
  emergencyContact:{ type:Boolean, default:false },
  displayOrder:{ type:Number, default:0 },
  isActive:{ type:Boolean, default:true },
}, { timestamps:true, collection:'organizationContacts' })

const officeLocationSchema = new mongoose.Schema({
  name:{ type:String, required:true, trim:true },
  address:{ type:String, trim:true },
  latitude:{ type:Number, required:true, min:-90, max:90 },
  longitude:{ type:Number, required:true, min:-180, max:180 },
  allowedRadiusMeters:{ type:Number, min:10, max:10000, default:150 },
  maximumAccuracyMeters:{ type:Number, min:5, max:1000, default:100 },
  isPrimary:{ type:Boolean, default:false },
  isActive:{ type:Boolean, default:true },
  updatedBy:{ type:objectId, ref:'User' },
}, { timestamps:true, collection:'officeLocations' })

officeLocationSchema.index({ isActive:1, isPrimary:-1 })
export const OrganizationProfile = mongoose.model('OrganizationProfile', profileSchema)
export const OrganizationContact = mongoose.model('OrganizationContact', contactSchema)
export const OfficeLocation = mongoose.model('OfficeLocation', officeLocationSchema)
