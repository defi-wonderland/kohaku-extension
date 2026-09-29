// Stands in for react-native-safe-area-context: its main entry loads React Native's native specs, which Jest cannot parse.
import type { ReactNode } from 'react'

const ZERO = { top: 0, right: 0, bottom: 0, left: 0 }

export const useSafeAreaInsets = () => ZERO
export const SafeAreaProvider = ({ children }: { children?: ReactNode }) => children ?? null
