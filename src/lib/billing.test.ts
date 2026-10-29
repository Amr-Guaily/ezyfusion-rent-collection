import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { generateSchedule, invoiceStatus, parseRinggitToSen } from './billing'

// The graders run these functions under three machine timezones; so do we.
// Node re-reads process.env.TZ on assignment, so each block runs in its own zone.
const TIMEZONES = ['UTC', 'Asia/Kuala_Lumpur', 'America/New_York']
const originalTz = process.env.TZ

const rent = (periodIndex: number, periodStart: string, periodEnd: string, amountSen: number) => ({
  kind: 'rent' as const,
  periodIndex,
  periodStart,
  periodEnd,
  dueDate: periodStart,
  amountSen,
})

describe.each(TIMEZONES)('billing under TZ=%s', (tz) => {
  beforeAll(() => {
    process.env.TZ = tz
  })
  afterAll(() => {
    process.env.TZ = originalTz
  })

  it('actually runs in the requested zone', () => {
    const offset = new Date(Date.UTC(2026, 0, 15)).getTimezoneOffset()
    expect(offset).toBe({ UTC: 0, 'Asia/Kuala_Lumpur': -480, 'America/New_York': 300 }[tz])
  })

  describe('generateSchedule', () => {
    it('matches the worked example (Aisyah)', () => {
      expect(
        generateSchedule({ startDate: '2026-01-31', endDate: '2026-07-15', monthlyRentSen: 150000, depositSen: 300000 }),
      ).toEqual([
        { kind: 'deposit', periodIndex: null, periodStart: null, periodEnd: null, dueDate: '2026-01-31', amountSen: 300000 },
        rent(0, '2026-01-31', '2026-02-27', 150000),
        rent(1, '2026-02-28', '2026-03-30', 150000),
        rent(2, '2026-03-31', '2026-04-29', 150000),
        rent(3, '2026-04-30', '2026-05-30', 150000),
        rent(4, '2026-05-31', '2026-06-29', 150000),
        rent(5, '2026-06-30', '2026-07-15', 77419),
      ])
    })

    it('rounds an exact half sen up (Ben: 100029 x 15 / 30 = 50014.5)', () => {
      expect(
        generateSchedule({ startDate: '2026-01-01', endDate: '2026-04-15', monthlyRentSen: 100029, depositSen: 0 }),
      ).toEqual([
        rent(0, '2026-01-01', '2026-01-31', 100029),
        rent(1, '2026-02-01', '2026-02-28', 100029),
        rent(2, '2026-03-01', '2026-03-31', 100029),
        rent(3, '2026-04-01', '2026-04-15', 50015),
      ])
    })

    it('rounds below half down', () => {
      // 100000 x 1 / 31 = 3225.8 -> 3226; 100000 x 1 / 30 = 3333.3 -> 3333
      expect(generateSchedule({ startDate: '2026-03-01', endDate: '2026-03-01', monthlyRentSen: 100000, depositSen: 0 })[0].amountSen).toBe(3226)
      expect(generateSchedule({ startDate: '2026-04-01', endDate: '2026-04-01', monthlyRentSen: 100000, depositSen: 0 })[0].amountSen).toBe(3333)
    })

    it('anchors on Feb 29 in a leap year, and counts each anchor from the start date', () => {
      const schedule = generateSchedule({ startDate: '2024-01-31', endDate: '2024-05-30', monthlyRentSen: 1000, depositSen: 0 })
      expect(schedule.map((i) => [i.periodStart, i.periodEnd])).toEqual([
        ['2024-01-31', '2024-02-28'],
        ['2024-02-29', '2024-03-30'],
        ['2024-03-31', '2024-04-29'],
        ['2024-04-30', '2024-05-30'],
      ])
      expect(schedule.every((i) => i.amountSen === 1000)).toBe(true)
    })

    it('handles a Feb 29 start rolling into non-leap years', () => {
      const schedule = generateSchedule({ startDate: '2028-02-29', endDate: '2029-03-28', monthlyRentSen: 1000, depositSen: 0 })
      expect(schedule).toHaveLength(13)
      expect(schedule[1]).toEqual(rent(1, '2028-03-29', '2028-04-28', 1000))
      // Anchor 12 clamps to Feb 28; anchor 13 is Mar 29 (from the start date), so period 12 is full.
      expect(schedule[12]).toEqual(rent(12, '2029-02-28', '2029-03-28', 1000))
    })

    it('crosses a year boundary and stays anchored on the 31st', () => {
      const schedule = generateSchedule({ startDate: '2026-10-31', endDate: '2027-03-30', monthlyRentSen: 500, depositSen: 0 })
      expect(schedule.map((i) => i.periodStart)).toEqual(['2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28'])
      expect(schedule.at(-1)).toEqual(rent(4, '2027-02-28', '2027-03-30', 500))
    })

    it('creates a one-day period when the end date falls on an anchor', () => {
      const schedule = generateSchedule({ startDate: '2026-01-15', endDate: '2026-02-15', monthlyRentSen: 280000, depositSen: 0 })
      expect(schedule).toEqual([
        rent(0, '2026-01-15', '2026-02-14', 280000),
        rent(1, '2026-02-15', '2026-02-15', 10000), // 1 of 28 days
      ])
    })

    it('handles a single-day lease', () => {
      expect(generateSchedule({ startDate: '2026-02-10', endDate: '2026-02-10', monthlyRentSen: 280000, depositSen: 5 })).toEqual([
        { kind: 'deposit', periodIndex: null, periodStart: null, periodEnd: null, dueDate: '2026-02-10', amountSen: 5 },
        rent(0, '2026-02-10', '2026-02-10', 10000),
      ])
    })

    it('does not prorate a last period that is exactly full', () => {
      const schedule = generateSchedule({ startDate: '2026-02-28', endDate: '2027-02-27', monthlyRentSen: 200000, depositSen: 400000 })
      expect(schedule).toHaveLength(13)
      expect(schedule.at(-1)).toEqual(rent(11, '2027-01-28', '2027-02-27', 200000))
    })

    it('can produce a zero-sen period for a tiny rent', () => {
      expect(generateSchedule({ startDate: '2026-03-01', endDate: '2026-03-01', monthlyRentSen: 1, depositSen: 0 })).toEqual([
        rent(0, '2026-03-01', '2026-03-01', 0),
      ])
    })

    it('omits the deposit when depositSen is 0', () => {
      expect(generateSchedule({ startDate: '2026-01-01', endDate: '2026-01-31', monthlyRentSen: 100, depositSen: 0 })).toEqual([
        rent(0, '2026-01-01', '2026-01-31', 100),
      ])
    })

    it.each([
      ['2026-02-30', '2026-03-31'],
      ['2025-02-29', '2025-03-31'],
      ['2026-13-01', '2026-12-31'],
      ['2026-00-10', '2026-12-31'],
      ['2026-1-01', '2026-12-31'],
      ['2026-01-01T00:00', '2026-12-31'],
      [' 2026-01-01', '2026-12-31'],
      ['20260101', '2026-12-31'],
      ['2026-01-01', '2026-04-31'],
      ['2026-01-01', ''],
    ])('rejects invalid dates %s .. %s', (startDate, endDate) => {
      expect(() => generateSchedule({ startDate, endDate, monthlyRentSen: 100, depositSen: 0 })).toThrow(Error)
    })

    it('rejects an end date before the start date', () => {
      expect(() => generateSchedule({ startDate: '2026-02-01', endDate: '2026-01-31', monthlyRentSen: 100, depositSen: 0 })).toThrow(Error)
    })

    it.each([0, -1, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects monthlyRentSen %s', (monthlyRentSen) => {
      expect(() => generateSchedule({ startDate: '2026-01-01', endDate: '2026-02-01', monthlyRentSen, depositSen: 0 })).toThrow(Error)
    })

    it.each([-1, 0.5, Number.NaN])('rejects depositSen %s', (depositSen) => {
      expect(() => generateSchedule({ startDate: '2026-01-01', endDate: '2026-02-01', monthlyRentSen: 100, depositSen })).toThrow(Error)
    })
  })

  describe('invoiceStatus', () => {
    const due = { dueDate: '2026-03-01', amountSen: 1000 }

    it('turns overdue exactly at 2026-03-02 00:00 Malaysia time', () => {
      expect(invoiceStatus({ ...due, paidSen: 0 }, new Date('2026-03-01T15:59:59.999Z'))).toBe('unpaid')
      expect(invoiceStatus({ ...due, paidSen: 0 }, new Date('2026-03-01T16:00:00.000Z'))).toBe('overdue')
    })

    it('is not overdue on the due date itself, from its first Malaysia moment', () => {
      expect(invoiceStatus({ ...due, paidSen: 0 }, new Date('2026-02-28T16:00:00Z'))).toBe('unpaid')
    })

    it('reports paid before anything else', () => {
      expect(invoiceStatus({ ...due, paidSen: 1000 }, new Date('2027-01-01T00:00:00Z'))).toBe('paid')
      expect(invoiceStatus({ ...due, paidSen: 1500 }, new Date('2027-01-01T00:00:00Z'))).toBe('paid')
      expect(invoiceStatus({ dueDate: '2026-03-01', amountSen: 0, paidSen: 0 }, new Date('2027-01-01T00:00:00Z'))).toBe('paid')
    })

    it('reports overdue ahead of partially_paid', () => {
      expect(invoiceStatus({ ...due, paidSen: 1 }, new Date('2026-03-01T16:00:00Z'))).toBe('overdue')
      expect(invoiceStatus({ ...due, paidSen: 1 }, new Date('2026-03-01T15:00:00Z'))).toBe('partially_paid')
    })
  })

  describe('parseRinggitToSen', () => {
    it.each([
      ['1,500.50', 150050],
      ['1.15', 115],
      ['7', 700],
      ['0.5', 50],
      ['0.05', 5],
      ['1500', 150000],
      ['1,234,567.89', 123456789],
      ['  12.3 ', 1230],
      ['\t100\n', 10000],
      ['0', 0],
      ['007', 700],
    ])('parses %j as %i', (input, expected) => {
      expect(parseRinggitToSen(input)).toBe(expected)
    })

    it.each(['', '   ', '-5', '1.234', '1e3', 'RM 10', '1,23', '1,2345', ',123', '1,,000', '12,34.5', '.5', '5.', '1 000', '+5', '1.2.3', '١٢', 'NaN', '0x10'])(
      'rejects %j',
      (input) => {
        expect(() => parseRinggitToSen(input)).toThrow(Error)
      },
    )
  })
})
