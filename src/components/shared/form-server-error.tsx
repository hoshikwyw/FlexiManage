import { cn } from '@/lib/utils'

/**
 * Live region for errors returned by the server after submit. Always rendered
 * so assistive technology announces the message when it appears.
 */
export function FormServerError({
  message,
  className,
}: {
  message?: string | null
  className?: string
}) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        'text-destructive text-sm',
        message ? 'border-destructive/30 bg-destructive/10 rounded-lg border px-3 py-2' : 'sr-only',
        className,
      )}
    >
      {message ?? ''}
    </div>
  )
}
