import { createContext } from 'react'

import type { PathTreeSegment } from './types'

/** The width of the column the line runs in, left of every node. */
export const PATH_TREE_GUTTER = 24

/** The line's thickness, for the vertical run and the ticks. */
export const PATH_TREE_LINE = 2

/** Where the tick meets a branch when the branch names no anchor. */
export const PATH_TREE_ANCHOR = 24

/** How the line crosses the node that reads it; a node outside a tree draws none. */
export const PathTreeSegmentContext = createContext<PathTreeSegment>('none')

/** The word a junction shows on the line. */
export const PathTreeLabelContext = createContext<string | undefined>(undefined)
