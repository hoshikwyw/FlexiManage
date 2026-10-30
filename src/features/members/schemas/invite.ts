import { z } from 'zod'

import { emailSchema } from '@/features/auth/schemas/auth'
import { WORKSPACE_ROLES } from '@/types/database'

export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: z.enum(WORKSPACE_ROLES, { error: 'Choose a role' }),
})
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>
