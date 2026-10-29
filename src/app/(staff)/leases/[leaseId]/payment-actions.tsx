'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Money } from '@/components/money'
import type { PaymentStatus } from '@/components/status-mark'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { callApi } from '@/lib/api-client'
import { formatRinggit } from '@/lib/format'

type Action = 'approve' | 'reject' | 'void'

const COPY: Record<Action, { title: string; button: string; done: string; needsReason: boolean; explain: string }> = {
  approve: {
    title: 'Approve this payment?',
    button: 'Approve payment',
    done: 'Approved',
    needsReason: false,
    explain: 'It is applied to the oldest unpaid invoices straight away. It is refused if it is now more than the lease still owes.',
  },
  reject: {
    title: 'Reject this payment?',
    button: 'Reject payment',
    done: 'Rejected',
    needsReason: true,
    explain: 'It will not count towards any invoice. The payment stays on record with your reason.',
  },
  void: {
    title: 'Void this payment?',
    button: 'Void payment',
    done: 'Voided',
    needsReason: true,
    explain: 'The invoices it paid become unpaid again. Other payments are not changed. The payment stays on record with your reason.',
  },
}

export function PaymentActions({
  paymentId,
  status,
  summary,
  amountSen,
}: {
  paymentId: string
  status: PaymentStatus
  summary: string
  amountSen: number
}) {
  const actions: Action[] = status === 'pending_verification' ? ['approve', 'reject'] : status === 'approved' ? ['void'] : []
  const [open, setOpen] = useState<Action | null>(null)
  if (actions.length === 0) return null
  return (
    <div className="flex justify-end gap-1.5">
      {actions.map((action) => (
        <Button
          key={action}
          size="sm"
          variant={action === 'approve' ? 'default' : action === 'void' ? 'destructive' : 'outline'}
          onClick={() => setOpen(action)}
        >
          {action === 'approve' ? 'Approve' : action === 'reject' ? 'Reject' : 'Void'}
        </Button>
      ))}
      {open && (
        <ConfirmDialog
          key={open}
          action={open}
          paymentId={paymentId}
          summary={summary}
          amountSen={amountSen}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}

function ConfirmDialog({
  action,
  paymentId,
  summary,
  amountSen,
  onClose,
}: {
  action: Action
  paymentId: string
  summary: string
  amountSen: number
  onClose: () => void
}) {
  const router = useRouter()
  const copy = COPY[action]
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function confirm() {
    if (copy.needsReason && reason.trim().length < 5) {
      setReasonError('Write a reason of at least 5 characters, for the audit log.')
      return
    }
    startTransition(async () => {
      const result = await callApi<{ status: string }>(`/api/payments/${paymentId}/${action}`, {
        method: 'POST',
        body: copy.needsReason ? { reason: reason.trim() } : undefined,
      })
      if (!result.ok) {
        toast.error(`${copy.button} failed: ${result.error}`)
        return
      }
      toast.success(`${copy.done} the ${formatRinggit(amountSen)} payment.`)
      onClose()
      router.refresh()
    })
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="text-left">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>
            <Money sen={amountSen} className="font-semibold text-foreground" />, {summary}. {copy.explain}
          </DialogDescription>
        </DialogHeader>
        {copy.needsReason && (
          <div className="grid gap-1.5">
            <Label htmlFor={`reason-${paymentId}`}>Reason</Label>
            <Textarea
              id={`reason-${paymentId}`}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value)
                if (reasonError) setReasonError(null)
              }}
              placeholder={action === 'void' ? 'Cheque bounced on 3 March' : 'Slip does not match the bank statement'}
              aria-invalid={reasonError !== null}
              aria-describedby={`reason-${paymentId}-hint`}
              maxLength={1000}
            />
            <p id={`reason-${paymentId}-hint`} className={reasonError ? 'text-xs text-ink-overdue' : 'text-xs text-muted-foreground'}>
              {reasonError ?? 'At least 5 characters. Saved in the audit log.'}
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant={action === 'approve' ? 'default' : 'destructive'} onClick={confirm} disabled={pending}>
            {pending ? 'Working…' : copy.button}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
