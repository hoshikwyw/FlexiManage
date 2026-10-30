import { z } from 'zod'

import { fullNameSchema } from '@/features/auth/schemas/auth'

export const profileSchema = z.object({
  fullName: fullNameSchema,
})
export type ProfileInput = z.infer<typeof profileSchema>
