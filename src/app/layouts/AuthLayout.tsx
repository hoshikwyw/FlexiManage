import { Link, Outlet } from 'react-router-dom'

/** Centered single-column layout for every page under `/auth`. */
export function AuthLayout() {
  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <Link
        to="/"
        className="focus-visible:ring-ring/50 rounded-md outline-none focus-visible:ring-3"
      >
        <h1 className="text-2xl font-semibold tracking-tight">FlexiManage</h1>
      </Link>
      <main className="w-full max-w-sm">
        <Outlet />
      </main>
    </div>
  )
}
