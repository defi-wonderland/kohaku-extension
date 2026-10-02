export type UsePrivateModeReturnType = {
  isPrivateMode: boolean | null
  hidePrivateValue: (value: string | number) => string | number
  togglePrivateMode: () => void
}
