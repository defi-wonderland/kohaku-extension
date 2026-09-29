/**
 * The preset table and the empty-slot helpers. The screen is imported by path,
 * `./PresetsScreen`, so this module loads in a Node test without the UI.
 */
export {
  PRESETS,
  PRESET_WAIT,
  PRESET_IGNORES_PAUSE,
  PRESET_PRIVACY,
  presetOf,
  draftOf
} from './presets'
export { emptySlot, isEmptySlot, slotKindOf, clausesOfShape } from './slots'
export { startDraft } from './draft'
export { cardRuleLines, shapeRowsOf } from './lines'
export { resumeRowsOf, notStartedRowsOf, draftAgeLine } from './resume'
export { PRESET_IDS } from './types'
export type {
  Preset,
  PresetChoice,
  PresetId,
  PresetsViewProps,
  ResumeRow,
  ShapeClause,
  ShapeRow,
  SlotKind
} from './types'
