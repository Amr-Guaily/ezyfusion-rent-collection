import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  dateColumnToString,
  dateStringToColumn,
  formatMalaysia,
  parseGatewayPaidAt,
  parseMalaysiaLocal,
  toMalaysiaIso,
  toMalaysiaLocalInput,
  todayInMalaysia,
} from './myt'

const originalTz = process.env.TZ

describe.each(['UTC', 'Asia/Kuala_Lumpur', 'America/New_York'])('myt under TZ=%s', (tz) => {
  beforeAll(() => {
    process.env.TZ = tz
  })
  afterAll(() => {
    process.env.TZ = originalTz
  })

  it('todayInMalaysia rolls over at 16:00Z', () => {
    expect(todayInMalaysia(new Date('2026-03-01T15:59:59.999Z'))).toBe('2026-03-01')
    expect(todayInMalaysia(new Date('2026-03-01T16:00:00.000Z'))).toBe('2026-03-02')
  })

  it('parses Malaysia wall-clock input as +08:00', () => {
    // Seed payment: received 2026-03-01 00:30 Malaysia time, which is still February in UTC.
    expect(parseMalaysiaLocal('2026-03-01T00:30').toISOString()).toBe('2026-02-28T16:30:00.000Z')
    expect(parseMalaysiaLocal('2026-01-31T10:00:15').toISOString()).toBe('2026-01-31T02:00:15.000Z')
  })

  it.each(['2026-02-30T10:00', '2026-03-01 00:30', '2026-03-01T24:00', '2026-03-01T10:60', '2026-03-01T10:00Z', ''])(
    'rejects local input %j',
    (value) => {
      expect(() => parseMalaysiaLocal(value)).toThrow(Error)
    },
  )

  it('formats instants in Malaysia time', () => {
    const instant = new Date('2026-02-28T16:30:00Z')
    expect(formatMalaysia(instant)).toBe('2026-03-01 00:30')
    expect(toMalaysiaIso(instant)).toBe('2026-03-01T00:30:00+08:00')
    expect(toMalaysiaLocalInput(instant)).toBe('2026-03-01T00:30')
    expect(new Date(toMalaysiaIso(instant)).getTime()).toBe(instant.getTime())
  })

  it('parses the gateway paid_at with its offset', () => {
    expect(parseGatewayPaidAt('2026-04-01 00:30:12 +0800').toISOString()).toBe('2026-03-31T16:30:12.000Z')
    expect(parseGatewayPaidAt('2026-04-01 00:30:12 +0000').toISOString()).toBe('2026-04-01T00:30:12.000Z')
    expect(parseGatewayPaidAt('2026-04-01 00:30:12 -0530').toISOString()).toBe('2026-04-01T06:00:12.000Z')
  })

  it.each(['2026-04-01T00:30:12+08:00', '2026-04-01 00:30:12', '2026-02-30 00:30:12 +0800', '2026-04-01 00:30:12 +08:00'])(
    'rejects paid_at %j',
    (value) => {
      expect(() => parseGatewayPaidAt(value)).toThrow(Error)
    },
  )

  it('round-trips date columns without shifting a day', () => {
    expect(dateColumnToString(dateStringToColumn('2026-01-31'))).toBe('2026-01-31')
    expect(dateStringToColumn('2024-02-29').toISOString()).toBe('2024-02-29T00:00:00.000Z')
    expect(() => dateStringToColumn('2025-02-29')).toThrow(Error)
  })
})
