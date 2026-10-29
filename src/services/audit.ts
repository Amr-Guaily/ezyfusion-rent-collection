import type { Tx } from '@/lib/db/prisma'
import type { Prisma } from '@/generated/prisma/client'

export type AuditAction =
  | 'lease.created'
  | 'payment.recorded'
  | 'payment.approved'
  | 'payment.rejected'
  | 'payment.voided'

/** Appends to audit_log inside the caller's transaction (the table rejects updates and deletes). */
export async function writeAudit(
  tx: Tx,
  entry: { orgId: string; actorId: string | null; action: AuditAction; entityId: string; details: Prisma.InputJsonObject },
) {
  await tx.audit_log.create({
    data: {
      org_id: entry.orgId,
      actor_id: entry.actorId,
      action: entry.action,
      entity_id: entry.entityId,
      details: entry.details,
    },
  })
}
