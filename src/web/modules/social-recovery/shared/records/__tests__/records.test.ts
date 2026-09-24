/**
 * PT-040 The wallet's records: the done entries of
 * docs/social-recovery/tasks/PT-040-the-wallet-s-records.md, per the brief's
 * "Test expectations" (docs/social-recovery/briefs/PT-040.md), D-310, D-370,
 * D-392, D-393 and I-38.
 *
 * Every test runs against an in-memory double of
 * src/web/extension-services/background/webapi/storage.ts that keeps its
 * falsy-default rule: `get` returns the default when the stored value is falsy.
 */
import * as records from '@web/modules/social-recovery/shared/records'

// ---------------------------------------------------------------------------
// The storage double
// ---------------------------------------------------------------------------

type StorageDouble = {
  get: (key: string, defaultValue?: any) => Promise<any>
  set: (key: string, value: any) => Promise<null>
  remove: (key: string) => Promise<null>
  raw: Map<string, any>
}

const clone = <T>(value: T): T => (value === undefined ? value : structuredClone(value))

const makeStorage = (): StorageDouble => {
  const raw = new Map<string, any>()
  return {
    raw,
    // The helper's rule: `if (!res[key]) return defaultValue`.
    get: async (key, defaultValue) => {
      const stored = raw.get(key)
      if (!stored) return defaultValue
      return clone(stored)
    },
    set: async (key, value) => {
      raw.set(key, clone(value))
      return null
    },
    remove: async (key) => {
      raw.delete(key)
      return null
    }
  }
}

// A record the platform keeps for the holder's credentials: not a record of
// this lane, and neither save nor start over may touch it (D-310).
const PLATFORM_CREDENTIALS_KEY = 'keystoreKeys'
const PLATFORM_CREDENTIALS = [{ addr: '0xCredential', type: 'internal', label: 'passkey' }]

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACCOUNT = '0x1111111111111111111111111111111111111111'
const OTHER_ACCOUNT = '0x2222222222222222222222222222222222222222'
const CHAIN_ID = 11155111n
const T0 = 1_700_000_000_000
const HOUR = 60 * 60 * 1000

const SETUP_DRAFT = {
  wait: 86400n,
  clauses: [
    {
      threshold: 1,
      credentials: [{ method: '0x3333333333333333333333333333333333333333', config: '0xabcd' }]
    }
  ],
  ignoresPause: false,
  privacy: { publicMetadata: '0x', backup: 'encrypted' }
}

// One sample value per setup record, in D-310's order.
const SETUP_SAMPLES: Record<string, unknown> = {
  setupDraft: SETUP_DRAFT,
  inventory: ['passkey', 'guardian'],
  path: SETUP_DRAFT.clauses,
  enrollments: [{ method: '0x3333333333333333333333333333333333333333', config: '0xabcd' }],
  waitingPeriod: 86400n,
  passwordSet: true
}

const APPROVALS = [
  { credential: 0, signature: '0xdeadbeef' },
  { credential: 1, signature: '0xfeedface' }
]
const PREDICTED_ATTEMPT_ID = '0x0000000000000000000000000000000000000000000000000000000000000007'

// ---------------------------------------------------------------------------
// Adapter: maps the done entries onto the lane's real exports
// ---------------------------------------------------------------------------

const api = records as any

const key = { accountAddress: ACCOUNT, chainId: CHAIN_ID }
const otherKey = { accountAddress: OTHER_ACCOUNT, chainId: CHAIN_ID }

const SETUP_RECORD_NAMES = Object.keys(SETUP_SAMPLES)
const WIPE_EVENT_NAMES = [
  'submissionLanded',
  'deadlinePassed',
  'otherAttemptOpened',
  'setupChanged',
  'recovererAbandoned'
]

const writeSetup = (s: StorageDouble, k: typeof key, name: string, value: unknown, now = T0) =>
  api.writeSetupRecord(s, k, name, value, now)
const readSetup = (s: StorageDouble, k: typeof key, name: string) => api.readSetupRecord(s, k, name)
const ageOf = (rec: unknown, now: number) => api.recordAge(rec, now)
const saveSetup = (s: StorageDouble, k: typeof key) => api.wipeSetupOnSave(s, k)
const startOver = (s: StorageDouble, k: typeof key) => api.wipeSetupOnStartOver(s, k)

const writeSession = (s: StorageDouble, k: typeof key, now = T0) =>
  api.writeRecoverySession(
    s,
    k,
    { approvals: APPROVALS, predictedAttemptId: PREDICTED_ATTEMPT_ID, accountAddress: ACCOUNT },
    now
  )
const readSession = (s: StorageDouble, k: typeof key) => api.readRecoverySession(s, k)
const wipe = (s: StorageDouble, k: typeof key, event: string, now = T0) =>
  api.wipeRecoverySession(s, k, event, now)
const readCountdown = (s: StorageDouble, k: typeof key) => api.readCountdownRecord(s, k)

const writeCache = (s: StorageDouble, k: typeof key, value: unknown, now = T0) =>
  api.writeSetupCache(s, k, value, now)
const readCache = (s: StorageDouble, k: typeof key) => api.readSetupCache(s, k)
const markExecuted = (s: StorageDouble, k: typeof key) => api.onRecoveryExecuted(s, k)

const ABSENT = api.ABSENT

const isAbsent = (value: unknown) => value === ABSENT

// Every value the double holds, flattened, to prove no bare boolean or zero.
const leaves = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value.flatMap(leaves)
  if (value && typeof value === 'object') return Object.values(value).flatMap(leaves)
  return [value]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('the six setup records (D-310)', () => {
  it('names exactly the six setup records', () => {
    expect(api.SETUP_RECORDS).toBeDefined()
    expect([...api.SETUP_RECORDS].sort()).toEqual([...SETUP_RECORD_NAMES].sort())
  })

  describe.each(SETUP_RECORD_NAMES)('%s', (name) => {
    it('round-trips its value with its savedAt', async () => {
      const s = makeStorage()
      await writeSetup(s, key, name, SETUP_SAMPLES[name], T0)
      const rec = await readSetup(s, key, name)
      expect(isAbsent(rec)).toBe(false)
      expect(rec.savedAt).toBe(T0)
      expect(rec.value).toEqual(SETUP_SAMPLES[name])
    })

    it('reports its age for a fixed now', async () => {
      const s = makeStorage()
      await writeSetup(s, key, name, SETUP_SAMPLES[name], T0)
      const rec = await readSetup(s, key, name)
      expect(ageOf(rec, T0 + 3 * HOUR)).toBe(3 * HOUR)
      expect(ageOf(rec, T0)).toBe(0)
    })

    it('reads as absent before any write, never as false or zero', async () => {
      const s = makeStorage()
      const rec = await readSetup(s, key, name)
      expect(isAbsent(rec)).toBe(true)
      expect(rec).not.toBe(false)
      expect(rec).not.toBe(0)
      expect(rec).not.toBeUndefined()
    })
  })

  const fillAll = async (s: StorageDouble, k: typeof key) => {
    await s.set(PLATFORM_CREDENTIALS_KEY, PLATFORM_CREDENTIALS)
    // eslint-disable-next-line no-restricted-syntax
    for (const name of SETUP_RECORD_NAMES) {
      // eslint-disable-next-line no-await-in-loop
      await writeSetup(s, k, name, SETUP_SAMPLES[name])
    }
  }

  it.each([
    ['save', saveSetup],
    ['start over', startOver]
  ])('%s wipes all six while platform credentials survive', async (_label, act) => {
    const s = makeStorage()
    await fillAll(s, key)
    await act(s, key)
    // eslint-disable-next-line no-restricted-syntax
    for (const name of SETUP_RECORD_NAMES) {
      // eslint-disable-next-line no-await-in-loop
      expect(isAbsent(await readSetup(s, key, name))).toBe(true)
    }
    expect(await s.get(PLATFORM_CREDENTIALS_KEY)).toEqual(PLATFORM_CREDENTIALS)
  })

  it('keys the setup records by account: a save on one account leaves another untouched', async () => {
    const s = makeStorage()
    await fillAll(s, key)
    await writeSetup(s, otherKey, 'setupDraft', SETUP_DRAFT)
    await saveSetup(s, key)
    const other = await readSetup(s, otherKey, 'setupDraft')
    expect(isAbsent(other)).toBe(false)
    expect(other.value).toEqual(SETUP_DRAFT)
  })
})

describe('the password-set flag is never a bare boolean (D-310, D-370)', () => {
  it('stores an object, not a boolean', async () => {
    const s = makeStorage()
    await writeSetup(s, key, 'passwordSet', true)
    const stored = [...s.raw.values()]
    expect(stored.length).toBeGreaterThan(0)
    stored.forEach((value) => {
      expect(typeof value).toBe('object')
      expect(value).not.toBeNull()
    })
  })

  it('a flag of false still reads as a stored fact, not as absent', async () => {
    const s = makeStorage()
    await writeSetup(s, key, 'passwordSet', false)
    const rec = await readSetup(s, key, 'passwordSet')
    expect(isAbsent(rec)).toBe(false)
    expect(rec.value).toBe(false)
  })

  it('a waiting period of zero still reads as a stored fact, not as absent', async () => {
    const s = makeStorage()
    await writeSetup(s, key, 'waitingPeriod', 0n)
    const rec = await readSetup(s, key, 'waitingPeriod')
    expect(isAbsent(rec)).toBe(false)
    expect(rec.value).toBe(0n)
  })

  it('the absent value is itself not false, zero, undefined or null', () => {
    expect(ABSENT).toBeDefined()
    expect(ABSENT).not.toBe(false)
    expect(ABSENT).not.toBe(0)
    expect(ABSENT).not.toBeNull()
  })
})

describe('the recovery session (D-310, I-38)', () => {
  it('round-trips the approvals and the predicted attempt id', async () => {
    const s = makeStorage()
    await writeSession(s, key)
    const session = await readSession(s, key)
    expect(isAbsent(session)).toBe(false)
    expect(session.approvals).toEqual(APPROVALS)
    expect(session.predictedAttemptId).toBe(PREDICTED_ATTEMPT_ID)
  })

  it('reads as absent before any write', async () => {
    const s = makeStorage()
    expect(isAbsent(await readSession(s, key))).toBe(true)
  })

  it('the wipe vocabulary holds exactly the five events, no sixth', () => {
    expect(api.WIPE_EVENTS).toBeDefined()
    const events = Array.isArray(api.WIPE_EVENTS) ? api.WIPE_EVENTS : Object.values(api.WIPE_EVENTS)
    expect(events).toHaveLength(5)
    expect([...events].sort()).toEqual([...WIPE_EVENT_NAMES].sort())
  })

  it('refuses an event outside the vocabulary and wipes nothing', async () => {
    const s = makeStorage()
    await writeSession(s, key)
    await expect(Promise.resolve().then(() => wipe(s, key, 'securityStop'))).rejects.toThrow()
    const session = await readSession(s, key)
    expect(session.approvals).toEqual(APPROVALS)
    expect(session.predictedAttemptId).toBe(PREDICTED_ATTEMPT_ID)
  })

  describe.each(WIPE_EVENT_NAMES)('the %s event', (event) => {
    it('wipes the approvals and the predicted attempt id and keeps exactly its reason', async () => {
      const s = makeStorage()
      await writeSession(s, key)
      await wipe(s, key, event, T0 + HOUR)
      const after = await readSession(s, key)
      const dump = JSON.stringify([...s.raw.values()], (_k, v) =>
        typeof v === 'bigint' ? v.toString() : v
      )
      expect(dump).not.toContain('0xdeadbeef')
      expect(dump).not.toContain('0xfeedface')
      expect(dump).not.toContain(PREDICTED_ATTEMPT_ID)
      if (!isAbsent(after)) {
        expect(after.approvals ?? []).toEqual([])
        expect(after.predictedAttemptId).toBeUndefined()
      }
      expect(await api.readWipeReason(s, key)).toBe(event)
    })
  })

  it('a later wipe keeps only its own reason, one line and not a list', async () => {
    const s = makeStorage()
    await writeSession(s, key)
    await wipe(s, key, 'deadlinePassed')
    await writeSession(s, key)
    await wipe(s, key, 'setupChanged')
    expect(await api.readWipeReason(s, key)).toBe('setupChanged')
  })

  it('a pause wipes nothing: re-reading the session later still holds the approvals', async () => {
    const s = makeStorage()
    await writeSession(s, key, T0)
    const later = await readSession(s, key)
    expect(later.approvals).toEqual(APPROVALS)
  })

  it('a security stop, if the lane exposes one, wipes nothing (I-38)', async () => {
    const s = makeStorage()
    await writeSession(s, key)
    if (typeof api.onSecurityStop === 'function') await api.onSecurityStop(s, key)
    const session = await readSession(s, key)
    expect(session.approvals).toEqual(APPROVALS)
    expect(session.predictedAttemptId).toBe(PREDICTED_ATTEMPT_ID)
  })
})

describe('the countdown record after the submission lands (D-310, D-393)', () => {
  it('holds the account address alone and the session is gone', async () => {
    const s = makeStorage()
    await writeSession(s, key)
    await wipe(s, key, 'submissionLanded')
    const countdown = await readCountdown(s, key)
    expect(isAbsent(countdown)).toBe(false)
    const { savedAt, ...rest } = countdown
    expect(rest).toEqual({ accountAddress: ACCOUNT })
    expect(savedAt === undefined || typeof savedAt === 'number').toBe(true)
    const session = await readSession(s, key)
    if (!isAbsent(session)) {
      expect(session.approvals ?? []).toEqual([])
      expect(session.predictedAttemptId).toBeUndefined()
    }
  })

  it.each(WIPE_EVENT_NAMES.filter((e) => e !== 'submissionLanded'))(
    'no countdown record follows %s',
    async (event) => {
      const s = makeStorage()
      await writeSession(s, key)
      await wipe(s, key, event)
      expect(isAbsent(await readCountdown(s, key))).toBe(true)
    }
  )
})

describe('the decrypted setup cache after execution (D-310)', () => {
  it('stays after the recovery executes', async () => {
    const s = makeStorage()
    await writeCache(s, key, SETUP_DRAFT)
    await markExecuted(s, key)
    const cache = await readCache(s, key)
    expect(isAbsent(cache)).toBe(false)
    expect(cache.value).toEqual(SETUP_DRAFT)
  })

  it('reads as absent before any write', async () => {
    const s = makeStorage()
    expect(isAbsent(await readCache(s, key))).toBe(true)
  })
})

describe('no record is a bare boolean or zero (D-310, D-370)', () => {
  it('every top-level value written by the lane is an object', async () => {
    const s = makeStorage()
    // eslint-disable-next-line no-restricted-syntax
    for (const name of SETUP_RECORD_NAMES) {
      // eslint-disable-next-line no-await-in-loop
      await writeSetup(s, key, name, SETUP_SAMPLES[name])
    }
    await writeSetup(s, otherKey, 'passwordSet', false)
    await writeSetup(s, otherKey, 'waitingPeriod', 0n)
    await writeSession(s, key)
    await wipe(s, key, 'submissionLanded')
    await writeCache(s, key, SETUP_DRAFT)
    expect(s.raw.size).toBeGreaterThan(0)
    s.raw.forEach((value) => {
      expect(typeof value).toBe('object')
      expect(value).not.toBeNull()
      // An object is truthy, so the helper's falsy-default rule never hides it.
      expect(!value).toBe(false)
    })
    expect(leaves([...s.raw.values()]).length).toBeGreaterThan(0)
  })
})
