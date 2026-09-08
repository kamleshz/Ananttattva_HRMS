import { Holiday } from '../models/Holiday.js'
import { atOrganizationTime, ORGANIZATION_TIMEZONE_OFFSET_MINUTES } from '../utils/date.js'

export function organizationDateKey(value = new Date()) {
  return new Date(new Date(value).getTime() + ORGANIZATION_TIMEZONE_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10)
}

export function dateFromKey(key, hour = 0, minute = 0) {
  const [year, month, day] = String(key).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - ORGANIZATION_TIMEZONE_OFFSET_MINUTES * 60_000)
}

export function isScheduledWorkingDay(value, holidayKeys = new Set()) {
  const key = organizationDateKey(value)
  if (holidayKeys.has(key)) return false
  const [year, month, day] = key.split('-').map(Number)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  if (weekday === 0) return false
  if (weekday !== 6) return true
  return [2, 4, 5].includes(Math.ceil(day / 7))
}

export async function holidayKeysBetween(start, end) {
  const holidays = await Holiday.find({ date: { $gte: start, $lte: end } }).select('date -_id').lean()
  return new Set(holidays.map(item => organizationDateKey(item.date)))
}

export function organizationTimeForKey(key, hour = 18, minute = 30) {
  return atOrganizationTime(dateFromKey(key, 12), hour, minute)
}
