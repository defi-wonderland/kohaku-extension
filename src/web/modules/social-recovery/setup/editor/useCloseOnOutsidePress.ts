import { useEffect } from 'react'
import type { RefObject } from 'react'

import type { KindMenuAnchorNode } from './types'

/** Closes an open menu when a press lands outside the element that holds it and its trigger. */
const useCloseOnOutsidePress = (
  anchor: RefObject<KindMenuAnchorNode>,
  open: boolean,
  onClose: () => void
) => {
  useEffect(() => {
    if (!open || typeof document === 'undefined') {
      return undefined
    }
    const onPress = (event: MouseEvent) => {
      const node = anchor.current
      if (node && event.target instanceof Node && !node.contains(event.target)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', onPress)
    return () => document.removeEventListener('mousedown', onPress)
  }, [anchor, open, onClose])
}

export default useCloseOnOutsidePress
