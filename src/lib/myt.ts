// The one place where the app works out "today" or converts between Malaysia
// calendar dates/wall-clock times and instants. Asia/Kuala_Lumpur is a fixed
// UTC+8 with no DST, so a constant offset is exact. Nothing here reads the
// machine's timezone: only Date.UTC, getTime() and toISOString() are used.

const MALAYSIA_OFFSET_MS = 8 * 3_600_000

function shifted(date: Date): string {
  const ms = date.getTime()
  if (Number.isNaN(ms)) throw new Error('Invalid Date')
  return new Date(ms + MALAYSIA_OFFSET_MS).toISOString() // 'YYYY-MM-DDTHH:mm:ss.sssZ' in Malaysia wall-clock
}

function isRealDate(y: number, m: number, d: number): boolean {
  const probe = new Date(Date.UTC(2000, m - 1, d))
  probe.setUTCFullYear(y)
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
}

// Milliseconds of a wall-clock time read as if it were UTC; callers subtract their offset.
function wallClockMs(y: number, mo: number, d: number, h: number, mi: number, s: number): number {
  if (!isRealDate(y, mo, d) || h > 23 || mi > 59 || s > 59) throw new Error('Not a real date and time')
  const utc = new Date(Date.UTC(2000, mo - 1, d, h, mi, s))
  utc.setUTCFullYear(y)
  return utc.getTime()
}

/** Today's calendar date in Malaysia, 'YYYY-MM-DD'. */
export function todayInMalaysia(now: Date): string {
  return shifted(now).slice(0, 10)
}

/** A Malaysia wall-clock time typed in a form ('YYYY-MM-DDTHH:mm', optionally ':ss') to an instant. */
export function parseMalaysiaLocal(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (!match) throw new Error('Expected YYYY-MM-DDTHH:mm')
  const [, y, mo, d, h, mi, s] = match
  return new Date(wallClockMs(Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s ?? 0)) - MALAYSIA_OFFSET_MS)
}

/** Display form, Malaysia time: 'YYYY-MM-DD HH:mm'. */
export function formatMalaysia(date: Date): string {
  const iso = shifted(date)
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`
}

/** API form of an instant: ISO 8601 with the Malaysia offset, e.g. '2026-03-01T00:30:00+08:00'. */
export function toMalaysiaIso(date: Date): string {
  return `${shifted(date).slice(0, 19)}+08:00`
}

/** Value for a datetime-local input, Malaysia time: 'YYYY-MM-DDTHH:mm'. */
export function toMalaysiaLocalInput(date: Date): string {
  return shifted(date).slice(0, 16)
}

/** An API instant: ISO 8601 that already passed z.iso.datetime({ offset: true }). The explicit offset makes parsing exact. */
export function parseIsoInstant(value: string): Date {
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(value)) throw new Error('Instant must carry an offset')
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('Invalid instant')
  return date
}

/** The gateway's paid_at, e.g. '2026-04-01 00:30:12 +0800', to an instant. */
export function parseGatewayPaidAt(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(value)
  if (!match) throw new Error('Expected YYYY-MM-DD HH:mm:ss +HHMM')
  const [, y, mo, d, h, mi, s, sign, oh, om] = match
  if (Number(oh) > 14 || Number(om) > 59) throw new Error('Invalid offset')
  const offsetMs = (sign === '-' ? -1 : 1) * (Number(oh) * 60 + Number(om)) * 60_000
  return new Date(wallClockMs(Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s)) - offsetMs)
}

/** A Postgres `date` read by Prisma (UTC midnight) to 'YYYY-MM-DD'. */
export function dateColumnToString(date: Date): string {
  const ms = date.getTime()
  if (Number.isNaN(ms)) throw new Error('Invalid Date')
  return date.toISOString().slice(0, 10)
}

/** 'YYYY-MM-DD' to the Date Prisma writes into a Postgres `date` column (UTC midnight). */
export function dateStringToColumn(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match || !isRealDate(Number(match[1]), Number(match[2]), Number(match[3]))) {
    throw new Error('Expected a real YYYY-MM-DD date')
  }
  return new Date(`${value}T00:00:00.000Z`) // explicit Z: parsed as UTC, never local
}
