/**
 * POST /functions/v1/change-plan            (operators only: service-role key, for now)
 *
 * Body:     { workspaceId: uuid, plan: 'free' | 'pro' | 'business' | <any active plan key> }
 * Success:  200 { data: { workspaceId, from, to, changed, overLimit } }
 *             changed    false when the workspace already was on `plan` with status active
 *                        (no write, no audit row)
 *             overLimit  resources whose enforced usage is above the new plan's limit, e.g.
 *                        ['modules'] after a downgrade. Nothing is deleted (rule 9): the
 *                        workspace keeps its data and only new inserts of those resources are
 *                        refused with 402 plan_limit_exceeded (contract C6).
 * Errors:   401 unauthorized (no bearer), 403 forbidden (bearer is not the service-role key,
 *           e.g. a user JWT), 400 validation_error (malformed body, unknown or inactive plan),
 *           404 not_found (no such workspace), 500 internal.
 *
 * Thin wrapper around `public.change_workspace_plan(p_workspace_id, p_plan_key, p_actor_id)`
 * (migration 007, executable by service_role only). In one transaction it takes the
 * workspace's entitlement locks, sets the subscription to the plan with status `active`
 * (provider `manual`; billing provider integration waits for decision D3) and reports the
 * over-limit resources. The `subscriptions_audit` trigger writes `subscription.plan_changed`
 * `{ from, to }` (and `subscription.status_changed` when a canceled or past_due subscription is
 * reactivated) with `p_actor_id` as actor; this function therefore does not call writeAudit
 * (no double logging). Operators without the platform admin web call it with the service-role
 * key (docs/operations.md, "Changing a workspace's plan").
 */
import { z } from 'zod'
import { adminClient, requireServiceRole } from '../_shared/auth.ts'
import { AppError, jsonOk } from '../_shared/errors.ts'
import { createHandler } from '../_shared/handler.ts'
import { parseBody } from '../_shared/validation.ts'

const bodySchema = z
  .object({
    // z.guid(): see invite-member (fixed seed ids are not RFC 4122 v4).
    workspaceId: z.guid(),
    plan: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z][a-z0-9_]{1,31}$/),
  })
  .strict()

interface ChangePlanRow {
  workspace_id: string
  from_plan: string
  to_plan: string
  changed: boolean
  over_limit: string[]
}

Deno.serve(
  createHandler(['POST'], async (req, { cors }) => {
    // TODO(Part 18c, platform admin web): accept a platform admin's user JWT as well:
    //   const { user } = await requireUser(req); await requirePlatformAdmin(admin, user.id)
    // and pass `p_actor_id: user.id` below so the audit row names the admin. Until then only the
    // service-role key (operators, CI) may call this function and the actor is null.
    requireServiceRole(req)
    const actorId: string | null = null

    const body = await parseBody(req, bodySchema)
    const admin = adminClient()

    const { data, error } = await admin
      .rpc('change_workspace_plan', {
        p_workspace_id: body.workspaceId,
        p_plan_key: body.plan,
        p_actor_id: actorId,
      })
      .single<ChangePlanRow>()

    if (error) {
      if (error.code === '22023') {
        throw new AppError(400, 'validation_error', 'Unknown or inactive plan', {
          fieldErrors: { plan: ['Unknown or inactive plan'] },
        })
      }
      if (error.code === 'PT404') {
        throw new AppError(404, 'not_found', 'Workspace not found')
      }
      console.error('[change-plan] rpc failed', error.code, error.message)
      throw new AppError(500, 'internal', 'Could not change the plan')
    }

    return jsonOk(
      {
        workspaceId: data.workspace_id,
        from: data.from_plan,
        to: data.to_plan,
        changed: data.changed,
        overLimit: data.over_limit,
      },
      cors,
    )
  }),
)
