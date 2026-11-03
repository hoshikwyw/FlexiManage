import { describe, expect, it } from 'vitest'

import { NETWORK_ERROR_MESSAGE } from '@/lib/postgrest-errors'

import {
  FIELD_KEY_TAKEN_MESSAGE,
  FIELD_NOT_FOUND_MESSAGE,
  FieldNotFoundError,
  GENERIC_MODULE_ERROR_MESSAGE,
  KEY_IMMUTABLE_MESSAGE,
  MODULE_CHECK_MESSAGE,
  MODULE_FORBIDDEN_MESSAGE,
  MODULE_NOT_FOUND_MESSAGE,
  MODULE_SLUG_TAKEN_MESSAGE,
  ModuleNotFoundError,
  OPTIONS_INVALID_MESSAGE,
  SETTINGS_INVALID_MESSAGE,
  TYPE_LOCKED_MESSAGE,
  getModuleErrorMessage,
} from './module-errors'

function pgError(code: string, message = 'raw database text', details = '') {
  return { code, message, details, hint: '', name: 'PostgrestError' }
}

describe('getModuleErrorMessage', () => {
  it('tells module slug and field key unique violations apart', () => {
    expect(
      getModuleErrorMessage(
        pgError(
          '23505',
          'duplicate key value violates unique constraint "modules_workspace_id_slug_key"',
        ),
      ),
    ).toBe(MODULE_SLUG_TAKEN_MESSAGE)
    expect(
      getModuleErrorMessage(
        pgError(
          '23505',
          'duplicate key value violates unique constraint "field_definitions_module_id_key_key"',
        ),
      ),
    ).toBe(FIELD_KEY_TAKEN_MESSAGE)
  })

  it('explains the options and settings check constraints', () => {
    expect(
      getModuleErrorMessage(
        pgError(
          '23514',
          'new row for relation "field_definitions" violates check constraint "field_definitions_options_check"',
        ),
      ),
    ).toBe(OPTIONS_INVALID_MESSAGE)
    expect(
      getModuleErrorMessage(
        pgError(
          '23514',
          'new row for relation "field_definitions" violates check constraint "field_definitions_settings_check"',
        ),
      ),
    ).toBe(SETTINGS_INVALID_MESSAGE)
  })

  it('translates the field guard messages', () => {
    expect(
      getModuleErrorMessage(pgError('23514', 'field_definitions.key: cannot be changed')),
    ).toBe(KEY_IMMUTABLE_MESSAGE)
    expect(
      getModuleErrorMessage(
        pgError(
          '23514',
          'field_definitions.type: cannot be changed while records have a value for "status"',
        ),
      ),
    ).toBe(TYPE_LOCKED_MESSAGE)
    expect(
      getModuleErrorMessage(
        pgError('23514', 'field_definitions.options: option "lead" is still used by records'),
      ),
    ).toBe('Option "lead" is still used by records. Reassign those records before removing it.')
  })

  it('falls back to the generic check message for other 23514 errors', () => {
    expect(
      getModuleErrorMessage(pgError('23514', 'violates check constraint "modules_slug_check"')),
    ).toBe(MODULE_CHECK_MESSAGE)
  })

  it('maps permission, zero-row and foreign key failures', () => {
    expect(getModuleErrorMessage(pgError('42501'))).toBe(MODULE_FORBIDDEN_MESSAGE)
    expect(getModuleErrorMessage(pgError('PGRST116'))).toBe(MODULE_NOT_FOUND_MESSAGE)
    expect(getModuleErrorMessage(pgError('23503'))).toBe(MODULE_NOT_FOUND_MESSAGE)
    expect(getModuleErrorMessage(new ModuleNotFoundError())).toBe(MODULE_NOT_FOUND_MESSAGE)
    expect(getModuleErrorMessage(new FieldNotFoundError())).toBe(FIELD_NOT_FOUND_MESSAGE)
  })

  it('reports network failures and never leaks raw text otherwise', () => {
    expect(getModuleErrorMessage(new TypeError('Failed to fetch'))).toBe(NETWORK_ERROR_MESSAGE)
    expect(getModuleErrorMessage(pgError('XX000', 'internal detail'))).toBe(
      GENERIC_MODULE_ERROR_MESSAGE,
    )
    expect(getModuleErrorMessage(undefined)).toBe(GENERIC_MODULE_ERROR_MESSAGE)
  })
})
