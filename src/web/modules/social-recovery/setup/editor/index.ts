/**
 * The editor's operations, its words and its types, loadable in a Node test.
 * The screen and the view import React Native and the extension's contexts,
 * so each is imported by its own path: `setup/editor/EditorScreen` for the
 * route and `setup/editor/EditorView` for the editor over given records.
 */
export * from './operations'
export { renderFinding, renderKindHeader, renderKindName, renderRowChip } from './copy'
export type {
  ClauseRole,
  EditorClient,
  EditorLoad,
  EditorViewProps,
  EditResult,
  MethodKind,
  PickerEntry,
  PickerTarget,
  SlotPosition
} from './types'
