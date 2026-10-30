import { Link } from 'react-router-dom'

import { buttonVariants } from '@/components/ui/button'

export function NotFoundPage() {
  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-muted-foreground text-sm font-medium">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-muted-foreground max-w-sm text-sm">
        The page you are looking for does not exist or has moved.
      </p>
      <Link to="/" className={buttonVariants()}>
        Go to dashboard
      </Link>
    </div>
  )
}
