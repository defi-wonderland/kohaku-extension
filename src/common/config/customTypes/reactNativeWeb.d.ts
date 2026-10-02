import 'react-native'

// The props and styles that react-native-web takes and the react-native types do not declare
declare module 'react-native' {
  interface ViewProps {
    dataSet?: Record<string, string | number | boolean | undefined>
  }

  interface FlexStyle {
    gap?: number | string
  }

  interface ViewStyle {
    cursor?: string
    touchAction?: string
  }
}
