import i18n from '@common/config/localization'

import {
  renderApprovalValueName,
  renderChip,
  renderCountdown,
  renderHiddenValue,
  renderMemberList,
  renderNoun,
  renderPasswordName,
  renderPaymentOrder,
  renderRemaining,
  renderResolvedName,
  renderWalletWord
} from '..'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

describe('a renderer called without a translate function', () => {
  it('renders what the app i18n.t gives for the same key and options', () => {
    expect(renderHiddenValue()).toEqual({
      dots: i18n.t('socialRecovery.display.hiddenValue'),
      chip: i18n.t('socialRecovery.display.hiddenChip')
    })
    expect(renderRemaining(2 * HOUR)).toBe(
      i18n.t('socialRecovery.display.remainingHours', { count: 2 })
    )
    expect(renderChip('attempt', 'executionDue')).toBe(
      i18n.t('socialRecovery.status.attempt.executionDue')
    )
    expect(renderNoun('guardian')).toBe(i18n.t('socialRecovery.display.nouns.guardian'))
  })

  it('renders the words of en.json, never a key', () => {
    expect(renderHiddenValue().chip).toBe('Hidden')
    expect(renderRemaining(2 * HOUR)).toBe('2 hours')
    expect(renderChip('attempt', 'executionDue')).toBe('Execution due')
    expect(renderNoun('guardian')).toBe('Guardian')
  })

  it('reads every string through the app i18n.t, with the full key', () => {
    const t = jest.spyOn(i18n, 't')
    try {
      renderHiddenValue()
      renderMemberList(['a', 'b', 'c', 'd'])
      renderResolvedName('alice.eth', 'aloneForAction')
      renderPaymentOrder(undefined, { symbol: 'USDC', decimals: 6 })
      renderRemaining(20 * MINUTE)
      renderCountdown({ remainingMs: 0 })
      renderNoun('guardian')
      renderPasswordName('recoveryPassword')
      renderApprovalValueName('newKey', { doneScreen: true })
      renderWalletWord('asThisWalletRead')
      expect(t.mock.calls.map(([key]) => key)).toEqual([
        'socialRecovery.display.hiddenValue',
        'socialRecovery.display.hiddenChip',
        'socialRecovery.display.moreMembers',
        'socialRecovery.display.nameCaveat',
        'socialRecovery.display.values.noPayment',
        'socialRecovery.display.remainingMinutes',
        'socialRecovery.status.attempt.executionDue',
        'socialRecovery.display.nouns.guardian',
        'socialRecovery.display.passwords.recoveryPassword',
        'socialRecovery.display.values.controlledBy',
        'socialRecovery.display.asThisWalletRead'
      ])
    } finally {
      t.mockRestore()
    }
  })
})
