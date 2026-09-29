import { numberToHex } from 'viem'

import type { Clause } from '@web/modules/social-recovery/sdk-interfaces'
import {
  getRuleLines,
  renderRuleLines,
  RULE_LINE_KEYS
} from '@web/modules/social-recovery/shared/rule-lines'
import type { RuleLineKey, Translate } from '@web/modules/social-recovery/shared/rule-lines'

import { clausesOfShape } from './slots'
import type { Preset, ShapeClause, ShapeRow, SlotKind } from './types'

/** A card states the shape's threshold line alone; the editor shows the rest. */
const OFF_CARD: readonly RuleLineKey[] = [
  RULE_LINE_KEYS.oneFailureDomain,
  RULE_LINE_KEYS.differentPlaces,
  RULE_LINE_KEYS.sizingRule
]

/**
 * Every empty slot carries the same method and config, which the rule lines
 * read as one method held twice and answer with no line. For the line alone,
 * each slot takes config bytes of its own, so each counts as one member.
 */
const lineInputOf = (shape: readonly ShapeClause[]): Clause[] => {
  let slot = 0
  return clausesOfShape(shape).map((clause) => ({
    ...clause,
    credentials: clause.credentials.map((credential) => {
      slot += 1
      return { ...credential, config: numberToHex(slot) }
    })
  }))
}

/** The rule line a preset's card shows, read from its shape. */
export const cardRuleLines = (preset: Preset, t: Translate): string[] =>
  renderRuleLines(
    getRuleLines(lineInputOf(preset.shape)).filter(({ key }) => !OFF_CARD.includes(key)),
    t
  )

const REQUIRED_ROW_KEYS: Partial<Record<SlotKind, string>> = {
  passkey: 'socialRecovery.presets.passkeyRequired',
  zkpassport: 'socialRecovery.presets.passportRequired'
}

const MEMBER_NAME_KEYS: Partial<Record<SlotKind, string>> = {
  passkey: 'socialRecovery.methodNames.passkey',
  zkpassport: 'socialRecovery.methodNames.passport'
}

const nameOf = (keys: Partial<Record<SlotKind, string>>, kind: SlotKind, t: Translate): string =>
  t(keys[kind] ?? 'socialRecovery.display.nouns.method')

/**
 * A card's rows: a required method on its own row, a group as its count with
 * its members named, or with the guardians word when every member is a guardian.
 */
export const shapeRowsOf = (preset: Preset, t: Translate): ShapeRow[] =>
  preset.shape.map(({ threshold, slots }) => {
    if (slots.length === 1)
      return { kind: 'required', text: nameOf(REQUIRED_ROW_KEYS, slots[0], t) }
    const count = [
      t('socialRecovery.shape.any'),
      String(threshold),
      t('socialRecovery.shape.of'),
      String(slots.length)
    ]
    if (slots.every((kind) => kind === 'ecdsa')) {
      return {
        kind: 'group',
        count: [...count, t('socialRecovery.shape.guardians')].join(' '),
        members: []
      }
    }
    return {
      kind: 'group',
      count: count.join(' '),
      members: slots.map((kind) => nameOf(MEMBER_NAME_KEYS, kind, t))
    }
  })
