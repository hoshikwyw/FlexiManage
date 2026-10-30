import { zodResolver } from '@hookform/resolvers/zod'
import { useId } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { FormServerError } from '@/components/shared/form-server-error'
import { FormTextField } from '@/components/shared/form-text-field'
import { SubmitButton } from '@/components/shared/submit-button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { Profile } from '@/types/database'

import { useUpdateProfile } from '../api/use-update-profile'
import { getProfileErrorMessage } from '../lib/profile-errors'
import { profileSchema, type ProfileInput } from '../schemas/profile'

export function ProfileForm({ profile }: { profile: Profile }) {
  const emailId = useId()
  const updateProfile = useUpdateProfile()
  const form = useForm<ProfileInput>({
    resolver: zodResolver(profileSchema),
    defaultValues: { fullName: profile.full_name ?? '' },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const saved = await updateProfile.mutateAsync(values)
      form.reset({ fullName: saved.full_name ?? '' })
      toast.success('Profile updated')
    } catch {
      // Rendered from `updateProfile.error`.
    }
  })

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Profile"
      className="flex max-w-md flex-col gap-5"
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={emailId}>Email</FieldLabel>
          <Input id={emailId} type="email" value={profile.email} readOnly disabled />
          <FieldDescription>Changing your email is not available yet.</FieldDescription>
        </Field>
        <FormTextField
          control={form.control}
          name="fullName"
          label="Full name"
          autoComplete="name"
          description="Shown to the people you share a workspace with."
        />
      </FieldGroup>
      <FormServerError
        message={updateProfile.error ? getProfileErrorMessage(updateProfile.error) : null}
      />
      <div>
        <SubmitButton
          pending={updateProfile.isPending}
          pendingLabel="Saving..."
          disabled={!form.formState.isDirty}
        >
          Save changes
        </SubmitButton>
      </div>
    </form>
  )
}
