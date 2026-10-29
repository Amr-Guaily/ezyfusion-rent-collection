import { createHmac, timingSafeEqual } from 'node:crypto'

// Brief section 5: every field except x_signature, sorted by key (character
// code order), each written as key + value, joined with '|', HMAC-SHA256, hex.
export function signatureSource(fields: Record<string, string>): string {
  return Object.keys(fields)
    .filter((key) => key !== 'x_signature')
    .sort()
    .map((key) => `${key}${fields[key]}`)
    .join('|')
}

export function computeSignature(fields: Record<string, string>, key: string): string {
  return createHmac('sha256', key).update(signatureSource(fields), 'utf8').digest('hex')
}

/** Constant-time check of fields.x_signature. False for a missing or malformed signature. */
export function verifySignature(fields: Record<string, string>, key: string): boolean {
  const provided = fields.x_signature
  if (typeof provided !== 'string' || !/^[0-9a-f]{64}$/.test(provided)) return false
  const expected = Buffer.from(computeSignature(fields, key), 'hex')
  return timingSafeEqual(expected, Buffer.from(provided, 'hex'))
}
