/**
 * @jest-environment jsdom
 */
import type { Harness, StorageFaults } from './harness'
import { ACCOUNT, CHAIN_ID, draftOf, harnessOf, recordsOn } from './harness'

/* eslint-disable @typescript-eslint/no-var-requires, global-require */
const en: typeof import('@common/config/localization/translations/en.json') = require('@common/config/localization/translations/en.json')
const {
  WEB_ROUTES
}: typeof import('@common/modules/router/constants/common') = require('@common/modules/router/constants/common')
const WaitingPeriodView: typeof import('../WaitingPeriodView').default =
  require('../WaitingPeriodView').default
/* eslint-enable @typescript-eslint/no-var-requires, global-require */

const W = en.socialRecovery.privacy.waitingPeriod
const S = en.socialRecovery

// Any line that puts the floor on the contract or the chain.
const CHAIN_FLOOR = /(contract|chain)[^.]*(reject|refuse|enforce|require|minimum|shorter)/i

describe('the waiting period step', () => {
  let h: Harness

  beforeEach(() => {
    h = harnessOf(WaitingPeriodView)
  })

  afterEach(() => {
    h.unmount()
  })

  const storedRecord = async (records: ReturnType<typeof recordsOn>) => {
    const read = await records.setup(CHAIN_ID, ACCOUNT).waitingPeriod.read()
    return read.status === 'present' ? read.value : undefined
  }

  const storedDraftWait = async (records: ReturnType<typeof recordsOn>) => {
    const read = await records.setup(CHAIN_ID, ACCOUNT).setupDraft.read()
    return read.status === 'present' ? read.value.wait : undefined
  }

  describe('the picker', () => {
    it('offers the four chips and the custom entry in their words and order', async () => {
      await h.mount(recordsOn())
      expect(
        ['hours24', 'hours48', 'hours72', 'days7', 'custom'].map(
          (id) => h.byTestId(`wait-chip-${id}`)?.textContent
        )
      ).toEqual([W.chips.hours24, W.chips.hours48, W.chips.hours72, W.chips.days7, W.custom])
    })

    const LENGTHS: [string, bigint][] = [
      ['hours24', 86400n],
      ['hours48', 172800n],
      ['hours72', 259200n],
      ['days7', 604800n]
    ]

    LENGTHS.forEach(([id, seconds]) =>
      it(`stores the ${id} chip as ${seconds} seconds`, async () => {
        const records = recordsOn()
        await h.mount(records)
        await h.press(`wait-chip-${id}`)
        await h.press('continue')
        expect(await storedRecord(records)).toBe(seconds)
      })
    )

    it('shows no field for the custom entry until custom is picked', async () => {
      await h.mount(recordsOn())
      expect(h.inputOf('wait-custom-hours')).toBeNull()
      await h.press('wait-chip-custom')
      expect(h.inputOf('wait-custom-hours')).not.toBeNull()
    })

    it('accepts a custom entry of 24 hours and stores it in seconds', async () => {
      const records = recordsOn()
      await h.mount(records)
      await h.press('wait-chip-custom')
      await h.type('wait-custom-hours', '24')
      expect(h.byTestId('wait-refusal')).toBeNull()
      expect(h.isDisabled('continue')).toBe(false)
      await h.press('continue')
      expect(await storedRecord(records)).toBe(86400n)
    })

    it('refuses 23 hours with the wallet floor and stores nothing', async () => {
      const records = recordsOn()
      await h.mount(records)
      await h.press('wait-chip-custom')
      await h.type('wait-custom-hours', '23')
      expect(h.byTestId('wait-refusal')?.textContent).toBe('This wallet needs 24 hours or more.')
      expect(h.isDisabled('continue')).toBe(true)
      await h.press('continue')
      expect(await storedRecord(records)).toBeUndefined()
      expect(h.navigate).not.toHaveBeenCalled()
    })

    it('accepts the ceiling of 2160 hours', async () => {
      const records = recordsOn()
      await h.mount(records)
      await h.press('wait-chip-custom')
      await h.type('wait-custom-hours', '2160')
      expect(h.byTestId('wait-refusal')).toBeNull()
      await h.press('continue')
      expect(await storedRecord(records)).toBe(2160n * 3600n)
    })

    it('refuses 2161 hours with the ceiling line that names 2160, and stores nothing', async () => {
      const records = recordsOn()
      await h.mount(records)
      await h.press('wait-chip-custom')
      await h.type('wait-custom-hours', '2161')
      expect(h.byTestId('wait-refusal')?.textContent).toBe(
        'This wallet cannot save a waiting period this long. The longest it accepts is 2160 hours.'
      )
      expect(h.isDisabled('continue')).toBe(true)
      await h.press('continue')
      expect(await storedRecord(records)).toBeUndefined()
    })

    it('refuses a length past any field width at the ceiling, before it reaches storage', async () => {
      const records = recordsOn()
      await h.mount(records)
      await h.press('wait-chip-custom')
      await h.type('wait-custom-hours', '9'.repeat(80))
      expect(h.byTestId('wait-refusal')?.textContent).toContain('2160 hours')
      await h.press('continue')
      expect(await storedRecord(records)).toBeUndefined()
      expect(h.navigate).not.toHaveBeenCalled()
    })

    it('keeps the digits of what is typed and refuses a shorter wait typed with a unit', async () => {
      await h.mount(recordsOn())
      await h.press('wait-chip-custom')
      await h.type('wait-custom-hours', '6h')
      expect(h.inputOf('wait-custom-hours')?.value).toBe('6')
      expect(h.byTestId('wait-refusal')?.textContent).toBe(W.belowMinimum)
    })

    it('holds continue while the custom entry is empty', async () => {
      await h.mount(recordsOn())
      await h.press('wait-chip-custom')
      expect(h.byTestId('wait-refusal')).toBeNull()
      expect(h.isDisabled('continue')).toBe(true)
    })

    it('never says the contract or the chain rejects a shorter wait', async () => {
      await h.mount(recordsOn())
      expect(h.text()).not.toMatch(CHAIN_FLOOR)
      await h.press('wait-chip-custom')
      await h.type('wait-custom-hours', '6')
      expect(h.byTestId('wait-refusal')).not.toBeNull()
      expect(h.text()).not.toMatch(CHAIN_FLOOR)
      await h.type('wait-custom-hours', '5000')
      expect(h.byTestId('wait-refusal')).not.toBeNull()
      expect(h.text()).not.toMatch(CHAIN_FLOOR)
    })
  })

  describe('the default and a stored length', () => {
    it("with a draft and no record pre-selects the draft's wait and stores it in both", async () => {
      const records = recordsOn()
      await records.setup(CHAIN_ID, ACCOUNT).setupDraft.write(draftOf({ wait: 86400n }))
      await h.mount(records)
      await h.press('continue')
      expect(await storedRecord(records)).toBe(86400n)
      expect(await storedDraftWait(records)).toBe(86400n)
    })

    it("pre-selects the draft's wait over a record that disagrees", async () => {
      const records = recordsOn()
      const setup = records.setup(CHAIN_ID, ACCOUNT)
      await setup.waitingPeriod.write(604800n)
      await setup.setupDraft.write(draftOf({ wait: 259200n }))
      await h.mount(records)
      await h.press('continue')
      expect(await storedRecord(records)).toBe(259200n)
      expect(await storedDraftWait(records)).toBe(259200n)
    })

    it('keeps the rest of the draft as it was', async () => {
      const records = recordsOn()
      const draft = draftOf({
        wait: 86400n,
        ignoresPause: false,
        privacy: { backup: 'clear', publicMetadata: '0xabcd' }
      })
      await records.setup(CHAIN_ID, ACCOUNT).setupDraft.write(draft)
      await h.mount(records)
      await h.press('wait-chip-hours72')
      await h.press('continue')
      const read = await records.setup(CHAIN_ID, ACCOUNT).setupDraft.read()
      expect(read.status === 'present' && read.value).toEqual({ ...draft, wait: 259200n })
    })

    it('with no draft stores the record alone', async () => {
      const records = recordsOn()
      await h.mount(records)
      await h.press('continue')
      expect(await storedRecord(records)).toBe(172800n)
      expect(await storedDraftWait(records)).toBeUndefined()
    })

    it('pre-selects the chip of a stored record', async () => {
      const records = recordsOn()
      await records.setup(CHAIN_ID, ACCOUNT).waitingPeriod.write(604800n)
      await h.mount(records)
      expect(h.inputOf('wait-custom-hours')).toBeNull()
      await h.press('continue')
      expect(await storedRecord(records)).toBe(604800n)
    })

    it('pre-fills the custom entry with a stored length no chip holds', async () => {
      const records = recordsOn()
      await records.setup(CHAIN_ID, ACCOUNT).waitingPeriod.write(30n * 3600n)
      await h.mount(records)
      expect(h.inputOf('wait-custom-hours')?.value).toBe('30')
      await h.press('continue')
      expect(await storedRecord(records)).toBe(30n * 3600n)
    })

    it('falls back to 48 hours for a stored length the picker refuses', async () => {
      const records = recordsOn()
      await records.setup(CHAIN_ID, ACCOUNT).waitingPeriod.write(3600n)
      await h.mount(records)
      expect(h.inputOf('wait-custom-hours')).toBeNull()
      await h.press('continue')
      expect(await storedRecord(records)).toBe(172800n)
    })
  })

  describe('what the wait is for', () => {
    it('states the notice window, that nothing else watches and what the cancel costs', async () => {
      await h.mount(recordsOn())
      expect(h.byTestId('notice-window')?.textContent).toBe(
        'The waiting period is your whole notice window. Open the wallet during the wait to see the banner for a recovery you did not start.'
      )
      expect(h.text()).toContain(
        'Until you install Kohaku on another device, nothing else watches this account.'
      )
      expect(h.byTestId('cancel-cost')?.textContent).toBe(
        "Cancelling a recovery is one transaction your account's key sends and pays for. That key needs gas it holds outside the account."
      )
    })

    it('states the floor and the default as the wallet rule', async () => {
      await h.mount(recordsOn())
      expect(h.text()).toContain(W.minimumDefault)
    })
  })

  describe('navigation', () => {
    it('back returns to the editor and stores nothing', async () => {
      const records = recordsOn()
      await h.mount(records)
      await h.press('back')
      expect(h.navigate).toHaveBeenCalledWith(WEB_ROUTES.socialRecoverySetupEditor)
      expect(await storedRecord(records)).toBeUndefined()
    })

    it('continue opens the privacy step once the length is stored', async () => {
      await h.mount(recordsOn())
      await h.press('continue')
      expect(h.navigate).toHaveBeenCalledTimes(1)
      expect(h.navigate).toHaveBeenCalledWith(WEB_ROUTES.socialRecoverySetupPrivacy)
    })
  })

  describe('a storage failure', () => {
    it('a refused write shows its line, stays on the step and leaves continue usable', async () => {
      const records = recordsOn({ set: 1 })
      await h.mount(records)
      await h.press('continue')
      expect(h.byTestId('write-failed')?.textContent).toBe(S.records.writeFailed)
      expect(h.navigate).not.toHaveBeenCalled()
      expect(h.isDisabled('continue')).toBe(false)
      expect(await storedRecord(records)).toBeUndefined()
    })

    it('the next continue that stores clears the line and moves on', async () => {
      const records = recordsOn({ set: 1 })
      await h.mount(records)
      await h.press('continue')
      await h.press('continue')
      expect(h.byTestId('write-failed')).toBeNull()
      expect(await storedRecord(records)).toBe(172800n)
      expect(h.navigate).toHaveBeenCalledWith(WEB_ROUTES.socialRecoverySetupPrivacy)
    })

    const withDraftAndRecord = async (faults: StorageFaults) => {
      const records = recordsOn(faults)
      const setup = records.setup(CHAIN_ID, ACCOUNT)
      await setup.setupDraft.write(draftOf({ wait: 259200n }))
      await setup.waitingPeriod.write(259200n)
      return records
    }

    it('a refused record after the draft took the new wait puts the earlier wait back in the draft', async () => {
      const faults: StorageFaults = {}
      const records = await withDraftAndRecord(faults)
      await h.mount(records)
      await h.press('wait-chip-hours24')
      faults.records = ['waitingPeriod']
      await h.press('continue')
      expect(h.byTestId('write-failed')?.textContent).toBe(S.records.writeFailed)
      expect(h.navigate).not.toHaveBeenCalled()
      expect(await storedDraftWait(records)).toBe(259200n)
      expect(await storedRecord(records)).toBe(259200n)
    })

    it('a refused draft leaves the record at the earlier wait', async () => {
      const faults: StorageFaults = {}
      const records = await withDraftAndRecord(faults)
      await h.mount(records)
      await h.press('wait-chip-hours24')
      faults.records = ['setupDraft']
      await h.press('continue')
      expect(h.byTestId('write-failed')?.textContent).toBe(S.records.writeFailed)
      expect(h.navigate).not.toHaveBeenCalled()
      expect(await storedDraftWait(records)).toBe(259200n)
      expect(await storedRecord(records)).toBe(259200n)
    })

    it('a failed read shows its line', async () => {
      await h.mount(recordsOn({ get: true }))
      expect(h.byTestId('load-failed')?.textContent).toBe(S.records.loadFailed)
    })
  })
})
