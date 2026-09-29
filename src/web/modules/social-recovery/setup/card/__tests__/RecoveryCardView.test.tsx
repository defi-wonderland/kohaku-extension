/**
 * @jest-environment jsdom
 *
 * The card view mounted with the app's own components and the real en.json,
 * with fake carriers and a fake extension password ask passed as props.
 * Nothing is mocked. jsdom has no `TextEncoder`, which viem reads when it
 * loads, so the test sets Node's before it loads the modules.
 */
import { createRoot, Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { TextDecoder, TextEncoder } from 'util'

import type { ThemeContextReturnType } from '@common/contexts/themeContext'
import type { ThemeProps } from '@common/styles/themeConfig'
import type { Address } from '@web/modules/social-recovery/sdk-interfaces'
import type {
  CardFile,
  CardLevel,
  PasswordAskAnswer
} from '@web/modules/social-recovery/setup/card'

Object.assign(globalThis, { TextEncoder, TextDecoder })
// React only runs effects and state updates inside act() when this flag is set.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/* eslint-disable @typescript-eslint/no-var-requires, global-require */
const React: typeof import('react') = require('react')
const en: typeof import('@common/config/localization/translations/en.json') = require('@common/config/localization/translations/en.json')
const {
  ThemeContext
}: typeof import('@common/contexts/themeContext') = require('@common/contexts/themeContext')
const themeConfig: typeof import('@common/styles/themeConfig') = require('@common/styles/themeConfig')
const RecoveryCardView: typeof import('../RecoveryCardView').default =
  require('../RecoveryCardView').default
/* eslint-enable @typescript-eslint/no-var-requires, global-require */

// Given in lower case; the card shows its checksummed form.
const ACCOUNT = '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed' as Address
const CHECKSUMMED = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
const PASSWORD = 'tide<lantern>&"orchid\'s'
const S = en.socialRecovery
const LINES = [
  S.card.lines.guide,
  S.card.lines.cannotMoveFunds,
  S.card.lines.keepAway,
  S.card.lines.photograph
]

// What a card must never name: a method, a threshold, a waiting period.
const METHOD_NAMES = Object.values(S.methodNames).map((name) => name.toLowerCase())
const METHOD_WORDS =
  /passkey|passport|guardian|aadhaar|e-?mail|hardware key|\bzk|signer|authenticator/i
const THRESHOLD_WORDS =
  /threshold|\b\d+\s+of\s+\d+\b|\bany\s+\d+\b|\bboth\b|\beither\b|quorum|must answer/i
const WAITING_WORDS = /waiting|\bdelay|timelock|\b\d+\s*(?:minute|hour|day|week|month)s?\b/i
const ADDRESSES = /0x[0-9a-fA-F]{40}/g

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

describe('the recovery card view', () => {
  let container: HTMLDivElement
  let root: Root
  let files: CardFile[]
  let printed: { printView: boolean; printCardText: string; printCss: string }[]
  let onCarried: jest.Mock
  let onBack: jest.Mock
  let onContinue: jest.Mock

  const download = (file: CardFile) => {
    files.push(file)
  }
  const print = () => {
    const printView = document.querySelector<HTMLElement>('[data-testid="print-view"]')
    printed.push({
      printView: !!printView && printView.parentElement === document.body,
      printCardText:
        document.querySelector<HTMLElement>('[data-testid="print-card"]')?.textContent ?? '',
      printCss: printView?.querySelector('style')?.textContent ?? ''
    })
  }

  // The ask the screen fills with the keystore's unlock, reduced to its two answers.
  const renderPasswordAsk = ({ onConfirmed, onCancel }: PasswordAskAnswer) => (
    <div>
      <button type="button" data-testid="ask-confirm" onClick={onConfirmed}>
        confirm
      </button>
      <button type="button" data-testid="ask-cancel" onClick={onCancel}>
        cancel
      </button>
    </div>
  )

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    files = []
    printed = []
    onCarried = jest.fn()
    onBack = jest.fn()
    onContinue = jest.fn()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  // A password left out of the options is the one held; `null` is none held.
  const mount = async ({
    level = 'hidden',
    password = PASSWORD,
    carriedBefore = false
  }: { level?: CardLevel; password?: string | null; carriedBefore?: boolean } = {}) => {
    await act(async () => {
      root.render(
        <ThemeContext.Provider value={THEME_CONTEXT}>
          <RecoveryCardView
            account={ACCOUNT}
            level={level}
            password={password ?? undefined}
            carriedBefore={carriedBefore}
            onCarried={onCarried}
            carriers={{ download, print }}
            renderPasswordAsk={renderPasswordAsk}
            onBack={onBack}
            onContinue={onContinue}
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
  const cardText = () => byTestId('recovery-card')?.textContent ?? ''
  const isDisabled = (id: string) => byTestId(id)?.getAttribute('aria-disabled') === 'true'

  const press = async (id: string) => {
    const node = byTestId(id)
    if (!node) throw new Error(`nothing to press: ${id}`)
    await act(async () => {
      node.click()
    })
  }

  // The file's card as its rows read: each label with its value, then each line.
  const fileRows = (file: CardFile) => {
    const page = new DOMParser().parseFromString(file.text, 'text/html')
    return {
      values: Array.from(page.querySelectorAll('.card .value'), (row) => [
        row.querySelector('.label')?.textContent,
        row.querySelector('.mono')?.textContent
      ]),
      lines: Array.from(page.querySelectorAll('.card p'), (line) => line.textContent),
      text: page.body.textContent ?? ''
    }
  }

  const expectNamesNothingToPhish = (text: string) => {
    METHOD_NAMES.forEach((name) => expect(text.toLowerCase()).not.toContain(name))
    expect(text).not.toMatch(METHOD_WORDS)
    expect(text).not.toMatch(THRESHOLD_WORDS)
    expect(text).not.toMatch(WAITING_WORDS)
    expect(text.match(ADDRESSES)).toEqual([CHECKSUMMED])
  }

  describe('at the hidden level', () => {
    it('carries exactly the account, the password row and the four lines in order', async () => {
      await mount()
      expect(byTestId('card-account')?.textContent).toBe(CHECKSUMMED)
      expect(allByTestId('card-password')).toHaveLength(1)
      expect(allByTestId('card-line')).toEqual(LINES)
      expect(cardText()).toBe(
        [
          S.card.cardTitle,
          S.display.values.account,
          CHECKSUMMED,
          S.display.passwords.recoveryPassword,
          S.display.hiddenValue,
          S.display.hiddenChip,
          S.card.reveal,
          ...LINES
        ].join('')
      )
    })

    it('shows the address whole, 42 characters with no separator', async () => {
      await mount()
      const address = byTestId('card-account')?.textContent ?? ''
      expect(address).toHaveLength(42)
      expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/)
    })

    it('names no method, no threshold, no waiting period and no other address', async () => {
      await mount()
      await press('card-reveal')
      expectNamesNothingToPhish(cardText())
    })

    it('hides the password by default, reveals it on the action and hides it again', async () => {
      await mount()
      expect(byTestId('card-password-value')?.textContent).toBe(S.display.hiddenValue)
      expect(byTestId('card-password-chip')?.textContent).toBe(S.display.hiddenChip)
      expect(document.body.textContent).not.toContain(PASSWORD)

      await press('card-reveal')
      expect(byTestId('card-password-value')?.textContent).toBe(PASSWORD)
      expect(byTestId('card-password-chip')).toBeNull()
      expect(byTestId('card-reveal')?.textContent).toBe(S.card.hide)

      await press('card-reveal')
      expect(byTestId('card-password-value')?.textContent).toBe(S.display.hiddenValue)
      expect(byTestId('card-password-chip')?.textContent).toBe(S.display.hiddenChip)
      expect(byTestId('card-reveal')?.textContent).toBe(S.card.reveal)
      expect(document.body.textContent).not.toContain(PASSWORD)
    })

    it('saves a file with the account, the password in clear and the four lines', async () => {
      await mount()
      await press('card-download')
      expect(files).toHaveLength(1)
      const rows = fileRows(files[0])
      expect(rows.values).toEqual([
        [S.display.values.account, CHECKSUMMED],
        [S.display.passwords.recoveryPassword, PASSWORD]
      ])
      expect(rows.lines).toEqual(LINES)
      expectNamesNothingToPhish(rows.text)
      expect(onCarried).toHaveBeenCalledTimes(1)
    })

    it('prints with the card mounted under the page body, then takes the print view away', async () => {
      await mount()
      await press('card-print')
      expect(printed).toHaveLength(1)
      expect(printed[0].printView).toBe(true)
      expect(printed[0].printCardText).toContain(CHECKSUMMED)
      expect(printed[0].printCardText).toContain(PASSWORD)
      expect(document.querySelector('[data-testid="print-view"]')).toBeNull()
      expect(document.body.textContent).not.toContain(PASSWORD)
      expect(onCarried).toHaveBeenCalledTimes(1)
    })

    it('hands the card to another device through the print view', async () => {
      await mount()
      await press('card-send')
      expect(printed).toHaveLength(1)
      expect(printed[0].printView).toBe(true)
      expect(files).toHaveLength(0)
      expect(document.querySelector('[data-testid="print-view"]')).toBeNull()
    })

    it('hides everything but the card when the page prints, and the print view on screen', async () => {
      await mount()
      await press('card-print')
      const { printCss } = printed[0]
      expect(printCss).toMatch(
        /^#([\w-]+)\{display:none\}@media print\{body>\*:not\(#\1\)\{display:none!important\}#\1\{display:block!important\}\}$/
      )
    })
  })

  describe('at the public level', () => {
    it('carries the account and the four lines, with no password row', async () => {
      await mount({ level: 'public' })
      expect(byTestId('card-password')).toBeNull()
      expect(byTestId('card-reveal')).toBeNull()
      expect(cardText()).toBe(
        [S.card.cardTitle, S.display.values.account, CHECKSUMMED, ...LINES].join('')
      )
      expectNamesNothingToPhish(cardText())
    })

    it('carries no password in the print or the file even when one is held', async () => {
      await mount({ level: 'public' })
      await press('card-print')
      expect(printed[0].printCardText).toBe(
        [S.card.cardTitle, S.display.values.account, CHECKSUMMED, ...LINES].join('')
      )

      await press('card-download')
      await press('ask-confirm')
      const rows = fileRows(files[0])
      expect(rows.values).toEqual([[S.display.values.account, CHECKSUMMED]])
      expect(rows.lines).toEqual(LINES)
      expect(files[0].text).not.toContain('orchid')
    })
  })

  describe('at the hidden level with no password held', () => {
    it('keeps the password hidden with the reveal disabled', async () => {
      await mount({ password: null })
      expect(isDisabled('card-reveal')).toBe(true)
      await press('card-reveal')
      expect(byTestId('card-password-value')?.textContent).toBe(S.display.hiddenValue)
      expect(byTestId('card-password-chip')?.textContent).toBe(S.display.hiddenChip)
    })

    it('disables every carrier, so nothing carries a card without its password', async () => {
      await mount({ password: null })
      expect(['card-download', 'card-print', 'card-send'].map(isDisabled)).toEqual([
        true,
        true,
        true
      ])
      await press('card-download')
      await press('card-print')
      await press('card-send')
      expect(files).toHaveLength(0)
      expect(printed).toHaveLength(0)
      expect(byTestId('card-password-ask')).toBeNull()
      expect(onCarried).not.toHaveBeenCalled()
    })

    it('offers only back and continue, with no action of its own to the privacy step', async () => {
      await mount({ password: null })
      const actions = Array.from(container.querySelectorAll<HTMLElement>('[data-testid]'), (node) =>
        node.getAttribute('data-testid')
      )
      expect(
        actions.filter((id) => !id?.startsWith('card-password') && id !== 'card-line')
      ).toEqual([
        'card-screen',
        'recovery-card',
        'card-account',
        'card-reveal',
        'card-download',
        'card-print',
        'card-send',
        'card-why',
        'card-warns',
        'card-back',
        'card-continue'
      ])
    })
  })

  describe('the re-download', () => {
    it('runs the first carrier at once and asks the extension password for the second', async () => {
      await mount()
      await press('card-download')
      expect(files).toHaveLength(1)
      expect(byTestId('card-password-ask')).toBeNull()

      await press('card-print')
      expect(byTestId('card-password-ask')).not.toBeNull()
      expect(byTestId('card-download')).toBeNull()
      expect(byTestId('card-print')).toBeNull()
      expect(byTestId('card-send')).toBeNull()
      expect(printed).toHaveLength(0)
      expect(onCarried).toHaveBeenCalledTimes(1)

      await press('ask-confirm')
      expect(printed).toHaveLength(1)
      expect(byTestId('card-password-ask')).toBeNull()
      expect(byTestId('card-download')).not.toBeNull()
      expect(onCarried).toHaveBeenCalledTimes(2)
    })

    it('runs nothing when the ask is cancelled and brings the carriers back', async () => {
      await mount()
      await press('card-download')
      await press('card-download')
      await press('ask-cancel')
      expect(files).toHaveLength(1)
      expect(onCarried).toHaveBeenCalledTimes(1)
      expect(byTestId('card-password-ask')).toBeNull()
      expect(byTestId('card-download')).not.toBeNull()

      await press('card-download')
      expect(byTestId('card-password-ask')).not.toBeNull()
    })

    it('asks before the first carrier when the card was carried earlier in this tab', async () => {
      await mount({ carriedBefore: true })
      await press('card-download')
      expect(files).toHaveLength(0)
      expect(byTestId('card-password-ask')).not.toBeNull()
      await press('ask-confirm')
      expect(files).toHaveLength(1)
      expect(fileRows(files[0]).values[1]).toEqual([S.display.passwords.recoveryPassword, PASSWORD])
    })
  })

  describe('around the card', () => {
    it('keeps why the setup is not on the card closed until asked', async () => {
      await mount()
      expect(byTestId('card-why')?.textContent).toBe(S.card.whyNotOnCard)
      expect(byTestId('card-why-body')).toBeNull()
      await press('card-why')
      expect(byTestId('card-why-body')?.textContent).toBe(S.card.whyNotOnCardBody)
      await press('card-why')
      expect(byTestId('card-why-body')).toBeNull()
    })

    it('says what warns the holder in one banner line, with no alert settings', async () => {
      await mount()
      expect(byTestId('card-warns')?.textContent).toBe(S.card.warnsHeader + S.card.banner)
      expect(byTestId('card-warns')?.children).toHaveLength(2)
      expect(container.textContent).not.toMatch(/alert|notif|e-?mail|push|telegram|sms/i)
      expect(container.querySelector('input')).toBeNull()
    })

    it('says a new download asks the extension password', async () => {
      await mount()
      expect(container.textContent).toContain(S.card.reDownload)
    })

    it('goes back and continues through its handlers', async () => {
      await mount()
      await press('card-back')
      expect(onBack).toHaveBeenCalledTimes(1)
      expect(onContinue).not.toHaveBeenCalled()
      await press('card-continue')
      expect(onContinue).toHaveBeenCalledTimes(1)
    })
  })
})
