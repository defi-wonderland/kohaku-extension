// The drag handle Modalize keeps above the sheet's content when the handle is shown.
const MODALIZE_HANDLE_HEIGHT = 20

/**
 * Modalize sizes the sheet to the window height minus the top offset and the handle, and its
 * open animation interpolates over [-40, 0, that height]. A window that has no height yet (a full
 * tab can report a viewport height near zero right after the extension unlocks) makes that height
 * negative, the range decreasing, and the interpolation throws. In that case the sheet gets the
 * smallest positive height until the window reports its real size; otherwise Modalize keeps
 * computing the height itself.
 */
const getModalHeight = (windowHeight: number, modalTopOffset: number): number | undefined =>
  windowHeight - modalTopOffset - MODALIZE_HANDLE_HEIGHT > 0 ? undefined : 1

export { getModalHeight }
