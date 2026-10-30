import { createBrowserRouter } from 'react-router-dom'

import { HomePage } from '@/app/home-page'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <HomePage />,
  },
])
