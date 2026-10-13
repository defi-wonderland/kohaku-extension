import { getModalHeight } from '@common/components/BottomSheet/helpers'

// Modalize's open animation interpolates over [-40, 0, sheet height].
const isNonDecreasing = (range: number[]) => range.every((v, i) => i === 0 || v >= range[i - 1])

describe('getModalHeight', () => {
  it('lets Modalize compute the height when the window is taller than the offset and handle', () => {
    expect(getModalHeight(600, 0)).toBeUndefined()
    expect(getModalHeight(600, 52)).toBeUndefined()
    expect(getModalHeight(900, 78)).toBeUndefined()
  })

  it('keeps the animation range increasing when the window has no height yet', () => {
    const cases = [
      { windowHeight: 1, modalTopOffset: 78 },
      { windowHeight: 0, modalTopOffset: 78 },
      { windowHeight: 0, modalTopOffset: 0 },
      { windowHeight: 98, modalTopOffset: 78 }
    ]
    cases.forEach(({ windowHeight, modalTopOffset }) => {
      const height = getModalHeight(windowHeight, modalTopOffset)
      expect(height).toBeGreaterThan(0)
      expect(isNonDecreasing([-40, 0, height as number])).toBe(true)
    })
  })
})
