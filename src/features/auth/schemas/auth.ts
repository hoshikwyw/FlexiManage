import { z } from 'zod'

/**
 * Zod schemas for the authentication forms. Types are inferred from the
 * schemas, never written by hand.
 */
export const PASSWORD_MIN_LENGTH = 8
export const FULL_NAME_MAX_LENGTH = 100

export const emailSchema = z
  .string()
  .trim()
  .min(1, { error: 'Email is required' })
  .pipe(z.email({ error: 'Enter a valid email address' }))
  .pipe(z.string().toLowerCase())

export const passwordSchema = z
  .string()
  .min(1, { error: 'Password is required' })
  .min(PASSWORD_MIN_LENGTH, {
    error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
  })

export const fullNameSchema = z
  .string()
  .trim()
  .min(1, { error: 'Full name is required' })
  .max(FULL_NAME_MAX_LENGTH, {
    error: `Full name must be ${FULL_NAME_MAX_LENGTH} characters or fewer`,
  })

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { error: 'Password is required' }),
})
export type SignInInput = z.infer<typeof signInSchema>

export const signUpSchema = z
  .object({
    fullName: fullNameSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1, { error: 'Confirm your password' }),
  })
  .refine((values) => values.password === values.confirmPassword, {
    error: 'Passwords do not match',
    path: ['confirmPassword'],
  })
export type SignUpInput = z.infer<typeof signUpSchema>

export const requestPasswordResetSchema = z.object({
  email: emailSchema,
})
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>

export const updatePasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string().min(1, { error: 'Confirm your password' }),
  })
  .refine((values) => values.password === values.confirmPassword, {
    error: 'Passwords do not match',
    path: ['confirmPassword'],
  })
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>
