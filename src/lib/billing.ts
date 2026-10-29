// Pure billing rules (brief section 3). No I/O, no framework imports, and no
// dependence on the machine's timezone: every date is handled as a civil
// (year, month, day) triple or as an integer day number, never via local getters.

export type InvoiceKind = 'deposit' | 'rent'

export interface ScheduledInvoice {
  kind: InvoiceKind
  periodIndex: number | null // 0, 1, 2... for rent; null for the deposit
  periodStart: string | null // 'YYYY-MM-DD'; null for the deposit
  periodEnd: string | null // 'YYYY-MM-DD', inclusive; null for the deposit
  dueDate: string // 'YYYY-MM-DD'
  amountSen: number // integer
}

export type InvoiceStatus = 'paid' | 'partially_paid' | 'unpaid' | 'overdue'

interface CivilDate {
  y: number
  m: number // 1-12
  d: number // 1-31
}

const MS_PER_DAY = 86_400_000
const MALAYSIA_OFFSET_MS = 8 * 3_600_000 // Asia/Kuala_Lumpur is UTC+8 with no DST

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31
}

function parseCivilDate(value: unknown, label: string): CivilDate {
  if (typeof value !== 'string') throw new Error(`${label} must be a YYYY-MM-DD string`)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error(`${label} must be written as YYYY-MM-DD`)
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) {
    throw new Error(`${label} is not a real calendar date`)
  }
  return { y, m, d }
}

// Days since 1970-01-01 for a proleptic Gregorian date (H. Hinnant's days_from_civil).
function toDayNumber({ y, m, d }: CivilDate): number {
  const yy = m <= 2 ? y - 1 : y
  const era = Math.floor(yy / 400)
  const yoe = yy - era * 400
  const mp = (m + 9) % 12
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146_097 + doe - 719_468
}

function fromDayNumber(days: number): CivilDate {
  const z = days + 719_468
  const era = Math.floor(z / 146_097)
  const doe = z - era * 146_097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp < 10 ? mp + 3 : mp - 9
  return { y: era * 400 + yoe + (m <= 2 ? 1 : 0), m, d }
}

function formatCivilDate({ y, m, d }: CivilDate): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// Start date plus k calendar months, clamped to the target month's last day.
// Always counted from the start date, never from the previous anchor.
function anchorDay(start: CivilDate, k: number): number {
  const monthIndex = start.m - 1 + k
  const y = start.y + Math.floor(monthIndex / 12)
  const m = (monthIndex % 12) + 1
  return toDayNumber({ y, m, d: Math.min(start.d, daysInMonth(y, m)) })
}

// round(amount * numerator / denominator), half up, in exact integer arithmetic.
function prorateHalfUp(amountSen: number, numerator: number, denominator: number): number {
  const scaled = BigInt(amountSen) * BigInt(numerator) * 2n + BigInt(denominator)
  return Number(scaled / (BigInt(denominator) * 2n))
}

export function generateSchedule(lease: {
  startDate: string
  endDate: string
  monthlyRentSen: number
  depositSen: number
}): ScheduledInvoice[] {
  const start = parseCivilDate(lease.startDate, 'startDate')
  const end = parseCivilDate(lease.endDate, 'endDate')
  const startDay = toDayNumber(start)
  const endDay = toDayNumber(end)
  if (endDay < startDay) throw new Error('endDate is before startDate')
  if (!Number.isSafeInteger(lease.monthlyRentSen) || lease.monthlyRentSen <= 0) {
    throw new Error('monthlyRentSen must be a positive integer')
  }
  if (!Number.isSafeInteger(lease.depositSen) || lease.depositSen < 0) {
    throw new Error('depositSen must be a non-negative integer')
  }

  const invoices: ScheduledInvoice[] = []
  if (lease.depositSen > 0) {
    invoices.push({
      kind: 'deposit',
      periodIndex: null,
      periodStart: null,
      periodEnd: null,
      dueDate: formatCivilDate(start),
      amountSen: lease.depositSen,
    })
  }

  for (let k = 0; ; k++) {
    const periodStartDay = anchorDay(start, k)
    if (periodStartDay > endDay) break
    const nextAnchorDay = anchorDay(start, k + 1)
    const fullDays = nextAnchorDay - periodStartDay
    const periodEndDay = Math.min(nextAnchorDay - 1, endDay)
    const usedDays = periodEndDay - periodStartDay + 1
    const periodStart = formatCivilDate(fromDayNumber(periodStartDay))
    invoices.push({
      kind: 'rent',
      periodIndex: k,
      periodStart,
      periodEnd: formatCivilDate(fromDayNumber(periodEndDay)),
      dueDate: periodStart,
      amountSen:
        usedDays === fullDays ? lease.monthlyRentSen : prorateHalfUp(lease.monthlyRentSen, usedDays, fullDays),
    })
  }
  return invoices
}

export function invoiceStatus(
  invoice: { dueDate: string; amountSen: number; paidSen: number },
  now: Date,
): InvoiceStatus {
  if (invoice.paidSen >= invoice.amountSen) return 'paid'
  const nowMs = now.getTime()
  if (Number.isNaN(nowMs)) throw new Error('now is not a valid Date')
  const dueDay = toDayNumber(parseCivilDate(invoice.dueDate, 'dueDate'))
  const todayInMalaysia = Math.floor((nowMs + MALAYSIA_OFFSET_MS) / MS_PER_DAY)
  if (todayInMalaysia > dueDay) return 'overdue'
  if (invoice.paidSen > 0) return 'partially_paid'
  return 'unpaid'
}

// Digits with optional comma thousands separators (groups of exactly three)
// and an optional one- or two-digit decimal part.
const RINGGIT_PATTERN = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/

export function parseRinggitToSen(input: string): number {
  if (typeof input !== 'string') throw new Error('Amount must be a string')
  const match = RINGGIT_PATTERN.exec(input.trim())
  if (!match) throw new Error(`Invalid ringgit amount: "${input}"`)
  const ringgit = BigInt(match[1].replaceAll(',', ''))
  const sen = BigInt((match[2] ?? '').padEnd(2, '0'))
  const total = ringgit * 100n + sen
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount is too large')
  return Number(total)
}
