import type { ReactNode } from 'react'

import { Card, CardContent, CardDescription, CardFooter, CardHeader } from '@/components/ui/card'

interface AuthCardProps {
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
}

/** Consistent card used by every page under `/auth`. */
export function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <Card className="w-full">
      <CardHeader>
        <h2
          data-slot="card-title"
          className="font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm"
        >
          {title}
        </h2>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
      {footer ? (
        <CardFooter className="text-muted-foreground justify-center text-sm">{footer}</CardFooter>
      ) : null}
    </Card>
  )
}
