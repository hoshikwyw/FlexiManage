import { describe, expect, it } from 'vitest'

import {
  ACCEPT_ATTRIBUTE,
  ALLOWED_CONTENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_RECORD,
  describeAttachmentRuleError,
  getExtension,
  resolveContentType,
  sanitiseFileName,
  validateFile,
} from './attachment-rules'

/** The server's rule (`attachment_file_name_is_valid`), to check every sanitised name against. */
const SERVER_NAME_RULE = /^[A-Za-z0-9 !._*'()&$@=;:+,-]+$/
function expectServerValid(name: string) {
  expect(name.length).toBeGreaterThanOrEqual(1)
  expect(name.length).toBeLessThanOrEqual(255)
  expect(name).toBe(name.trim())
  expect(name).toMatch(SERVER_NAME_RULE)
}

const file = (name: string, size: number, type: string) => ({ name, size, type })

describe('constants', () => {
  it('lists exactly the eleven types of migration 005', () => {
    expect(ALLOWED_CONTENT_TYPES).toEqual([
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
    ])
    expect(MAX_ATTACHMENT_BYTES).toBe(10_485_760)
    expect(MAX_ATTACHMENTS_PER_RECORD).toBe(10)
  })

  it('accepts every allowed type and extension in the input accept attribute', () => {
    const accept = ACCEPT_ATTRIBUTE.split(',')
    for (const type of ALLOWED_CONTENT_TYPES) expect(accept).toContain(type)
    expect(accept).toEqual(expect.arrayContaining(['.png', '.jpg', '.csv', '.docx', '.zip']))
    expect(accept).not.toContain('.exe')
  })
})

describe('sanitiseFileName', () => {
  it.each([
    ['invoice 2026-11.pdf', 'invoice 2026-11.pdf'],
    ["O'Brien & Sons (draft) v2+final.docx", "O'Brien & Sons (draft) v2+final.docx"],
    ['  padded name.txt  ', 'padded name.txt'],
    ['tab\tand\nnewline.csv', 'tab and newline.csv'],
  ])('keeps allowed characters: %j', (input, expected) => {
    expect(sanitiseFileName(input)).toBe(expected)
  })

  it('folds accents and replaces other unicode runs with one underscore', () => {
    expect(sanitiseFileName('Résumé Zoë.pdf')).toBe('Resume Zoe.pdf')
    expect(sanitiseFileName('Angebot für Müller.xlsx')).toBe('Angebot fur Muller.xlsx')
    expect(sanitiseFileName('plan 📅 2026.png')).toBe('plan _ 2026.png')
    expect(sanitiseFileName('a#b%c{d}.txt')).toBe('a_b_c_d_.txt')
  })

  it('replaces ?, # and % (the server rejects them because they break URLs)', () => {
    expect(sanitiseFileName('what?.pdf')).toBe('what_.pdf')
    expect(sanitiseFileName('issue #12.txt')).toBe('issue _12.txt')
    expect(sanitiseFileName('100% done.png')).toBe('100_ done.png')
    expect(sanitiseFileName('a?#%b.csv')).toBe('a_b.csv')
    expect(sanitiseFileName('???.pdf')).toBe('file.pdf')
  })

  it('falls back to "file" when nothing of the name survives, keeping the extension', () => {
    expect(sanitiseFileName('報告書.pdf')).toBe('file.pdf')
    expect(sanitiseFileName('📷📷📷.jpg')).toBe('file.jpg')
    expect(sanitiseFileName('')).toBe('file')
    expect(sanitiseFileName('   ')).toBe('file')
    expect(sanitiseFileName('日本語')).toBe('file')
  })

  it('keeps only the last path segment', () => {
    expect(sanitiseFileName('C:\\Users\\alice\\Documents\\contract.pdf')).toBe('contract.pdf')
    expect(sanitiseFileName('../../etc/passwd')).toBe('passwd')
    expect(sanitiseFileName('folder/sub/photo.png')).toBe('photo.png')
    expect(sanitiseFileName('dir/')).toBe('file')
  })

  it('truncates long names to 255 characters and preserves the extension', () => {
    const long = `${'a'.repeat(400)}.pdf`
    const result = sanitiseFileName(long)
    expect(result).toHaveLength(255)
    expect(result.endsWith('.pdf')).toBe(true)
    const spaced = sanitiseFileName(`${'b'.repeat(250)}     tail.docx`)
    expect(spaced.length).toBeLessThanOrEqual(255)
    expect(spaced.endsWith('.docx')).toBe(true)
    expectServerValid(spaced)
  })

  it('handles names without an extension and odd extensions', () => {
    expect(sanitiseFileName('README')).toBe('README')
    expect(sanitiseFileName('trailing.')).toBe('trailing.')
    expect(sanitiseFileName('archive.tar.gz')).toBe('archive.tar.gz')
    // A very long "extension" is part of the name, so truncation does not keep it whole.
    const odd = sanitiseFileName(`x.${'y'.repeat(300)}`)
    expect(odd).toHaveLength(255)
    expect(odd.startsWith('x.')).toBe(true)
    // A non-alphanumeric extension is sanitised as part of the name.
    expect(sanitiseFileName('photo.p€g')).toBe('photo.p_g')
  })

  it('keeps dotfiles as they are', () => {
    expect(sanitiseFileName('.env')).toBe('.env')
    expect(sanitiseFileName('.gitignore')).toBe('.gitignore')
    expect(sanitiseFileName('...')).toBe('file')
  })

  it.each([
    'Résumé.pdf',
    '報告書.pdf',
    '../x/../y.png',
    `${'é'.repeat(300)}.png`,
    ' \u200b zero width .txt',
    'emoji 😀😀.csv',
    'ctrl\u0001char.txt',
    'semi;colon:plus+comma,question?.pdf',
    'query?x=1#frag%20.png',
  ])('always produces a name the server accepts: %j', (input) => {
    expectServerValid(sanitiseFileName(input))
  })
})

describe('getExtension and resolveContentType', () => {
  it('reads the lowercased extension; dotfiles have none', () => {
    expect(getExtension('A.PDF')).toBe('pdf')
    expect(getExtension('.env')).toBe('')
    expect(getExtension('noext')).toBe('')
    expect(getExtension('end.')).toBe('')
  })

  it('uses an allowed declared type, without parameters', () => {
    expect(resolveContentType({ name: 'a.bin', type: 'image/png' })).toBe('image/png')
    expect(resolveContentType({ name: 'a.txt', type: 'text/plain;charset=utf-8' })).toBe(
      'text/plain',
    )
    expect(resolveContentType({ name: 'a', type: 'IMAGE/JPEG' })).toBe('image/jpeg')
  })

  it('falls back to the extension when the browser type is empty or not on the list', () => {
    expect(resolveContentType({ name: 'list.csv', type: 'application/vnd.ms-excel' })).toBe(
      'text/csv',
    )
    expect(resolveContentType({ name: 'a.zip', type: 'application/x-zip-compressed' })).toBe(
      'application/zip',
    )
    expect(resolveContentType({ name: 'photo.JPG', type: '' })).toBe('image/jpeg')
  })

  it('rejects types and extensions outside the list', () => {
    expect(resolveContentType({ name: 'setup.exe', type: 'application/x-msdownload' })).toBeNull()
    expect(resolveContentType({ name: 'photo.heic', type: 'image/heic' })).toBeNull()
    expect(resolveContentType({ name: 'noext', type: '' })).toBeNull()
  })
})

describe('validateFile', () => {
  it('accepts a valid file and returns the sanitised name and resolved type', () => {
    expect(validateFile(file('Résumé.pdf', 1234, 'application/pdf'), 0)).toEqual({
      ok: true,
      value: { fileName: 'Resume.pdf', contentType: 'application/pdf', sizeBytes: 1234 },
    })
  })

  it('accepts exactly 10 MB and refuses one byte more', () => {
    expect(validateFile(file('a.png', MAX_ATTACHMENT_BYTES, 'image/png'), 0).ok).toBe(true)
    expect(validateFile(file('a.png', MAX_ATTACHMENT_BYTES + 1, 'image/png'), 0)).toEqual({
      ok: false,
      error: 'too_large',
    })
  })

  it('refuses empty files', () => {
    expect(validateFile(file('a.png', 0, 'image/png'), 0)).toEqual({ ok: false, error: 'empty' })
  })

  it('refuses types outside the allow-list', () => {
    expect(validateFile(file('setup.exe', 100, 'application/x-msdownload'), 0)).toEqual({
      ok: false,
      error: 'type_not_allowed',
    })
  })

  it('refuses an 11th file before checking anything else', () => {
    expect(validateFile(file('a.png', 10, 'image/png'), 9).ok).toBe(true)
    expect(validateFile(file('setup.exe', 0, ''), 10)).toEqual({ ok: false, error: 'too_many' })
  })

  it('describes every error', () => {
    expect(describeAttachmentRuleError('too_large')).toBe('Larger than 10 MB.')
    expect(describeAttachmentRuleError('type_not_allowed')).toMatch(/not allowed/)
    expect(describeAttachmentRuleError('too_many')).toMatch(/at most 10/)
    expect(describeAttachmentRuleError('empty')).toMatch(/empty/)
  })
})
