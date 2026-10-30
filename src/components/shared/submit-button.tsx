import { Loader2Icon } from 'lucide-react'
import type { ComponentProps } from 'react'

import { Button } from '@/components/ui/button'

interface SubmitButtonProps extends Omit<ComponentProps<typeof Button>, 'type'> {
  pending: boolean
  pendingLabel?: string
}

export function SubmitButton({
  pending,
  pendingLabel,
  children,
  disabled,
  ...props
}: SubmitButtonProps) {
  return (
    <Button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending || undefined}
      {...props}
    >
      {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  )
}
