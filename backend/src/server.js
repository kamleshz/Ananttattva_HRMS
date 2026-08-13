import { app } from './app.js'
import { connectDatabase } from './config/db.js'
import { seedAdmin } from './config/seed.js'
import { env } from './config/env.js'
import { startMissingCheckoutScheduler } from './services/missingCheckoutService.js'
import { startAllowanceReminderScheduler } from './services/allowanceReminderService.js'
import { startOffboardingReminderScheduler } from './services/offboardingReminderService.js'

async function start() {
  await connectDatabase()
  await seedAdmin()
  startMissingCheckoutScheduler()
  startAllowanceReminderScheduler()
  startOffboardingReminderScheduler()
  app.listen(env.port, () => console.log(`AT Connect API listening on http://127.0.0.1:${env.port}`))
}

start().catch((error) => { console.error('Unable to start API:', error.message); process.exit(1) })
