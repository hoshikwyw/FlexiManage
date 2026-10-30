import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

import { Toaster } from '@/components/ui/sonner'
import { useAuthStateSync } from '@/features/auth/api/use-auth-state-sync'

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  })
}

/** Mirrors Supabase auth events into the query cache. Rendered once. */
function AuthStateSync() {
  useAuthStateSync()
  return null
}

export function AppProviders({ children }: { children: ReactNode }) {
  // Lazily create one client per app instance so tests and HMR do not share cache.
  const [queryClient] = useState(createQueryClient)

  return (
    <QueryClientProvider client={queryClient}>
      <AuthStateSync />
      {children}
      <Toaster position="top-right" richColors closeButton />
    </QueryClientProvider>
  )
}
