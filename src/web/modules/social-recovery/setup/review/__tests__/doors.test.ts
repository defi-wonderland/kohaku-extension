import { codeEntriesOf, doorsOf } from '../doors'
import type { AccountRead } from '../types'
import { descriptionOf, OTHER_KEY, REMOVED_KEY, THIRD_KEY } from './fixtures'

const answeredWith = (
  ...args: Parameters<typeof descriptionOf>
): AccountRead<ReturnType<typeof descriptionOf>> => ({
  status: 'answered',
  value: descriptionOf(...args)
})

const UNAVAILABLE = { status: 'unavailable' } as const

describe('the other doors', () => {
  it('wait while the setup description has not come back', () => {
    expect(doorsOf({ status: 'pending' }, UNAVAILABLE)).toEqual({ kind: 'pending' })
  })

  it('read as unreadable where the setup description threw', () => {
    expect(doorsOf({ status: 'failed' }, UNAVAILABLE)).toEqual({ kind: 'unreadable' })
  })

  it('read as none where no key holds authority beside the one a recovery removes', () => {
    expect(doorsOf(answeredWith(), UNAVAILABLE)).toEqual({ kind: 'none' })
    expect(doorsOf(answeredWith([]), UNAVAILABLE)).toEqual({ kind: 'none' })
  })

  it('count the keys beside the removed one while the code entries are unavailable', () => {
    const doors = doorsOf(
      answeredWith([
        { address: REMOVED_KEY, isAuthority: true },
        { address: OTHER_KEY, isAuthority: true },
        { address: THIRD_KEY, isAuthority: true }
      ]),
      UNAVAILABLE
    )

    expect(doors).toEqual({ kind: 'keys', keys: 2 })
  })

  it('leave out the removed key whatever the case its address is written in', () => {
    const doors = doorsOf(
      answeredWith(
        [
          { address: REMOVED_KEY, isAuthority: true },
          { address: OTHER_KEY, isAuthority: true }
        ],
        REMOVED_KEY.toLowerCase() as typeof REMOVED_KEY
      ),
      UNAVAILABLE
    )

    expect(doors).toEqual({ kind: 'keys', keys: 1 })
  })

  it('count only the candidate keys that hold authority', () => {
    const doors = doorsOf(
      answeredWith([
        { address: REMOVED_KEY, isAuthority: true },
        { address: OTHER_KEY, isAuthority: false },
        { address: THIRD_KEY, isAuthority: true }
      ]),
      UNAVAILABLE
    )

    expect(doors).toEqual({ kind: 'keys', keys: 1 })
  })

  it('count every authority where the SDK names no removed key', () => {
    const doors = doorsOf(
      answeredWith(
        [
          { address: OTHER_KEY, isAuthority: true },
          { address: THIRD_KEY, isAuthority: true }
        ],
        'no-creation-triple'
      ),
      UNAVAILABLE
    )

    expect(doors).toEqual({ kind: 'keys', keys: 2 })
  })

  it('read the code entries as unavailable, so the doors name the keys alone', () => {
    const doors = doorsOf(
      answeredWith([
        { address: REMOVED_KEY, isAuthority: true },
        { address: OTHER_KEY, isAuthority: true }
      ]),
      codeEntriesOf()
    )

    expect(doors).toEqual({ kind: 'keys', keys: 1 })
  })

  it('pair the code entries with the keys where both are read', () => {
    const description = answeredWith([
      { address: REMOVED_KEY, isAuthority: true },
      { address: OTHER_KEY, isAuthority: true }
    ])

    expect(doorsOf(description, { status: 'read', count: 2 })).toEqual({
      kind: 'pair',
      codeEntries: 2,
      keys: 1
    })
    expect(doorsOf(answeredWith(), { status: 'read', count: 1 })).toEqual({
      kind: 'pair',
      codeEntries: 1,
      keys: 0
    })
    expect(doorsOf(answeredWith(), { status: 'read', count: 0 })).toEqual({ kind: 'none' })
  })
})
