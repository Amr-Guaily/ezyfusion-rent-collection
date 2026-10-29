import { Skeleton } from '@/components/ui/skeleton'

export default function StaffLoading() {
  return (
    <div className="grid gap-6" role="status" aria-label="Loading">
      <Skeleton className="h-9 w-2/3 max-w-md" />
      <Skeleton className="h-4 w-1/2 max-w-sm" />
      <div className="grid gap-2 pt-4">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full max-w-2xl" />
        ))}
      </div>
    </div>
  )
}
