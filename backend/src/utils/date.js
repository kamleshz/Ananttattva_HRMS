// AT Connect currently operates in India. UTC-based construction keeps these
// business dates consistent on both local machines and UTC production hosts.
export const ORGANIZATION_TIMEZONE_OFFSET_MINUTES = 330

function organizationDateParts(date = new Date()) {
  const shifted = new Date(new Date(date).getTime() + ORGANIZATION_TIMEZONE_OFFSET_MINUTES * 60_000)
  return { year:shifted.getUTCFullYear(), month:shifted.getUTCMonth(), day:shifted.getUTCDate() }
}

export function atOrganizationTime(date = new Date(), hour = 0, minute = 0, second = 0, millisecond = 0) {
  const { year,month,day } = organizationDateParts(date)
  return new Date(Date.UTC(year,month,day,hour,minute,second,millisecond) - ORGANIZATION_TIMEZONE_OFFSET_MINUTES * 60_000)
}

export function startOfLocalDay(date = new Date()) {
  return atOrganizationTime(date)
}

export function endOfLocalDay(date = new Date()) {
  return atOrganizationTime(date,23,59,59,999)
}

export function organizationMonthBounds(date = new Date()) {
  const { year,month } = organizationDateParts(date)
  const offset = ORGANIZATION_TIMEZONE_OFFSET_MINUTES * 60_000
  return {
    start:new Date(Date.UTC(year,month,1) - offset),
    end:new Date(Date.UTC(year,month + 1,1) - offset),
  }
}
