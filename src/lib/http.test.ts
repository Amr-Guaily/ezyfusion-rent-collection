import { describe, expect, it } from 'vitest'
import { pgErrorCode, toErrorResponse } from './http'

// Shape of the error Prisma 7's pg adapter throws for an exclusion violation (captured from a real run).
const exclusionError = Object.assign(new Error('Invalid `tx.leases.create()` invocation'), {
  name: 'PrismaClientKnownRequestError',
  code: 'P2039',
  meta: {
    modelName: 'leases',
    driverAdapterError: { name: 'DriverAdapterError', cause: { originalCode: '23P01', kind: 'postgres', code: '23P01' } },
  },
})

describe('error mapping', () => {
  it('finds the SQLSTATE under meta.driverAdapterError, not the Prisma code', () => {
    expect(pgErrorCode(exclusionError)).toBe('23P01')
  })

  it('maps a lease overlap to 409', async () => {
    const res = toErrorResponse(exclusionError)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Overlaps another lease on this unit' })
  })

  it('maps a Prisma unique violation to 409', () => {
    expect(toErrorResponse(Object.assign(new Error('x'), { code: 'P2002' })).status).toBe(409)
  })

  it('hides unknown errors behind a generic 500', async () => {
    const res = toErrorResponse(new Error('connection string postgres://secret'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal error' })
  })
})
