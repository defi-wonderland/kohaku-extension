import type { Clause, SetupDraft } from '@web/modules/social-recovery/sdk-interfaces'

import { clausesOfShape } from './slots'
import type { Preset, PresetChoice, PresetId } from './types'

const CARDS = 'socialRecovery.presets.cards'

/** The four presets, in the order the grid shows them. */
export const PRESETS: readonly Preset[] = [
  {
    id: 'deviceAndGuardians',
    nameKey: `${CARDS}.deviceAndGuardians.name`,
    taglineKey: `${CARDS}.deviceAndGuardians.tagline`,
    shape: [
      { threshold: 1, slots: ['passkey'] },
      { threshold: 2, slots: ['ecdsa', 'ecdsa', 'ecdsa'] }
    ]
  },
  {
    id: 'deviceAndId',
    nameKey: `${CARDS}.deviceAndId.name`,
    taglineKey: `${CARDS}.deviceAndId.tagline`,
    shape: [
      { threshold: 1, slots: ['passkey'] },
      { threshold: 1, slots: ['zkpassport'] }
    ]
  },
  {
    id: 'eitherOne',
    nameKey: `${CARDS}.eitherOne.name`,
    shape: [{ threshold: 1, slots: ['passkey', 'zkpassport'] }]
  },
  {
    id: 'guardiansOnly',
    nameKey: `${CARDS}.guardiansOnly.name`,
    taglineKey: `${CARDS}.guardiansOnly.tagline`,
    shape: [{ threshold: 2, slots: ['ecdsa', 'ecdsa', 'ecdsa'] }]
  }
]

/**
 * The draft's other members until the later setup steps overwrite them: the
 * default waiting period of 48 hours in seconds, the pause opt-out the first
 * release commits, and the private default.
 */
export const PRESET_WAIT: SetupDraft['wait'] = BigInt(48 * 60 * 60)
export const PRESET_IGNORES_PAUSE: SetupDraft['ignoresPause'] = true
export const PRESET_PRIVACY: SetupDraft['privacy'] = { backup: 'encrypted', publicMetadata: '0x' }

export const presetOf = (id: PresetId): Preset => {
  const preset = PRESETS.find((candidate) => candidate.id === id)
  if (!preset) throw new Error(`Unknown preset: ${id}`)
  return preset
}

/** The draft a choice starts: a preset's whole shape with every slot empty, or no clause at all. */
export const draftOf = (choice: PresetChoice): SetupDraft => {
  const clauses: Clause[] = choice === 'fromScratch' ? [] : clausesOfShape(presetOf(choice).shape)
  return {
    wait: PRESET_WAIT,
    clauses,
    ignoresPause: PRESET_IGNORES_PAUSE,
    privacy: { ...PRESET_PRIVACY }
  }
}
