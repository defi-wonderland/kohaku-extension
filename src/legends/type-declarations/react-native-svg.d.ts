import type { CSSProperties } from 'react'

declare module 'react-native-svg' {
  interface PathProps {
    style?: CSSProperties
  }
}
