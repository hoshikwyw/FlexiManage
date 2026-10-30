import { Loader2Icon } from 'lucide-react'

export function FullPageSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className="bg-background text-muted-foreground flex min-h-screen items-center justify-center"
    >
      <Loader2Icon className="size-6 animate-spin" aria-hidden="true" />
    </div>
  )
}
