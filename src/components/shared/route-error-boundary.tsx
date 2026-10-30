import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom'

import { Button, buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

/**
 * Route-level error boundary (`errorElement`). React Router hands it render
 * errors, loader errors and thrown responses for the subtree it is attached to.
 */
export function RouteErrorBoundary() {
  const error = useRouteError()
  const { title, description } = describeError(error)

  if (import.meta.env.DEV) {
    console.error(error)
  }

  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md" role="alert">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {import.meta.env.DEV && error instanceof Error ? (
          <CardContent>
            <pre className="bg-muted text-muted-foreground max-h-48 overflow-auto rounded-md p-3 text-xs">
              {error.stack ?? error.message}
            </pre>
          </CardContent>
        ) : null}
        <CardFooter className="gap-2">
          <Button type="button" onClick={() => window.location.reload()}>
            Try again
          </Button>
          <Link to="/" className={buttonVariants({ variant: 'outline' })}>
            Go to dashboard
          </Link>
        </CardFooter>
      </Card>
    </div>
  )
}

function describeError(error: unknown): { title: string; description: string } {
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      return { title: 'Page not found', description: 'The page you asked for does not exist.' }
    }
    return {
      title: `Error ${error.status}`,
      description: error.statusText || 'The request could not be completed.',
    }
  }
  return {
    title: 'Something went wrong',
    description: 'An unexpected error occurred. Reload the page or go back to the dashboard.',
  }
}
