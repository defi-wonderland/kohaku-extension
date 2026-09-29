/**
 * @jest-environment jsdom
 *
 * The presets view mounted with the app's own components, the real en.json
 * and real records on an in-memory double of the extension's storage helper.
 * Nothing is mocked. jsdom has no `TextEncoder`, which viem reads when it
 * loads, so the test sets Node's before it loads the modules.
 */
import { createRoot, Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { TextDecoder, TextEncoder } from 'util'

import type { ThemeContextReturnType } from '@common/contexts/themeContext'
import type { ThemeProps } from '@common/styles/themeConfig'
import type { Address, SetupDraft } from '@web/modules/social-recovery/sdk-interfaces'
import type { PresetChoice, PresetId } from '@web/modules/social-recovery/setup/presets'
import type {
  Enrollment,
  RecordStorage,
  WalletRecords
} from '@web/modules/social-recovery/shared/records'

Object.assign(globalThis, { TextEncoder, TextDecoder })
// React only runs effects and state updates inside act() when this flag is set.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/* eslint-disable @typescript-eslint/no-var-requires, global-require */
const React: typeof import('react') = require('react')
const {
  parse,
  stringify
}: typeof import('@ambire-common/libs/richJson/richJson') = require('@ambire-common/libs/richJson/richJson')
const en: typeof import('@common/config/localization/translations/en.json') = require('@common/config/localization/translations/en.json')
const {
  ThemeContext
}: typeof import('@common/contexts/themeContext') = require('@common/contexts/themeContext')
const themeConfig: typeof import('@common/styles/themeConfig') = require('@common/styles/themeConfig')
const {
  addressBookOf,
  WALLET_RECOVERY_CHAIN
}: typeof import('@web/modules/social-recovery/shared/client') = require('@web/modules/social-recovery/shared/client')
const {
  createWalletRecords,
  SETUP_RECORD_NAMES
}: typeof import('@web/modules/social-recovery/shared/records') = require('@web/modules/social-recovery/shared/records')
const PresetsView: typeof import('../PresetsView').default = require('../PresetsView').default
/* eslint-enable @typescript-eslint/no-var-requires, global-require */

const CHAIN_ID = 11155111
const ACCOUNT: Address = '0x1111111111111111111111111111111111111111'
const BOOK = addressBookOf(WALLET_RECOVERY_CHAIN)
const S = en.socialRecovery

const THEME = Object.fromEntries(
  Object.entries(themeConfig.default).map(([name, byType]) => [
    name,
    byType[themeConfig.THEME_TYPES.LIGHT]
  ])
) as ThemeProps

const THEME_CONTEXT: ThemeContextReturnType = {
  theme: THEME,
  themeType: themeConfig.THEME_TYPES.LIGHT,
  selectedThemeType: themeConfig.THEME_TYPES.LIGHT,
  setThemeType: () => {}
}

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

// The words any line about a guided setup would use.
const GUIDE_ME = /guide|guided|wizard/i

describe('the presets view', () => {
  let container: HTMLDivElement
  let root: Root
  let records: WalletRecords
  let onOpenEditor: jest.Mock
  let onRecover: jest.Mock

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    records = createWalletRecords({ storage: makeStorage() })
    onOpenEditor = jest.fn()
    onRecover = jest.fn()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const setup = () => records.setup(CHAIN_ID, ACCOUNT)

  const mount = async () => {
    await act(async () => {
      root.render(
        <ThemeContext.Provider value={THEME_CONTEXT}>
          <PresetsView
            records={records}
            chainId={CHAIN_ID}
            account={ACCOUNT}
            onOpenEditor={onOpenEditor}
            onRecover={onRecover}
          />
        </ThemeContext.Provider>
      )
    })
  }

  const byTestId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`)
  const allByTestId = (id: string) =>
    Array.from(
      container.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`),
      (node) => node.textContent
    )
  const text = () => container.textContent ?? ''

  const press = async (id: string) => {
    const node = byTestId(id)
    if (!node) throw new Error(`nothing to press: ${id}`)
    await act(async () => {
      node.click()
    })
  }

  const storedDraft = async (): Promise<SetupDraft> => {
    const read = await setup().setupDraft.read()
    if (read.status !== 'present') throw new Error('no draft stored')
    return read.value
  }

  const storedStatuses = async () =>
    (await Promise.all(SETUP_RECORD_NAMES.map((name) => setup()[name].read()))).map(
      ({ status }) => status
    )

  describe('before any enrollment', () => {
    it('states the three costs in their exact words', async () => {
      await mount()
      expect(
        Array.from(byTestId('cost-lines')?.children ?? [], (line) => line.textContent)
      ).toEqual([S.costLines.save, S.costLines.recovery, S.costLines.cancel])
    })

    it('carries the honesty note in its exact words', async () => {
      await mount()
      expect(byTestId('honesty-note')?.textContent).toBe(
        'Recovery helps if you lose your key. It cannot stop someone who already has it.'
      )
    })

    it('tells a holder with one device that start from scratch builds a single-method path', async () => {
      await mount()
      expect(byTestId('preset-fromScratch')?.textContent).toContain(
        'With one device, start from scratch builds a single-method path.'
      )
    })

    it('offers customize alone, with no guided setup and no line that names it', async () => {
      await mount()
      expect(byTestId('customize')?.textContent).toBe(S.presets.customize)
      expect(text()).not.toMatch(GUIDE_ME)
    })

    it('shows the four presets and start from scratch, and the account as not set up', async () => {
      await mount()
      expect(
        ['deviceAndGuardians', 'deviceAndId', 'eitherOne', 'guardiansOnly', 'fromScratch'].map(
          (id) =>
            byTestId(`preset-${id}`)?.textContent?.startsWith(
              S.presets.cards[id as PresetChoice].name
            )
        )
      ).toEqual([true, true, true, true, true])
      expect(byTestId('recovery-status')?.textContent).toBe(S.status.recovery.notSetUp)
    })

    it('shows on each card the rule line of its shape, word for word', async () => {
      await mount()
      const lines: Record<PresetId, string> = {
        deviceAndGuardians:
          'Together with your required methods, any 2 of these 3 recover this account. Losing more than 1 locks you out.',
        deviceAndId: 'Both must answer. Losing either locks you out.',
        eitherOne: 'Either one alone can recover this account. Either one alone can also take it.',
        guardiansOnly: 'Any 2 of these 3 recover this account. Losing more than 1 locks you out.'
      }
      ;(Object.keys(lines) as PresetId[]).forEach((id) => {
        expect(allByTestId(`rule-line-${id}`)).toEqual([lines[id]])
      })
    })

    it('stores nothing and opens nothing while the holder only reads', async () => {
      await mount()
      expect(await storedStatuses()).toEqual(SETUP_RECORD_NAMES.map(() => 'absent'))
      expect(onOpenEditor).not.toHaveBeenCalled()
    })

    it('opens the recovery of another account from its own action', async () => {
      await mount()
      await press('recover')
      expect(onRecover).toHaveBeenCalledTimes(1)
      expect(onOpenEditor).not.toHaveBeenCalled()
    })
  })

  describe('a pick', () => {
    it('customize stores an empty draft and path, then opens the editor', async () => {
      await mount()
      await press('customize')
      expect((await storedDraft()).clauses).toEqual([])
      const path = await setup().path.read()
      expect(path.status === 'present' && path.value).toEqual([])
      expect(onOpenEditor).toHaveBeenCalledTimes(1)
    })

    it('start from scratch and continue store an empty draft, then open the editor', async () => {
      await mount()
      await press('preset-fromScratch')
      expect(onOpenEditor).not.toHaveBeenCalled()
      await press('continue')
      expect((await storedDraft()).clauses).toEqual([])
      expect(onOpenEditor).toHaveBeenCalledTimes(1)
    })

    it('continue does nothing until a card is picked', async () => {
      await mount()
      expect(text()).toContain(S.presets.continueUnlock)
      await press('continue')
      expect(onOpenEditor).not.toHaveBeenCalled()
      expect((await setup().setupDraft.read()).status).toBe('absent')
    })

    const SHAPES: [PresetId, number[], string[]][] = [
      ['deviceAndGuardians', [1, 2], ['passkey', 'ecdsa', 'ecdsa', 'ecdsa']],
      ['deviceAndId', [1, 1], ['passkey', 'zkpassport']],
      ['eitherOne', [1], ['passkey', 'zkpassport']],
      ['guardiansOnly', [2], ['ecdsa', 'ecdsa', 'ecdsa']]
    ]

    SHAPES.forEach(([id, thresholds, kinds]) =>
      it(`${id} and continue store its empty shape, then open the editor`, async () => {
        await mount()
        await press(`preset-${id}`)
        await press('continue')
        const draft = await storedDraft()
        expect(draft.clauses.map(({ threshold }) => threshold)).toEqual(thresholds)
        const slots = draft.clauses.flatMap(({ credentials }) => credentials)
        expect(slots.map(({ label }) => label)).toEqual(kinds)
        expect(
          slots.every(({ method, config }) => /^0x0{40}$/.test(method) && config === '0x')
        ).toBe(true)
        const path = await setup().path.read()
        expect(path.status === 'present' && path.value).toEqual(draft.clauses)
        expect(onOpenEditor).toHaveBeenCalledTimes(1)
      })
    )

    it('the last card picked is the one continue stores', async () => {
      await mount()
      await press('preset-guardiansOnly')
      await press('preset-eitherOne')
      await press('continue')
      expect((await storedDraft()).clauses.map(({ threshold }) => threshold)).toEqual([1])
    })
  })

  describe('with an unfinished draft', () => {
    const SAVED_AT = new Date(2026, 7, 12, 12, 0).getTime()

    const storeDraft = async (enrollments: Enrollment[]) => {
      records = createWalletRecords({ storage: makeStorage(), now: () => SAVED_AT })
      await setup().setupDraft.write({
        wait: 172800n,
        clauses: [],
        ignoresPause: true,
        privacy: { backup: 'encrypted', publicMetadata: '0x' }
      })
      await setup().enrollments.write(enrollments)
      await setup().waitingPeriod.write(86400n)
    }

    const ENROLLMENTS: Enrollment[] = [
      {
        credential: { method: BOOK.methods.passkey, config: '0x01' },
        test: 'passed',
        backup: 'device-bound'
      },
      { credential: { method: BOOK.methods.ecdsa, config: '0x0a' }, test: 'not-tested' },
      { credential: { method: BOOK.methods.ecdsa, config: '0x0b' }, test: 'not-tested' }
    ]

    it('shows the draft age and resume in place of the cards', async () => {
      await storeDraft(ENROLLMENTS)
      await mount()
      expect(byTestId('draft-age')?.textContent).toMatch(
        /^Your setup is unfinished\. Draft from 12 Aug.*Nothing is saved on chain until you confirm\.$/
      )
      expect(byTestId('presets-grid')).toBeNull()
      expect(byTestId('resume')?.textContent).toBe(S.presets.resume.action)
      expect(text()).toContain(S.records.startOverNote)
    })

    it('shows each enrolled row with its chip, and the guardians with their count', async () => {
      await storeDraft(ENROLLMENTS)
      await mount()
      expect(allByTestId('resume-row')).toEqual([
        'Passkey on this deviceTested',
        'Guardians2 added, not saved on chain yetNot yet active'
      ])
    })

    it('reads a synced passkey as "Passkey" with its failed test', async () => {
      await storeDraft([
        {
          credential: { method: BOOK.methods.passkey, config: '0x01' },
          test: 'failed',
          backup: 'synced'
        }
      ])
      await mount()
      expect(allByTestId('resume-row')).toEqual(['PasskeyTest failed'])
    })

    it('resume opens the editor and keeps the draft', async () => {
      await storeDraft(ENROLLMENTS)
      await mount()
      await press('resume')
      expect(onOpenEditor).toHaveBeenCalledTimes(1)
      expect((await setup().enrollments.read()).status).toBe('present')
    })

    it('start over wipes the six records and returns to the cards', async () => {
      await storeDraft(ENROLLMENTS)
      await setup().inventory.write(['passport'])
      await setup().path.write([])
      await setup().passwordSet.write('password-set')
      expect(await storedStatuses()).toEqual(SETUP_RECORD_NAMES.map(() => 'present'))
      await mount()
      await press('start-over')
      expect(await storedStatuses()).toEqual(SETUP_RECORD_NAMES.map(() => 'absent'))
      expect(byTestId('presets-resume')).toBeNull()
      expect(byTestId('presets-grid')).not.toBeNull()
      expect(onOpenEditor).not.toHaveBeenCalled()
    })
  })
})
