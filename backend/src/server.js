import { app } from './app.js'
import { connectDatabase } from './config/db.js'
import { seedAdmin } from './config/seed.js'
import { env } from './config/env.js'
import { startMissingCheckoutScheduler } from './services/missingCheckoutService.js'
import { startAllowanceReminderScheduler } from './services/allowanceReminderService.js'
import { startOffboardingReminderScheduler } from './services/offboardingReminderService.js'
import { startBirthdayGreetingScheduler } from './services/birthdayGreetingService.js'

let mongoState = { status: 'connecting', error: null, connectedAt: null, attempts: 0, ready: false }
const getMongoState = () => mongoState

app.set('mongoState', getMongoState)

async function bootDatabaseAndSchedulers(retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    mongoState.attempts = attempt
    try {
      await connectDatabase()
      mongoState.status = 'connected'
      mongoState.connectedAt = new Date()
      mongoState.error = null
      mongoState.ready = true
      await seedAdmin()
      startMissingCheckoutScheduler()
      startAllowanceReminderScheduler()
      startOffboardingReminderScheduler()
      startBirthdayGreetingScheduler()
      return
    } catch (error) {
      mongoState.status = attempt < retries ? 'retrying' : 'failed'
      mongoState.error = error?.message || String(error)
      mongoState.ready = false
      console.error(`[boot] MongoDB attempt ${attempt}/${retries} failed:`, mongoState.error)
      if (attempt < retries) {
        const delay = attempt * 1500
        await new Promise((res) => setTimeout(res, delay))
      } else {
        console.error('[boot] All Mongo connection attempts exhausted. API still serving HTTP (CORS + reads disabled), schedulers NOT STARTED.')
      }
    }
  }
}

async function start() {
  await new Promise((resolve, reject) => {
    try {
      const server = app.listen(env.port, () => {
        console.log(`AT Connect API listening on http://127.0.0.1:${env.port} (HTTP bound FIRST, no 502 on boot)`)
        resolve(server)
      })
      server.on('error', reject)
    } catch (err) { reject(err) }
  })
  bootDatabaseAndSchedulers(3).catch(() => {
    // error already logged
  })
}

start().catch((error) => {
  console.error('FATAL: Unable to bind HTTP server:', error?.message || error)
  process.exit(1)
})
