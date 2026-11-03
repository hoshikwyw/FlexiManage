/**
 * A chainable stand-in for a PostgREST query builder: every method call is
 * recorded as `[method, ...args]` and returns the builder; awaiting it
 * resolves to `result`. Use with `vi.mocked(supabase.from).mockReturnValue(...)`
 * (cast to `never`) and assert on `builder.calls`.
 */
export interface QueryBuilderMock {
  calls: [string, ...unknown[]][]
  /** Calls of one method, without the method name. */
  callsOf: (method: string) => unknown[][]
  then: <T>(resolve: (value: unknown) => T, reject?: (error: unknown) => T) => Promise<T>
  [method: string]: unknown
}

const METHODS = [
  'select',
  'insert',
  'update',
  'delete',
  'eq',
  'neq',
  'in',
  'ilike',
  'gte',
  'lte',
  'contains',
  'textSearch',
  'order',
  'range',
  'single',
  'maybeSingle',
  'limit',
]

export function createQueryBuilderMock(result: unknown): QueryBuilderMock {
  const calls: [string, ...unknown[]][] = []
  const builder = {
    calls,
    callsOf: (method: string) =>
      calls.filter(([name]) => name === method).map(([, ...args]) => args),
    then: <T>(resolve: (value: unknown) => T, reject?: (error: unknown) => T) =>
      Promise.resolve(result).then(resolve, reject),
  } as QueryBuilderMock
  for (const method of METHODS) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args])
      return builder
    }
  }
  return builder
}
