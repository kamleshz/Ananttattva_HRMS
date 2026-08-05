import bcrypt from 'bcryptjs'
import { User } from '../models/User.js'
import { Employee } from '../models/Employee.js'
import { env } from './env.js'
import { OrganizationProfile } from '../models/Organization.js'

export async function seedAdmin() {
  if (!await User.exists({ email: env.seedEmail })) {
    const passwordHash = await bcrypt.hash(env.seedPassword, 12)
    const user = await User.create({ firstName:'Kamlesh', lastName:'Zade', email:env.seedEmail, passwordHash, role:'super_admin' })
    const employee = await Employee.create({ employeeCode:'EMP0001', firstName:'Kamlesh', lastName:'Zade', officialEmail:env.seedEmail, department:'Product & Technology', designation:'Administrator', user:user._id })
    user.employee=employee._id; await user.save()
    console.log(`Seeded admin account: ${env.seedEmail}`)
  }
  await OrganizationProfile.updateMany({companyName:{$in:['PeoplePulse','AnanTTattva Private Limited','AnanTTattva Attandance System']}},{$set:{companyName:'Ananttattva Private Limited',shortName:'AT Connect'}})
}
