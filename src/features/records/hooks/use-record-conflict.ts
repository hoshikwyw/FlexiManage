import { useCallback, useRef, useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'

import { rebaseFormValues } from '../lib/record-conflict'
import type { RecordFormValues } from '../schemas/record'

export type ConflictState = 'none' | 'conflict' | 'reloading' | 'reload-failed' | 'reloaded'

/**
 * Edit-form side of a `PT409` conflict. `markConflict()` shows the banner;
 * `reload()` asks the page for the latest version (`loadLatest`, which also
 * re-seeds the page's snapshot) and rebases the form onto it: fields the user
 * changed since the form opened keep the user's value (and stay dirty), every
 * other field shows the latest value. The new version becomes the base for
 * the next conflict. `loadLatest` resolving to null means the record is gone;
 * the page then renders its not-found state.
 */
export function useRecordConflict(
  form: UseFormReturn<RecordFormValues>,
  initialValues: RecordFormValues,
  loadLatest: (() => Promise<RecordFormValues | null>) | undefined,
) {
  const base = useRef(initialValues)
  const [state, setState] = useState<ConflictState>('none')

  const markConflict = useCallback(() => setState('conflict'), [])
  const dismiss = useCallback(() => setState('none'), [])

  const reload = useCallback(async () => {
    if (!loadLatest) return
    setState('reloading')
    let latest: RecordFormValues | null
    try {
      latest = await loadLatest()
    } catch {
      setState('reload-failed')
      return
    }
    if (!latest) {
      setState('none')
      return
    }
    const { values, kept } = rebaseFormValues(base.current, form.getValues(), latest)
    form.reset(latest)
    for (const path of kept) {
      const value =
        path === 'title' || path === 'status'
          ? values[path]
          : values.custom_values[path.slice('custom_values.'.length)]
      form.setValue(path, value as never, { shouldDirty: true })
    }
    base.current = latest
    setState('reloaded')
  }, [form, loadLatest])

  return { state, markConflict, reload, dismiss, enabled: loadLatest !== undefined }
}
