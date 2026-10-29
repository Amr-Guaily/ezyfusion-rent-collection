import { describe, expect, it } from 'vitest'
import { formatDate, formatPeriod, formatRinggit } from './format'

describe('format', () => {
  it.each([
    [0, 'RM 0.00'],
    [5, 'RM 0.05'],
    [77419, 'RM 774.19'],
    [150050, 'RM 1,500.50'],
    [123456789, 'RM 1,234,567.89'],
    [-100, '-RM 1.00'],
  ])('formats %i sen as %s', (sen, text) => {
    expect(formatRinggit(sen)).toBe(text)
  })

  it('formats calendar dates without any timezone', () => {
    expect(formatDate('2026-03-01')).toBe('1 Mar 2026')
    expect(formatPeriod('2026-01-31', '2026-02-27')).toBe('31 Jan – 27 Feb 2026')
    expect(formatPeriod('2026-12-15', '2027-01-14')).toBe('15 Dec 2026 – 14 Jan 2027')
  })
})
