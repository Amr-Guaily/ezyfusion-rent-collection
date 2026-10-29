import { NextResponse } from 'next/server'
import { z } from 'zod'

// The one place that maps errors to HTTP responses. Bodies are always
// { error: message }; stack traces and database details never reach the client.

export type DomainErrorKind =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'unprocessable'

const STATUS: Record<DomainErrorKind, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
}

export class DomainError extends Error {
  constructor(
    readonly kind: DomainErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

export const badRequest = (message: string) => new DomainError('bad_request', message)
export const unauthorized = (message = 'Not signed in') => new DomainError('unauthorized', message)
export const forbidden = (message = 'Not allowed for your role') => new DomainError('forbidden', message)
export const notFound = (message = 'Not found') => new DomainError('not_found', message)
export const conflict = (message: string) => new DomainError('conflict', message)
export const unprocessable = (message: string) => new DomainError('unprocessable', message)

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status })
}

export function errorJson(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status })
}

/**
 * Postgres SQLSTATE of a database error, however Prisma's pg driver adapter wrapped it
 * (directly, as `cause`, or under `meta.driverAdapterError`).
 */
export function pgErrorCode(error: unknown): string | undefined {
  const seen = new Set<unknown>()
  const queue: unknown[] = [error]
  while (queue.length > 0) {
    const current = queue.shift()
    if (typeof current !== 'object' || current === null || seen.has(current)) continue
    seen.add(current)
    const record = current as Record<string, unknown>
    for (const key of ['originalCode', 'code']) {
      const value = record[key]
      if (typeof value === 'string' && /^[0-9A-Z]{5}$/.test(value)) return value
    }
    const meta = record.meta as Record<string, unknown> | undefined
    queue.push(record.cause, meta?.driverAdapterError, meta)
  }
  return undefined
}

export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof DomainError) return errorJson(STATUS[error.kind], error.message)
  if (error instanceof z.ZodError) {
    const issue = error.issues[0]
    const where = issue?.path.length ? `${issue.path.join('.')}: ` : ''
    return errorJson(400, `${where}${issue?.message ?? 'Invalid input'}`)
  }
  switch (pgErrorCode(error)) {
    case '23P01':
      return errorJson(409, 'Overlaps another lease on this unit')
    case '23505':
      return errorJson(409, 'Conflicts with an existing record')
    case '40001':
    case '40P01':
      return errorJson(409, 'Concurrent update, please retry')
  }
  // Log the error class and message only: request bodies are never logged.
  console.error('Unhandled error:', error instanceof Error ? `${error.name}: ${error.message}` : String(error))
  return errorJson(500, 'Internal error')
}

type Handler<Ctx> = (req: Request, ctx: Ctx) => Promise<Response>

/** Wraps a route handler so every thrown error goes through toErrorResponse. */
export function route<Ctx>(handler: Handler<Ctx>): Handler<Ctx> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx)
    } catch (error) {
      return toErrorResponse(error)
    }
  }
}

/** Parses a JSON body with a Zod schema; malformed JSON is a 400 like any invalid input. */
export async function readJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw badRequest('Body must be valid JSON')
  }
  return schema.parse(body)
}

/** A path id that is not a UUID cannot name a record: 404, same as an unknown one. */
export function parseId(value: string): string {
  if (!z.uuid().safeParse(value).success) throw notFound()
  return value
}
