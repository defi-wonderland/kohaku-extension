import type { SetupRecords } from '@web/modules/social-recovery/shared/records'

import { draftOf } from './presets'
import type { PresetChoice } from './types'

/**
 * Writes the draft a choice starts and the path equal to its clauses, so every
 * later step reads one path. Nothing is checked here: the editor applies its
 * rules when the holder saves.
 */
export const startDraft = async (setup: SetupRecords, choice: PresetChoice): Promise<void> => {
  const draft = draftOf(choice)
  await setup.setupDraft.write(draft)
  await setup.path.write(draft.clauses)
}
