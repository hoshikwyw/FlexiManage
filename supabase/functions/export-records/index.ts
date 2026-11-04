/**
 * POST /functions/v1/export-records                                     (story B5)
 *
 * Body:     { workspaceId: uuid, moduleId: uuid, search?: string (<= 200),
 *             filters?: RecordFilter[] (<= 50) }
 *           RecordFilter is the frontend's shape (src/features/records/types.ts):
 *             { kind: 'text', key, value }                 text field, contains (case-insensitive)
 *             { kind: 'options', key, values: string[] }   select field, any of the values
 *             { kind: 'boolean', key, value: boolean }     checkbox field
 *             { kind: 'number-range', key, min, max }      number / currency field (null = open)
 *             { kind: 'date-range', key, min, max }        date field, 'YYYY-MM-DD' or null
 * Success:  200 text/csv; charset=utf-8, Content-Disposition: attachment;
 *           filename="<module-slug>-YYYY-MM-DD.csv" (UTC date). Body: UTF-8 BOM, header
 *           `Title,Record status,<field labels in position order>,Created at,Updated at`,
 *           one CRLF-terminated row per record ordered by created_at, id.
 * Errors:   401 unauthorized; 400 validation_error (body, unknown filter key, filter kind that
 *           does not match the field type); 403 forbidden (member role, non-member, unknown
 *           workspace, or a module that is not in the workspace: one body for all);
 *           413 export_too_large (more than 50,000 matching rows; filter first); 500 internal.
 *
 * Order (agent rule): verify JWT -> validate body -> owner/admin role (service role lookup) ->
 * module in workspace (caller's client, RLS) -> filter keys against the module's fields ->
 * count -> read pages of 1000 with the caller's client (RLS applies; workspace_id and
 * module_id bound in every query) -> CSV -> audit `records.exported` -> respond. No audit row
 * and no CSV when any step fails. The audit metadata holds no record content.
 */
import { z } from 'zod'
import { adminClient, requireUser, requireWorkspaceRole } from '../_shared/auth.ts'
import { writeAudit } from '../_shared/audit.ts'
import { buildCsv, type CsvField, type CsvRecord, exportFileName } from '../_shared/csv.ts'
import { AppError } from '../_shared/errors.ts'
import { createHandler } from '../_shared/handler.ts'
import { parseBody } from '../_shared/validation.ts'

/** Safety cap (B5 hypothesis: the Business record ceiling). Not an entitlement. */
const EXPORT_ROW_LIMIT = 50_000
/** PostgREST page size; equals `max_rows` in config.toml. */
const PAGE_SIZE = 1000

const fieldKey = z.string().regex(/^[a-z][a-z0-9_]{0,49}$/)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const finite = z.number().refine(Number.isFinite, 'Expected a finite number')

const filterSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), key: fieldKey, value: z.string().min(1).max(200) }),
  z.object({
    kind: z.literal('options'),
    key: fieldKey,
    values: z.array(z.string().min(1).max(100)).min(1).max(100),
  }),
  z.object({ kind: z.literal('boolean'), key: fieldKey, value: z.boolean() }),
  z.object({
    kind: z.literal('number-range'),
    key: fieldKey,
    min: finite.nullable(),
    max: finite.nullable(),
  }),
  z.object({
    kind: z.literal('date-range'),
    key: fieldKey,
    min: isoDate.nullable(),
    max: isoDate.nullable(),
  }),
])

type RecordFilter = z.output<typeof filterSchema>

const bodySchema = z.object({
  // z.guid(): the fixed seed ids are not RFC 4122 v4 (see invite-member).
  workspaceId: z.guid(),
  moduleId: z.guid(),
  search: z.string().max(200).optional(),
  filters: z.array(filterSchema).max(50).optional(),
})

/** Filter kind each field type accepts (the frontend registry's `filterKind`). */
const FILTER_KIND_BY_TYPE: Record<CsvField['type'], RecordFilter['kind']> = {
  text: 'text',
  select: 'options',
  checkbox: 'boolean',
  number: 'number-range',
  currency: 'number-range',
  date: 'date-range',
}

const FORBIDDEN_MESSAGE = 'You do not have permission to do this in that workspace'

// --- Query building: the same rules as src/features/records/lib/records-filters.ts ----------

const MAX_SEARCH_WORDS = 8
const WORD = /[\p{L}\p{M}\p{N}]+/gu

function buildPrefixTsQuery(term: string): string | null {
  const words = term.normalize('NFC').toLowerCase().match(WORD) ?? []
  const unique = [...new Set(words)].slice(0, MAX_SEARCH_WORDS)
  return unique.length > 0 ? unique.map((word) => `${word}:*`).join(' & ') : null
}

function containsPattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

function path(key: string, asText: boolean): string {
  return `custom_values${asText ? '->>' : '->'}${key}`
}

// deno-lint-ignore no-explicit-any
type Builder = any

function applyCriteria(
  builder: Builder,
  search: string,
  filters: readonly RecordFilter[],
): Builder {
  let next = builder
  const term = search.trim()
  if (term) {
    const tsQuery = buildPrefixTsQuery(term)
    next = tsQuery
      ? next.textSearch('search_vector', tsQuery, { config: 'simple' })
      : next.ilike('title', containsPattern(term))
  }
  for (const filter of filters) {
    switch (filter.kind) {
      case 'text':
        next = next.ilike(path(filter.key, true), containsPattern(filter.value))
        break
      case 'options':
        next =
          filter.values.length === 1
            ? next.contains('custom_values', { [filter.key]: filter.values[0] })
            : next.in(path(filter.key, true), filter.values)
        break
      case 'boolean':
        next = next.contains('custom_values', { [filter.key]: filter.value })
        break
      case 'number-range':
      case 'date-range': {
        const column = path(filter.key, filter.kind === 'date-range')
        if (filter.min !== null) next = next.gte(column, filter.min)
        if (filter.max !== null) next = next.lte(column, filter.max)
        break
      }
    }
  }
  return next
}

Deno.serve(
  createHandler(['POST'], async (req, { cors }) => {
    const { user, userClient } = await requireUser(req)
    const body = await parseBody(req, bodySchema)
    const admin = adminClient()

    await requireWorkspaceRole(admin, body.workspaceId, user.id, ['owner', 'admin'])

    // The module must belong to the workspace; read under RLS. A module of another workspace
    // and an unknown id get the same 403 as a non-member, so existence is not revealed.
    const { data: module, error: moduleError } = await userClient
      .from('modules')
      .select('id, slug')
      .eq('workspace_id', body.workspaceId)
      .eq('id', body.moduleId)
      .maybeSingle()
    if (moduleError) throw new AppError(500, 'internal', 'Could not load the module')
    if (!module) throw new AppError(403, 'forbidden', FORBIDDEN_MESSAGE)

    const { data: fieldRows, error: fieldsError } = await userClient
      .from('field_definitions')
      .select('key, label, type, options')
      .eq('workspace_id', body.workspaceId)
      .eq('module_id', body.moduleId)
      .order('position', { ascending: true })
      .order('key', { ascending: true })
    if (fieldsError) throw new AppError(500, 'internal', 'Could not load the fields')
    const fields = (fieldRows ?? []) as CsvField[]

    const search = body.search ?? ''
    const filters = body.filters ?? []
    const fieldsByKey = new Map(fields.map((field) => [field.key, field]))
    for (const filter of filters) {
      const field = fieldsByKey.get(filter.key)
      if (!field || FILTER_KIND_BY_TYPE[field.type] !== filter.kind) {
        throw new AppError(400, 'validation_error', 'Invalid request body', {
          formErrors: [],
          fieldErrors: {
            filters: [`Filter "${filter.key}" does not match a field of this module`],
          },
        })
      }
    }
    const filtered = search.trim().length > 0 || filters.length > 0

    const scoped = (columns: string, options?: { count: 'exact'; head: true }) =>
      applyCriteria(
        userClient
          .from('records')
          .select(columns, options)
          .eq('workspace_id', body.workspaceId)
          .eq('module_id', body.moduleId),
        search,
        filters,
      )

    const { count, error: countError } = await scoped('id', { count: 'exact', head: true })
    if (countError) throw new AppError(500, 'internal', 'Could not count the records')
    if ((count ?? 0) > EXPORT_ROW_LIMIT) {
      throw new AppError(
        413,
        'export_too_large',
        `This export has more than ${EXPORT_ROW_LIMIT} rows; filter the records first`,
        { limit: EXPORT_ROW_LIMIT },
      )
    }

    // Keyset pagination on (created_at, id): every page evaluates only its own rows under
    // RLS, so the cost is linear (offset paging re-evaluated every earlier row per page; a
    // 50,000-row export took 92 s that way). The cursor values are PostgREST's own output,
    // double-quoted because timestamps contain `:` and `+`.
    const records: CsvRecord[] = []
    let cursor: { created_at: string; id: string } | null = null
    for (;;) {
      let query = scoped('id, title, status, custom_values, created_at, updated_at')
      if (cursor) {
        query = query.or(
          `created_at.gt."${cursor.created_at}",and(created_at.eq."${cursor.created_at}",id.gt.${cursor.id})`,
        )
      }
      const { data, error } = await query
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(PAGE_SIZE)
      if (error) throw new AppError(500, 'internal', 'Could not read the records')
      const page = (data ?? []) as (CsvRecord & { id: string })[]
      records.push(...page)
      const last = page.at(-1)
      if (last) cursor = { created_at: last.created_at, id: last.id }
      if (records.length > EXPORT_ROW_LIMIT) {
        // Rows were added between the count and the read.
        throw new AppError(
          413,
          'export_too_large',
          `This export has more than ${EXPORT_ROW_LIMIT} rows; filter the records first`,
          { limit: EXPORT_ROW_LIMIT },
        )
      }
      if (page.length < PAGE_SIZE) break
    }

    const csv = buildCsv(fields, records)

    await writeAudit(admin, {
      workspaceId: body.workspaceId,
      actorId: user.id,
      action: 'records.exported',
      entityType: 'module',
      entityId: body.moduleId,
      metadata: { module_id: body.moduleId, row_count: records.length, filtered },
    })

    const fileName = exportFileName((module as { slug: string }).slug)
    return new Response(csv, {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Access-Control-Expose-Headers': 'Content-Disposition',
        'Cache-Control': 'no-store',
      },
    })
  }),
)
