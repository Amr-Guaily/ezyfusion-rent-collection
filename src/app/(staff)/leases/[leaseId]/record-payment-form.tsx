'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Money } from '@/components/money'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { callApi } from '@/lib/api-client'
import { parseRinggitToSen } from '@/lib/billing'
import { formatRinggit } from '@/lib/format'
import { parseMalaysiaLocal, toMalaysiaIso } from '@/lib/myt'
import { createClient } from '@/lib/supabase/browser'
import { cn } from '@/lib/utils'

const SLIP_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' }
const SLIP_MAX_BYTES = 5 * 1024 * 1024

type Method = 'cash' | 'bank_transfer'
type FieldErrors = Partial<Record<'amount' | 'receivedAt' | 'slip', string>>

export function RecordPaymentForm({
  leaseId,
  orgId,
  capSen,
  defaultReceivedAt,
  approvesImmediately,
}: {
  leaseId: string
  orgId: string
  capSen: number
  defaultReceivedAt: string // 'YYYY-MM-DDTHH:mm', Malaysia time, computed on the server
  approvesImmediately: boolean
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [method, setMethod] = useState<Method>('cash')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [pending, startTransition] = useTransition()
  const [step, setStep] = useState<string | null>(null)

  function validate(form: FormData): { amountSen: number; receivedAt: string; slip: File | null } | null {
    const next: FieldErrors = {}
    let amountSen = 0
    try {
      amountSen = parseRinggitToSen(String(form.get('amount') ?? ''))
      if (amountSen <= 0) next.amount = 'Enter an amount above RM 0.00.'
      else if (amountSen > capSen) next.amount = `At most ${formatRinggit(capSen)} can be recorded on this lease right now.`
    } catch {
      next.amount = 'Type the amount in ringgit, like 1,500 or 1500.50 (no RM, at most two decimals).'
    }
    let receivedAt = ''
    try {
      receivedAt = toMalaysiaIso(parseMalaysiaLocal(String(form.get('receivedAt') ?? '')))
    } catch {
      next.receivedAt = 'Pick the date and time the money was received.'
    }
    const file = form.get('slip')
    const slip = file instanceof File && file.size > 0 ? file : null
    if (method === 'bank_transfer') {
      if (!slip) next.slip = 'A bank transfer needs its slip: a JPEG, PNG or PDF.'
      else if (!SLIP_TYPES[slip.type]) next.slip = 'The slip must be a JPEG, PNG or PDF.'
      else if (slip.size > SLIP_MAX_BYTES) next.slip = 'The slip must be 5 MB or smaller.'
    }
    setErrors(next)
    return Object.keys(next).length === 0 ? { amountSen, receivedAt, slip } : null
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = validate(new FormData(event.currentTarget))
    if (!input) return
    startTransition(async () => {
      let slipPath: string | undefined
      if (method === 'bank_transfer' && input.slip) {
        setStep('Uploading slip…')
        slipPath = `${orgId}/${crypto.randomUUID()}.${SLIP_TYPES[input.slip.type]}`
        const { error } = await createClient()
          .storage.from('payment-slips')
          .upload(slipPath, input.slip, { contentType: input.slip.type, upsert: false })
        if (error) {
          setStep(null)
          toast.error(`The slip could not be uploaded: ${error.message}`)
          return
        }
      }
      setStep('Recording…')
      // If this fails after the upload, the server removes the unused slip.
      const result = await callApi<{ id: string; status: string }>(`/api/leases/${leaseId}/payments`, {
        method: 'POST',
        body: { amountSen: input.amountSen, method, receivedAt: input.receivedAt, ...(slipPath ? { slipPath } : {}) },
      })
      setStep(null)
      if (!result.ok) {
        toast.error(`Payment not recorded: ${result.error}`)
        return
      }
      toast.success(
        result.data.status === 'approved'
          ? `Recorded and approved ${formatRinggit(input.amountSen)}.`
          : `Recorded ${formatRinggit(input.amountSen)}. It waits for a manager’s approval.`,
      )
      formRef.current?.reset()
      setMethod('cash')
      router.refresh()
    })
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="grid gap-4 rounded-md border border-rule bg-card p-4">
      <div>
        <h2 className="text-lg font-bold">Record a payment</h2>
        <p className="text-sm text-muted-foreground">
          {capSen > 0 ? (
            <>
              Up to <Money sen={capSen} /> can be recorded.{' '}
              {approvesImmediately ? 'Your payments are approved at once.' : 'A manager approves it before it counts.'}
            </>
          ) : (
            'Nothing is left to pay on this lease, counting payments awaiting approval.'
          )}
        </p>
      </div>

      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">Method</legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['cash', 'Cash'],
              ['bank_transfer', 'Bank transfer'],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={cn(
                'flex cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-sm font-medium has-focus-visible:ring-3 has-focus-visible:ring-ring/50',
                method === value ? 'border-primary bg-primary/10 text-foreground' : 'border-input text-muted-foreground hover:bg-muted',
              )}
            >
              <input
                type="radio"
                name="method"
                value={value}
                checked={method === value}
                onChange={() => setMethod(value)}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-1.5">
        <Label htmlFor="amount">Amount in ringgit</Label>
        <Input
          id="amount"
          name="amount"
          inputMode="decimal"
          autoComplete="off"
          placeholder="1,500.00"
          className="figures"
          aria-invalid={errors.amount !== undefined}
          aria-describedby={errors.amount ? 'amount-error' : undefined}
        />
        {errors.amount && (
          <p id="amount-error" className="text-xs text-ink-overdue">
            {errors.amount}
          </p>
        )}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="receivedAt">Received (Malaysia time)</Label>
        <Input
          id="receivedAt"
          name="receivedAt"
          type="datetime-local"
          defaultValue={defaultReceivedAt}
          className="figures"
          aria-invalid={errors.receivedAt !== undefined}
          aria-describedby={errors.receivedAt ? 'receivedAt-error' : undefined}
        />
        {errors.receivedAt && (
          <p id="receivedAt-error" className="text-xs text-ink-overdue">
            {errors.receivedAt}
          </p>
        )}
      </div>

      {method === 'bank_transfer' && (
        <div className="grid gap-1.5">
          <Label htmlFor="slip">Transfer slip</Label>
          <Input
            id="slip"
            name="slip"
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            aria-invalid={errors.slip !== undefined}
            aria-describedby="slip-hint"
          />
          <p id="slip-hint" className={cn('text-xs', errors.slip ? 'text-ink-overdue' : 'text-muted-foreground')}>
            {errors.slip ?? 'JPEG, PNG or PDF, up to 5 MB.'}
          </p>
        </div>
      )}

      <Button type="submit" size="lg" disabled={pending || capSen <= 0}>
        {step ?? 'Record payment'}
      </Button>
    </form>
  )
}
