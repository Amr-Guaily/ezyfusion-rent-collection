import { ringgitParts } from '@/lib/format'
import { cn } from '@/lib/utils'

/** An amount set like a passbook entry: small RM, ringgit, then sen in a lighter weight. */
export function Money({ sen, className }: { sen: number; className?: string }) {
  const parts = ringgitParts(sen)
  return (
    <span
      className={cn('figures whitespace-nowrap', className)}
      aria-label={`${parts.negative ? 'minus ' : ''}RM ${parts.ringgit}.${parts.sen}`}
    >
      <span aria-hidden className="mr-0.5 text-[0.72em] font-medium text-muted-foreground">
        {parts.negative ? '-' : ''}RM
      </span>
      <span aria-hidden>{parts.ringgit}</span>
      <span aria-hidden className="font-normal opacity-60">
        .{parts.sen}
      </span>
    </span>
  )
}
