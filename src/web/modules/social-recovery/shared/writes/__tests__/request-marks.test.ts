/**
 * The request ids of the recovery overview's writes: each names its write, so
 * a page that finds one stored knows whose it is.
 */
import { intentOfRequest, requestIdOf } from '@web/modules/social-recovery/shared/writes'

describe('the overview write a stored request id names', () => {
  it('finds the write a stored request id names, and none for another screen request', () => {
    expect(intentOfRequest(requestIdOf('reauthorize'))).toBe('reauthorize')
    expect(intentOfRequest(requestIdOf('clear'))).toBe('clear')
    expect(intentOfRequest(requestIdOf('removeAuthorization'))).toBe('removeAuthorization')
    expect(requestIdOf('clear')).not.toBe(requestIdOf('clear'))
    expect(intentOfRequest('social-recovery-sender:1234')).toBeUndefined()
  })
})
