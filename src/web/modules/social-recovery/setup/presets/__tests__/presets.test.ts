/**
 * The preset table and the draft a choice starts, read back from the records
 * on an in-memory double of the extension's storage helper: `set` stores the
 * rich JSON string of a value and `get` parses it, so a `bigint` survives and
 * the draft reads back as the extension would read it. The strings come from
 * the real en.json through the app's own i18next instance.
 */
import { zeroAddress } from 'viem'

import { parse, stringify } from '@ambire-common/libs/richJson/richJson'
import i18n from '@common/config/localization'
import en from '@common/config/localization/translations/en.json'
import type { Address, Credential, SetupDraft } from '@web/modules/social-recovery/sdk-interfaces'
import {
  cardRuleLines,
  draftAgeLine,
  draftOf,
  emptySlot,
  presetOf,
  resumeRowsOf,
  shapeRowsOf,
  slotKindOf,
  startDraft
} from '@web/modules/social-recovery/setup/presets'
import type { PresetChoice, PresetId, SlotKind } from '@web/modules/social-recovery/setup/presets'
import { addressBookOf, WALLET_RECOVERY_CHAIN } from '@web/modules/social-recovery/shared/client'
import {
  createWalletRecords,
  ENROLLMENT_TEST_VERDICTS,
  SETUP_RECORD_NAMES
} from '@web/modules/social-recovery/shared/records'
import type {
  Enrollment,
  EnrollmentTestVerdict,
  RecordStorage,
  SetupRecords
} from '@web/modules/social-recovery/shared/records'

const { t } = i18n

const CHAIN_ID = 11155111
const ACCOUNT: Address = '0x1111111111111111111111111111111111111111'
const UNKNOWN_METHOD: Address = '0x3333333333333333333333333333333333333333'
const BOOK = addressBookOf(WALLET_RECOVERY_CHAIN)

const makeStorage = (): RecordStorage => {
  const raw = new Map<string, string>()
  return {
    get: async (key, defaultValue) => {
      const stored = key && raw.get(key)
      return stored ? parse(stored) : defaultValue
    },
    getAll: async () =>
      Object.fromEntries([...raw.entries()].map(([key, stored]) => [key, parse(stored)])),
    set: async (key, value) => {
      raw.set(key, typeof value === 'string' ? value : stringify(value))
      return null
    },
    remove: async (key) => {
      raw.delete(key)
      return null
    }
  }
}

const setupOn = () => {
  const records = createWalletRecords({ storage: makeStorage() })
  return { records, setup: records.setup(CHAIN_ID, ACCOUNT) }
}

const readDraft = async (setup: SetupRecords): Promise<SetupDraft> => {
  const read = await setup.setupDraft.read()
  if (read.status !== 'present') throw new Error('no draft stored')
  return read.value
}

// The shapes the four cards promise: each clause's threshold and the kind every member slot waits for.
const SHAPES: Record<PresetId, { threshold: number; kinds: SlotKind[] }[]> = {
  deviceAndGuardians: [
    { threshold: 1, kinds: ['passkey'] },
    { threshold: 2, kinds: ['ecdsa', 'ecdsa', 'ecdsa'] }
  ],
  deviceAndId: [
    { threshold: 1, kinds: ['passkey'] },
    { threshold: 1, kinds: ['zkpassport'] }
  ],
  eitherOne: [{ threshold: 1, kinds: ['passkey', 'zkpassport'] }],
  guardiansOnly: [{ threshold: 2, kinds: ['ecdsa', 'ecdsa', 'ecdsa'] }]
}

const PRESET_IDS = Object.keys(SHAPES) as PresetId[]

describe('a preset starts its draft', () => {
  PRESET_IDS.forEach((id) =>
    it(`${id} stores exactly its shape with every member slot empty`, async () => {
      const { setup } = setupOn()
      await startDraft(setup, id)
      const draft = await readDraft(setup)

      expect(
        draft.clauses.map(({ threshold, credentials }) => ({
          threshold,
          kinds: credentials.map(({ label }) => label)
        }))
      ).toEqual(SHAPES[id])
      draft.clauses
        .flatMap(({ credentials }) => credentials)
        .forEach((credential) => {
          expect(credential.method).toBe(zeroAddress)
          expect(credential.config).toBe('0x')
          expect(slotKindOf(credential)).toBe(credential.label)
        })
    })
  )

  PRESET_IDS.forEach((id) =>
    it(`${id} writes the path equal to the draft clauses`, async () => {
      const { setup } = setupOn()
      await startDraft(setup, id)
      const path = await setup.path.read()
      expect(path.status).toBe('present')
      expect(path.status === 'present' && path.value).toEqual((await readDraft(setup)).clauses)
    })
  )

  PRESET_IDS.forEach((id) =>
    it(`${id} stores the 48-hour wait, the pause opt-out and the private default`, async () => {
      const { setup } = setupOn()
      await startDraft(setup, id)
      const draft = await readDraft(setup)
      expect(draft.wait).toBe(172800n)
      expect(draft.ignoresPause).toBe(true)
      expect(draft.privacy).toEqual({ backup: 'encrypted', publicMetadata: '0x' })
    })
  )

  it('refuses no choice on arrival, one after another over the stored draft', async () => {
    const { setup } = setupOn()
    const choices: PresetChoice[] = [...PRESET_IDS, 'fromScratch', ...PRESET_IDS]
    await choices.reduce(
      (previous, choice) =>
        previous.then(() => expect(startDraft(setup, choice)).resolves.toBeUndefined()),
      Promise.resolve()
    )
    const last = PRESET_IDS[PRESET_IDS.length - 1]
    expect((await readDraft(setup)).clauses.map(({ threshold }) => threshold)).toEqual(
      SHAPES[last].map(({ threshold }) => threshold)
    )
  })

  it('writes no record but the draft and the path', async () => {
    const { setup } = setupOn()
    await startDraft(setup, 'deviceAndGuardians')
    const others = SETUP_RECORD_NAMES.filter((name) => name !== 'setupDraft' && name !== 'path')
    const reads = await Promise.all(others.map((name) => setup[name].read()))
    expect(reads.map(({ status }) => status)).toEqual(others.map(() => 'absent'))
  })

  it('hands out a fresh draft each time, so a changed draft never changes the next one', () => {
    const first = draftOf('deviceAndGuardians')
    first.clauses[1].credentials.pop()
    first.clauses[0].credentials[0].label = 'ecdsa'
    first.privacy.backup = 'clear'
    const second = draftOf('deviceAndGuardians')
    expect(second.clauses[1].credentials).toHaveLength(3)
    expect(second.clauses[0].credentials[0].label).toBe('passkey')
    expect(second.privacy.backup).toBe('encrypted')
  })
})

describe('the empty start', () => {
  it('stores a draft with no clause and an empty path, over an earlier preset', async () => {
    const { setup } = setupOn()
    await startDraft(setup, 'deviceAndGuardians')
    await startDraft(setup, 'fromScratch')
    expect((await readDraft(setup)).clauses).toEqual([])
    const path = await setup.path.read()
    expect(path.status === 'present' && path.value).toEqual([])
  })
})

describe('an empty slot', () => {
  it('names the kind it waits for after a storage round trip', async () => {
    const { setup } = setupOn()
    await startDraft(setup, 'deviceAndId')
    const kinds = (await readDraft(setup)).clauses.flatMap(({ credentials }) =>
      credentials.map(slotKindOf)
    )
    expect(kinds).toEqual(['passkey', 'zkpassport'])
  })

  it('names no kind for an enrolled credential, even one labelled with a kind', () => {
    const enrolled: Credential = { method: BOOK.methods.passkey, config: '0x01', label: 'passkey' }
    expect(slotKindOf(enrolled)).toBeUndefined()
  })

  it('names no kind for a label that is not a method kind', () => {
    expect(slotKindOf({ ...emptySlot('passkey'), label: 'phone' })).toBeUndefined()
    expect(slotKindOf({ ...emptySlot('passkey'), label: undefined })).toBeUndefined()
  })
})

describe('a card', () => {
  // The rule line each card shows, word for word.
  const CARD_RULE_LINES: Record<PresetId, string> = {
    deviceAndGuardians:
      'Together with your required methods, any 2 of these 3 recover this account. Losing more than 1 locks you out.',
    deviceAndId: 'Both must answer. Losing either locks you out.',
    eitherOne: 'Either one alone can recover this account. Either one alone can also take it.',
    guardiansOnly: 'Any 2 of these 3 recover this account. Losing more than 1 locks you out.'
  }

  PRESET_IDS.forEach((id) =>
    it(`${id} shows its one rule line, word for word`, () => {
      expect(cardRuleLines(presetOf(id), t)).toEqual([CARD_RULE_LINES[id]])
    })
  )

  it('shows the rows of each shape, word for word', () => {
    expect(PRESET_IDS.map((id) => shapeRowsOf(presetOf(id), t))).toEqual([
      [
        { kind: 'required', text: 'Passkey (required)' },
        { kind: 'group', count: 'Any 2 of 3 guardians', members: [] }
      ],
      [
        { kind: 'required', text: 'Passkey (required)' },
        { kind: 'required', text: 'Passport (required)' }
      ],
      [{ kind: 'group', count: 'Any 1 of 2', members: ['Passkey', 'Passport'] }],
      [{ kind: 'group', count: 'Any 2 of 3 guardians', members: [] }]
    ])
  })
})

describe('the resume rows', () => {
  const passkey = (test: EnrollmentTestVerdict, backup?: Enrollment['backup']): Enrollment => ({
    credential: { method: BOOK.methods.passkey, config: '0x01' },
    test,
    backup
  })
  const guardian = (config: `0x${string}`): Enrollment => ({
    credential: { method: BOOK.methods.ecdsa, config },
    test: 'not-tested'
  })

  it('names a device-bound passkey "Passkey on this device" and a synced one "Passkey"', () => {
    const rows = resumeRowsOf(
      [passkey('passed', 'device-bound'), passkey('passed', 'synced')],
      BOOK,
      t
    )
    expect(rows.map(({ name }) => name)).toEqual(['Passkey on this device', 'Passkey'])
  })

  it('names a passport by its method', () => {
    const rows = resumeRowsOf(
      [{ credential: { method: BOOK.methods.zkpassport, config: '0x02' }, test: 'passed' }],
      BOOK,
      t
    )
    expect(rows.map(({ name }) => name)).toEqual(['Passport'])
  })

  it('names a method the address book does not know by the method noun', () => {
    const rows = resumeRowsOf(
      [{ credential: { method: UNKNOWN_METHOD, config: '0x02' }, test: 'passed' }],
      BOOK,
      t
    )
    expect(rows.map(({ name }) => name)).toEqual([en.socialRecovery.display.nouns.method])
  })

  it('gives each access test verdict its chip', () => {
    const rows = resumeRowsOf(
      ENROLLMENT_TEST_VERDICTS.map((verdict) => passkey(verdict, 'synced')),
      BOOK,
      t
    )
    expect(rows.map(({ chip }) => chip)).toEqual([
      'Tested',
      'Not tested',
      'Test failed',
      'Test unavailable',
      'Not supported'
    ])
  })

  it('folds the guardians into one row, not yet active, with the count added', () => {
    const rows = resumeRowsOf(
      [guardian('0x0a'), passkey('passed', 'device-bound'), guardian('0x0b')],
      BOOK,
      t
    )
    expect(rows.map(({ name, chip, note }) => ({ name, chip, note }))).toEqual([
      { name: 'Passkey on this device', chip: 'Tested', note: undefined },
      { name: 'Guardians', chip: 'Not yet active', note: '2 added, not saved on chain yet' }
    ])
  })

  it('shows no row for no enrollment', () => {
    expect(resumeRowsOf([], BOOK, t)).toEqual([])
  })
})

describe('the draft age line', () => {
  it('dates the draft by its day and month', () => {
    const savedAt = new Date(2026, 7, 12, 12, 0).getTime()
    const line = draftAgeLine(savedAt, t)
    expect(line.startsWith('Your setup is unfinished. Draft from 12 Aug')).toBe(true)
    expect(line.endsWith('Nothing is saved on chain until you confirm.')).toBe(true)
  })
})
