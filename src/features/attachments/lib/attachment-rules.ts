import { formatBytes } from '@/lib/format'

/**
 * Client-side mirror of the attachment rules of migration 005
 * (`attachment_content_type_is_allowed`, `attachment_file_name_is_valid`,
 * `attachments_size_bytes_check`, `enforce_attachment_cap`) and the bucket
 * configuration. The UI checks them first for a quick, clear message; the
 * table constraints, the storage policies and the bucket enforce them.
 */

/** Exactly the eleven types of `attachment_content_type_is_allowed()` and the bucket. */
export const ALLOWED_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
] as const

export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number]

/** 10 MB (`attachments_size_bytes_check`, bucket `file_size_limit`). */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

/** `enforce_attachment_cap()`: at most 10 files per record. */
export const MAX_ATTACHMENTS_PER_RECORD = 10

/** `attachment_file_name_is_valid()`: 1..255 characters. */
export const MAX_FILE_NAME_LENGTH = 255

/** Fallback when nothing of the original name survives sanitising. */
export const FALLBACK_FILE_NAME = 'file'

/**
 * Extensions of the allowed types. Browsers derive `File.type` from the
 * operating system, which is often empty or different (Windows reports `.csv`
 * as `application/vnd.ms-excel` and `.zip` as `application/x-zip-compressed`),
 * so the extension decides when the declared type is not on the list.
 */
export const EXTENSION_CONTENT_TYPES: Readonly<Record<string, AllowedContentType>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
}

/** Value for `<input type="file" accept>`: every allowed type and extension. */
export const ACCEPT_ATTRIBUTE = [
  ...ALLOWED_CONTENT_TYPES,
  ...Object.keys(EXTENSION_CONTENT_TYPES).map((extension) => `.${extension}`),
].join(',')

/** Short list for help text. */
export const ALLOWED_TYPES_LABEL = 'PNG, JPEG, GIF, WebP, PDF, TXT, CSV, DOCX, XLSX, PPTX, ZIP'

const ALLOWED_SET: ReadonlySet<string> = new Set(ALLOWED_CONTENT_TYPES)

export function isAllowedContentType(value: string): value is AllowedContentType {
  return ALLOWED_SET.has(value)
}

/** Lowercased extension without the dot, or '' (dotfiles such as `.env` have none). */
export function getExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}

/**
 * The MIME type to store and upload with: the declared type (parameters such
 * as `;charset=utf-8` dropped) when it is allowed, otherwise the type of the
 * extension, otherwise null (not allowed).
 */
export function resolveContentType(file: {
  name: string
  type: string
}): AllowedContentType | null {
  const declared = file.type.split(';')[0]?.trim().toLowerCase() ?? ''
  if (isAllowedContentType(declared)) return declared
  return EXTENSION_CONTENT_TYPES[getExtension(file.name)] ?? null
}

/**
 * Characters outside `[A-Za-z0-9 !._*'()&$@=;:+,-]`. Storage alone would accept `?`, but
 * `attachment_file_name_is_valid()` rejects `?`, `#` and `%` (they break URLs), so they are
 * replaced like every other character outside the set.
 */
const DISALLOWED_RUN = /[^A-Za-z0-9 !._*'()&$@=;:+,-]+/g
/** Combining marks left by NFKD, so `é` becomes `e` instead of `_`. */
const COMBINING_MARKS = /\p{M}+/gu
const WHITESPACE_RUN = /\s+/g
/** A longer "extension" is part of the name (`report.final-version-2026-draft`). */
const MAX_EXTENSION_LENGTH = 16

function sanitisePart(part: string): string {
  return part
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .replace(WHITESPACE_RUN, ' ')
    .replace(DISALLOWED_RUN, '_')
}

/** True when nothing meaningful is left (only underscores, dots and spaces). */
function isBlank(part: string): boolean {
  return /^[\s._]*$/.test(part)
}

/**
 * Turns a user's file name into one `attachment_file_name_is_valid()` accepts:
 * the last path segment only (`C:\docs\a.pdf` and `../a.pdf` become `a.pdf`),
 * accents folded (`Résumé` -> `Resume`), every other run of characters outside
 * the allowed set replaced by one `_`, whitespace collapsed, at most 255
 * characters with the extension kept, trimmed, never empty (`file`, or
 * `file.pdf` when only the extension survived).
 */
export function sanitiseFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  const rawExtension = dot > 0 ? base.slice(dot + 1) : ''
  const hasExtension =
    rawExtension.length > 0 &&
    rawExtension.length <= MAX_EXTENSION_LENGTH &&
    /^[A-Za-z0-9]+$/.test(rawExtension)

  let stem = sanitisePart(hasExtension ? base.slice(0, dot) : base).trim()
  const extension = hasExtension ? `.${rawExtension}` : ''
  if (isBlank(stem)) stem = FALLBACK_FILE_NAME

  const room = MAX_FILE_NAME_LENGTH - extension.length
  if (stem.length > room) stem = stem.slice(0, room).trimEnd()
  const result = `${stem}${extension}`.trim()
  return result.length > 0 ? result : FALLBACK_FILE_NAME
}

export type AttachmentRuleError = 'too_large' | 'empty' | 'type_not_allowed' | 'too_many'

export interface ValidFile {
  fileName: string
  contentType: AllowedContentType
  sizeBytes: number
}

export type FileValidationResult =
  { ok: true; value: ValidFile } | { ok: false; error: AttachmentRuleError }

/**
 * Checks one file against the rules, given how many attachments the record
 * already has (include files accepted earlier in the same batch). Order: the
 * cap first (nothing else matters at 10), then empty, size and type.
 */
export function validateFile(
  file: { name: string; size: number; type: string },
  existingCount: number,
): FileValidationResult {
  if (existingCount >= MAX_ATTACHMENTS_PER_RECORD) return { ok: false, error: 'too_many' }
  if (file.size <= 0) return { ok: false, error: 'empty' }
  if (file.size > MAX_ATTACHMENT_BYTES) return { ok: false, error: 'too_large' }
  const contentType = resolveContentType(file)
  if (!contentType) return { ok: false, error: 'type_not_allowed' }
  return {
    ok: true,
    value: { fileName: sanitiseFileName(file.name), contentType, sizeBytes: file.size },
  }
}

/** User-facing text for a rule violation. */
export function describeAttachmentRuleError(error: AttachmentRuleError): string {
  switch (error) {
    case 'too_large':
      return `Larger than ${formatBytes(MAX_ATTACHMENT_BYTES)}.`
    case 'empty':
      return 'The file is empty.'
    case 'type_not_allowed':
      return `This file type is not allowed. Use ${ALLOWED_TYPES_LABEL}.`
    case 'too_many':
      return `A record can have at most ${MAX_ATTACHMENTS_PER_RECORD} attachments.`
  }
}
