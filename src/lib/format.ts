// Display formatting. Pure and locale-independent, so server and browser render
// identical strings (no hydration mismatch) whatever the viewer's locale or timezone.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** Integer sen -> its parts, e.g. 150050 -> { ringgit: '1,500', sen: '50' }. No float arithmetic. */
export function ringgitParts(sen: number): { negative: boolean; ringgit: string; sen: string } {
  if (!Number.isSafeInteger(sen)) throw new Error('Amount must be an integer number of sen')
  const digits = String(Math.abs(sen)).padStart(3, '0')
  return { negative: sen < 0, ringgit: groupThousands(digits.slice(0, -2)), sen: digits.slice(-2) }
}

/** 150050 -> 'RM 1,500.50' */
export function formatRinggit(sen: number): string {
  const parts = ringgitParts(sen)
  return `${parts.negative ? '-' : ''}RM ${parts.ringgit}.${parts.sen}`
}

/** 'YYYY-MM-DD' -> '31 Jan 2026' */
export function formatDate(date: string): string {
  const [y, m, d] = date.split('-')
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`
}

/** 'YYYY-MM' -> 'Jan 2026' */
export function formatMonth(month: string): string {
  const [y, m] = month.split('-')
  return `${MONTHS[Number(m) - 1]} ${y}`
}

/** Inclusive period, e.g. '31 Jan – 27 Feb 2026' (year shown once when shared). */
export function formatPeriod(start: string, end: string): string {
  if (start.slice(0, 4) === end.slice(0, 4)) {
    const [, sm, sd] = start.split('-')
    return `${Number(sd)} ${MONTHS[Number(sm) - 1]} – ${formatDate(end)}`
  }
  return `${formatDate(start)} – ${formatDate(end)}`
}
