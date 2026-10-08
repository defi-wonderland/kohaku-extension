/**
 * `it.each` without its typings: the repository's type roots declare the
 * mocha globals over Jest's, so tsc knows no `.each`. A row of a table of
 * tuples spreads into the test, and the title's `%s` or `%i` names a row by
 * its first member.
 */
export function eachIt<T extends readonly unknown[] | [unknown]>(
  cases: readonly T[]
): (title: string, fn: (...row: T) => unknown) => void
export function eachIt<T extends string | number>(
  cases: readonly T[]
): (title: string, fn: (value: T) => unknown) => void
export function eachIt(cases: readonly unknown[]) {
  return (title: string, fn: (...row: unknown[]) => unknown) =>
    cases.forEach((value) => {
      const row: readonly unknown[] = Array.isArray(value) ? value : [value]
      it(title.replace(/%[si]/, String(row[0])), () => fn(...row))
    })
}

describe('the table helper', () => {
  const seen: string[] = []
  eachIt([
    ['one', 1],
    ['two', 2]
  ] as const)('spreads the row %s into the test', (name, count) => {
    seen.push(`${name}:${count}`)
    expect(count).toBe(seen.length)
  })
  eachIt(['alone'])('passes a single value %s as it is', (value) => {
    expect(value).toBe('alone')
  })
  it('runs every row once, in order', () => {
    expect(seen).toEqual(['one:1', 'two:2'])
  })
})
