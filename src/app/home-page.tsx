import { Button } from '@/components/ui/button'

export function HomePage() {
  return (
    <main className="bg-background text-foreground flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-semibold tracking-tight">FlexiManage</h1>
      <p className="text-muted-foreground max-w-md text-center">
        Configurable management for small businesses. Project scaffold is in place; features arrive
        in Phase 2.
      </p>
      <Button type="button">Get started</Button>
    </main>
  )
}
