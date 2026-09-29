/**
 * @jest-environment jsdom
 */
import type { Clause, Credential } from '@web/modules/social-recovery/sdk-interfaces'
import type { WalletRecords } from '@web/modules/social-recovery/shared/records'

import type { Harness, StorageFaults } from './harness'
import { ACCOUNT, CHAIN_ID, draftOf, harnessOf, recordsOn } from './harness'

/* eslint-disable @typescript-eslint/no-var-requires, global-require */
const en: typeof import('@common/config/localization/translations/en.json') = require('@common/config/localization/translations/en.json')
const {
  WEB_ROUTES
}: typeof import('@common/modules/router/constants/common') = require('@common/modules/router/constants/common')
const {
  addressBookOf,
  WALLET_RECOVERY_CHAIN
}: typeof import('@web/modules/social-recovery/shared/client') = require('@web/modules/social-recovery/shared/client')
const {
  PASSWORD_SET,
  readRecoveryPassword,
  setRecoveryPassword,
  wipeRecoveryPassword
}: typeof import('@web/modules/social-recovery/shared/records') = require('@web/modules/social-recovery/shared/records')
const PrivacyView: typeof import('../PrivacyView').default = require('../PrivacyView').default
/* eslint-enable @typescript-eslint/no-var-requires, global-require */

const L = en.socialRecovery.privacy.level
const S = en.socialRecovery
const BOOK = addressBookOf(WALLET_RECOVERY_CHAIN)
const ZERO = '0x0000000000000000000000000000000000000000'

// Any line claiming a level hides that a setup exists.
const HIDES_EXISTENCE = /nobody can see|hides that|no one can see|nobody knows/i

const slot = (kind: string): Credential => ({ method: ZERO, config: '0x', label: kind })
const guardian: Credential = { method: BOOK.methods.ecdsa, config: '0x0a' }
const passkey: Credential = { method: BOOK.methods.passkey, config: '0x01' }
const passport: Credential = { method: BOOK.methods.zkpassport, config: '0x02' }
const aadhaar: Credential = { method: BOOK.methods.aadhaar, config: '0x03' }

const PASSKEY_AND_PASSPORT: Clause[] = [{ threshold: 1, credentials: [passkey, passport] }]
const GUARDIAN_SLOTS_BESIDE_PASSKEY_AND_PASSPORT: Clause[] = [
  { threshold: 1, credentials: [passkey] },
  { threshold: 2, credentials: [slot('ecdsa'), slot('ecdsa'), slot('zkpassport')] }
]
const ENROLLED_GUARDIAN_BESIDE_PASSKEY_AND_PASSPORT: Clause[] = [
  { threshold: 2, credentials: [passkey, guardian, passport] }
]

describe('the privacy step', () => {
  let h: Harness

  beforeEach(() => {
    h = harnessOf(PrivacyView)
    wipeRecoveryPassword(CHAIN_ID, ACCOUNT)
  })

  afterEach(() => {
    h.unmount()
    wipeRecoveryPassword(CHAIN_ID, ACCOUNT)
  })

  const withDraft = async (overrides: Parameters<typeof draftOf>[0] = {}) => {
    const records = recordsOn()
    await records.setup(CHAIN_ID, ACCOUNT).setupDraft.write(draftOf(overrides))
    return records
  }

  const storedDraft = async (records: WalletRecords) => {
    const read = await records.setup(CHAIN_ID, ACCOUNT).setupDraft.read()
    if (read.status !== 'present') throw new Error('no draft stored')
    return read.value
  }

  const flagOf = async (records: WalletRecords) => {
    const read = await records.setup(CHAIN_ID, ACCOUNT).passwordSet.read()
    return read.status === 'present' ? read.value : undefined
  }

  const typePasswords = async (password: string, confirmation: string) => {
    await h.type('password', password)
    await h.type('password-confirmation', confirmation)
  }

  describe('the levels', () => {
    it('offers two radios, Private then Public, each with its exact line', async () => {
      await h.mount(recordsOn())
      const radios = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="privacy-screen"] [role="radio"]')
      )
      expect(radios.map((radio) => radio.getAttribute('data-testid'))).toEqual([
        'level-private',
        'level-public'
      ])
      expect(h.byTestId('level-line-private')?.textContent).toBe(
        'A stranger sees that this account has a recovery setup and nothing of what it is until a recovery runs, which publishes the whole rule on chain in the clear.'
      )
      expect(h.byTestId('level-line-public')?.textContent).toBe(
        'Everything is readable by anyone. No password is set and the card carries only the address.'
      )
      expect(h.byTestId('level-private')?.textContent).toContain(L.private.badge)
    })

    it('opens at Private, with the recovery password asked and no public line', async () => {
      await h.mount(recordsOn())
      expect(h.inputOf('password')).not.toBeNull()
      expect(h.inputOf('password-confirmation')).not.toBeNull()
      expect(h.byTestId('public-line')).toBeNull()
    })

    it('opens at Public for a draft stored in the clear', async () => {
      await h.mount(await withDraft({ privacy: { backup: 'clear', publicMetadata: '0x' } }))
      expect(h.inputOf('password')).toBeNull()
      expect(h.byTestId('public-line')).not.toBeNull()
    })

    it('never claims a level hides that a setup exists', async () => {
      await h.mount(await withDraft({ clauses: GUARDIAN_SLOTS_BESIDE_PASSKEY_AND_PASSPORT }))
      expect(h.text()).not.toMatch(HIDES_EXISTENCE)
      await h.press('level-public')
      expect(h.text()).not.toMatch(HIDES_EXISTENCE)
    })
  })

  describe('the exposure line', () => {
    const GUARDIANS =
      'Every guardian of your path is hidden from a stranger who cannot guess their address.'
    const PUBLICATION =
      'A recovery publishes the rule with its waiting period and every method in it, so every method of your path is exposed, the ones it used and the ones it did not.'
    const UNGUESSABLE =
      'Your passkey and your passport cannot be guessed at all and lose nothing before a recovery.'

    it('a path with guardian slots carries the guardian half and names the passkey and the passport', async () => {
      await h.mount(await withDraft({ clauses: GUARDIAN_SLOTS_BESIDE_PASSKEY_AND_PASSPORT }))
      expect(h.byTestId('exposure-guardians')?.textContent).toBe(GUARDIANS)
      expect(h.byTestId('exposure-unguessable')?.textContent).toBe(UNGUESSABLE)
      expect(h.byTestId('exposure-publication')?.textContent).toBe(PUBLICATION)
    })

    it('a path with an enrolled guardian carries the guardian half', async () => {
      await h.mount(await withDraft({ clauses: ENROLLED_GUARDIAN_BESIDE_PASSKEY_AND_PASSPORT }))
      expect(h.byTestId('exposure-guardians')?.textContent).toBe(GUARDIANS)
      expect(h.byTestId('exposure-unguessable')?.textContent).toBe(UNGUESSABLE)
    })

    it('a guardian beside an Aadhaar identity names the Aadhaar identity alone', async () => {
      await h.mount(await withDraft({ clauses: [{ threshold: 2, credentials: [guardian, aadhaar] }] }))
      expect(h.byTestId('exposure-guardians')?.textContent).toBe(GUARDIANS)
      expect(h.byTestId('exposure-unguessable')?.textContent).toBe(
        'Your Aadhaar identity cannot be guessed at all and lose nothing before a recovery.'
      )
    })

    it('a passkey, a passport and an Aadhaar slot beside a guardian are named as three', async () => {
      await h.mount(
        await withDraft({
          clauses: [
            { threshold: 1, credentials: [passkey] },
            { threshold: 2, credentials: [slot('ecdsa'), passport, slot('aadhaar')] }
          ]
        })
      )
      expect(h.byTestId('exposure-unguessable')?.textContent).toBe(
        'Your passkey, your passport and your Aadhaar identity cannot be guessed at all and lose nothing before a recovery.'
      )
    })

    it('a guardians-only path carries the guardian half and no unguessable line', async () => {
      await h.mount(
        await withDraft({ clauses: [{ threshold: 2, credentials: [guardian, slot('ecdsa')] }] })
      )
      expect(h.byTestId('exposure-guardians')?.textContent).toBe(GUARDIANS)
      expect(h.byTestId('exposure-unguessable')).toBeNull()
    })

    it('a passkey-and-passport path carries the publication half alone', async () => {
      await h.mount(await withDraft({ clauses: PASSKEY_AND_PASSPORT }))
      expect(h.byTestId('exposure-guardians')).toBeNull()
      expect(h.byTestId('exposure-unguessable')).toBeNull()
      expect(h.byTestId('exposure-publication')?.textContent).toBe(PUBLICATION)
    })

    it('a guardian path carries both halves at Private and the publication half alone at Public', async () => {
      await h.mount(await withDraft({ clauses: ENROLLED_GUARDIAN_BESIDE_PASSKEY_AND_PASSPORT }))
      expect(h.byTestId('exposure-guardians')?.textContent).toBe(GUARDIANS)
      expect(h.byTestId('exposure-publication')?.textContent).toBe(PUBLICATION)
      await h.press('level-public')
      expect(h.byTestId('exposure-guardians')).toBeNull()
      expect(h.byTestId('exposure-unguessable')).toBeNull()
      expect(h.byTestId('exposure-publication')?.textContent).toBe(PUBLICATION)
      await h.press('level-private')
      expect(h.byTestId('exposure-guardians')?.textContent).toBe(GUARDIANS)
      expect(h.byTestId('exposure-unguessable')?.textContent).toBe(UNGUESSABLE)
    })

    it('a guardian path stored in the clear opens with the publication half alone', async () => {
      await h.mount(
        await withDraft({
          clauses: GUARDIAN_SLOTS_BESIDE_PASSKEY_AND_PASSPORT,
          privacy: { backup: 'clear', publicMetadata: '0x' }
        })
      )
      expect(h.byTestId('exposure-guardians')).toBeNull()
      expect(h.byTestId('exposure-publication')?.textContent).toBe(PUBLICATION)
    })

    it('carries the publication half with no draft and at Public', async () => {
      await h.mount(recordsOn())
      expect(h.byTestId('exposure-publication')?.textContent).toBe(PUBLICATION)
      await h.press('level-public')
      expect(h.byTestId('exposure-publication')?.textContent).toBe(PUBLICATION)
    })
  })

  describe('at Private', () => {
    it('asks the recovery password twice beside both halves of the trade', async () => {
      await h.mount(recordsOn())
      const field = h.byTestId('recovery-password')
      expect(field?.querySelectorAll('input')).toHaveLength(2)
      expect(h.byTestId('trade-card')?.textContent).toBe(
        'Anyone holding the Recovery Card can read the recovery path and still cannot recover.'
      )
      expect(h.byTestId('trade-loss')?.textContent).toBe(
        'Lose both the card and the password and a fresh device cannot begin a recovery.'
      )
    })

    it('names the field the recovery password, never the extension password', async () => {
      await h.mount(recordsOn())
      const field = h.byTestId('recovery-password')?.textContent ?? ''
      expect(field).toContain(S.display.passwords.recoveryPassword)
      expect(field).not.toContain(S.display.passwords.extensionPassword)
      expect(h.text()).not.toContain(S.display.passwords.extensionPassword)
    })

    it('holds continue until the password is typed twice', async () => {
      await h.mount(recordsOn())
      expect(h.isDisabled('continue')).toBe(true)
      await h.type('password', 'correct horse')
      expect(h.isDisabled('continue')).toBe(true)
      await h.type('password-confirmation', 'correct horse')
      expect(h.isDisabled('continue')).toBe(false)
    })

    it('a mismatch shows its line, holds continue and stores nothing', async () => {
      const records = await withDraft()
      await h.mount(records)
      await typePasswords('correct horse', 'correct horsf')
      expect(h.byTestId('mismatch')?.textContent).toBe(
        'The two recovery passwords you typed do not match.'
      )
      expect(h.isDisabled('continue')).toBe(true)
      await h.press('continue')
      expect(h.navigate).not.toHaveBeenCalled()
      expect(await flagOf(records)).toBeUndefined()
      expect(readRecoveryPassword(CHAIN_ID, ACCOUNT)).toBeUndefined()
    })

    it('continue stores the flag, holds the password and keeps the draft encrypted', async () => {
      const records = await withDraft({
        privacy: { backup: 'encrypted', publicMetadata: '0xabcd' }
      })
      await h.mount(records)
      await typePasswords('correct horse', 'correct horse')
      await h.press('continue')
      expect(await flagOf(records)).toBe(PASSWORD_SET)
      expect(readRecoveryPassword(CHAIN_ID, ACCOUNT)).toBe('correct horse')
      expect((await storedDraft(records)).privacy).toEqual({
        backup: 'encrypted',
        publicMetadata: '0xabcd'
      })
    })

    it('never writes the password into storage', async () => {
      const records = await withDraft()
      await h.mount(records)
      await typePasswords('correct horse', 'correct horse')
      await h.press('continue')
      const setup = records.setup(CHAIN_ID, ACCOUNT)
      const stored = await Promise.all([setup.setupDraft.read(), setup.passwordSet.read()])
      expect(
        JSON.stringify(stored, (_, value) => (typeof value === 'bigint' ? String(value) : value))
      ).not.toContain('correct horse')
    })

    it('moving from Public back to Private stores the draft encrypted again', async () => {
      const records = await withDraft({ privacy: { backup: 'clear', publicMetadata: '0x' } })
      await h.mount(records)
      await h.press('level-private')
      await typePasswords('correct horse', 'correct horse')
      await h.press('continue')
      expect((await storedDraft(records)).privacy.backup).toBe('encrypted')
      expect(await flagOf(records)).toBe(PASSWORD_SET)
    })

    it('fills both fields with the password this tab already holds', async () => {
      setRecoveryPassword(CHAIN_ID, ACCOUNT, 'held before')
      await h.mount(recordsOn())
      expect(h.inputOf('password')?.value).toBe('held before')
      expect(h.inputOf('password-confirmation')?.value).toBe('held before')
      expect(h.isDisabled('continue')).toBe(false)
    })
  })

  describe('at Public', () => {
    it('renders no password field and its own line', async () => {
      await h.mount(recordsOn())
      await h.press('level-public')
      expect(h.byTestId('recovery-password')).toBeNull()
      expect(document.querySelector('[data-testid="privacy-screen"] input')).toBeNull()
      expect(h.byTestId('public-line')?.textContent).toBe(
        'No password is set. A fresh device rebuilds the setup from the chain alone, and the card carries only the address.'
      )
      expect(h.byTestId('mismatch')).toBeNull()
      expect(h.isDisabled('continue')).toBe(false)
    })

    it('continue wipes the flag and the held password and stores the draft in the clear', async () => {
      const records = await withDraft({
        privacy: { backup: 'encrypted', publicMetadata: '0xabcd' }
      })
      await records.setup(CHAIN_ID, ACCOUNT).passwordSet.write(PASSWORD_SET)
      setRecoveryPassword(CHAIN_ID, ACCOUNT, 'held before')
      await h.mount(records)
      await h.press('level-public')
      await h.press('continue')
      expect(await flagOf(records)).toBeUndefined()
      expect(readRecoveryPassword(CHAIN_ID, ACCOUNT)).toBeUndefined()
      expect((await storedDraft(records)).privacy).toEqual({
        backup: 'clear',
        publicMetadata: '0xabcd'
      })
    })
  })

  describe('navigation', () => {
    it('back returns to the waiting period and stores nothing', async () => {
      const records = await withDraft()
      await h.mount(records)
      await typePasswords('correct horse', 'correct horse')
      await h.press('back')
      expect(h.navigate).toHaveBeenCalledWith(WEB_ROUTES.socialRecoverySetupWaitingPeriod)
      expect(await flagOf(records)).toBeUndefined()
      expect(readRecoveryPassword(CHAIN_ID, ACCOUNT)).toBeUndefined()
    })

    it('continue opens the review once the level is stored', async () => {
      await h.mount(recordsOn())
      await h.press('level-public')
      await h.press('continue')
      expect(h.navigate).toHaveBeenCalledTimes(1)
      expect(h.navigate).toHaveBeenCalledWith(WEB_ROUTES.socialRecoverySetupReview)
    })
  })

  describe('a storage failure', () => {
    it('a refused write shows its line, stays on the step and leaves the held password as it was', async () => {
      setRecoveryPassword(CHAIN_ID, ACCOUNT, 'held before')
      const records = recordsOn({ set: 1 })
      await h.mount(records)
      await typePasswords('typed now', 'typed now')
      await h.press('continue')
      expect(h.byTestId('write-failed')?.textContent).toBe(S.records.writeFailed)
      expect(h.navigate).not.toHaveBeenCalled()
      expect(readRecoveryPassword(CHAIN_ID, ACCOUNT)).toBe('held before')
      expect(await flagOf(records)).toBeUndefined()
      expect(h.isDisabled('continue')).toBe(false)
    })

    it('a refused draft write leaves the flag and the held password as they were', async () => {
      const faults = { set: 0 }
      const records = recordsOn(faults)
      await records.setup(CHAIN_ID, ACCOUNT).setupDraft.write(draftOf())
      setRecoveryPassword(CHAIN_ID, ACCOUNT, 'held before')
      faults.set = 1
      await h.mount(records)
      await typePasswords('typed now', 'typed now')
      await h.press('continue')
      expect(h.byTestId('write-failed')?.textContent).toBe(S.records.writeFailed)
      expect(readRecoveryPassword(CHAIN_ID, ACCOUNT)).toBe('held before')
      expect(await flagOf(records)).toBeUndefined()
      expect((await storedDraft(records)).privacy.backup).toBe('encrypted')
    })

    it('a refused wipe at Public leaves the held password as it was', async () => {
      const faults = { remove: false }
      const records = recordsOn(faults)
      await records.setup(CHAIN_ID, ACCOUNT).passwordSet.write(PASSWORD_SET)
      setRecoveryPassword(CHAIN_ID, ACCOUNT, 'held before')
      faults.remove = true
      await h.mount(records)
      await h.press('level-public')
      await h.press('continue')
      expect(h.byTestId('write-failed')?.textContent).toBe(S.records.writeFailed)
      expect(readRecoveryPassword(CHAIN_ID, ACCOUNT)).toBe('held before')
      expect(await flagOf(records)).toBe(PASSWORD_SET)
    })

    it('a refused flag at Private puts the draft back in the clear', async () => {
      const faults: StorageFaults = {}
      const records = recordsOn(faults)
      await records
        .setup(CHAIN_ID, ACCOUNT)
        .setupDraft.write(draftOf({ privacy: { backup: 'clear', publicMetadata: '0x' } }))
      await h.mount(records)
      await h.press('level-private')
      await typePasswords('typed now', 'typed now')
      faults.records = ['passwordSet']
      await h.press('continue')
      expect(h.byTestId('write-failed')?.textContent).toBe(S.records.writeFailed)
      expect((await storedDraft(records)).privacy.backup).toBe('clear')
      expect(await flagOf(records)).toBeUndefined()
      expect(readRecoveryPassword(CHAIN_ID, ACCOUNT)).toBeUndefined()
    })

    it('a refused wipe at Public puts the draft back encrypted', async () => {
      const faults: StorageFaults = {}
      const records = recordsOn(faults)
      const setup = records.setup(CHAIN_ID, ACCOUNT)
      await setup.setupDraft.write(draftOf())
      await setup.passwordSet.write(PASSWORD_SET)
      setRecoveryPassword(CHAIN_ID, ACCOUNT, 'held before')
      await h.mount(records)
      await h.press('level-public')
      faults.records = ['passwordSet']
      await h.press('continue')
      expect(h.byTestId('write-failed')?.textContent).toBe(S.records.writeFailed)
      expect((await storedDraft(records)).privacy.backup).toBe('encrypted')
      expect(await flagOf(records)).toBe(PASSWORD_SET)
      expect(readRecoveryPassword(CHAIN_ID, ACCOUNT)).toBe('held before')
    })

    it('the next continue that stores clears the line and moves on', async () => {
      const records = recordsOn({ set: 1 })
      await h.mount(records)
      await typePasswords('typed now', 'typed now')
      await h.press('continue')
      await h.press('continue')
      expect(h.byTestId('write-failed')).toBeNull()
      expect(readRecoveryPassword(CHAIN_ID, ACCOUNT)).toBe('typed now')
      expect(h.navigate).toHaveBeenCalledWith(WEB_ROUTES.socialRecoverySetupReview)
    })

    it('a failed read shows its line, holds continue and stores nothing once storage is back', async () => {
      const faults: StorageFaults = { get: true }
      const records = recordsOn(faults)
      await h.mount(records)
      expect(h.byTestId('load-failed')?.textContent).toBe(S.records.loadFailed)
      await typePasswords('typed now', 'typed now')
      expect(h.isDisabled('continue')).toBe(true)
      await h.press('level-public')
      expect(h.isDisabled('continue')).toBe(true)
      faults.get = false
      await h.press('continue')
      expect(h.navigate).not.toHaveBeenCalled()
      expect(await flagOf(records)).toBeUndefined()
      expect(readRecoveryPassword(CHAIN_ID, ACCOUNT)).toBeUndefined()
    })
  })
})
