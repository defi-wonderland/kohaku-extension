/**
 * The installed zkPassport stack: the app library's client for a domain, as
 * the SDK constructs it by default. The request and the verifier parameters
 * pass through with the dev mode the method asks for.
 *
 * Each request the builder hands out carries `close`, which cancels the
 * request in the library: the library closes the request's connection to the
 * phone and drops its callbacks, so a request that ended stops reconnecting.
 */
import type {
  ZkPassportClient,
  ZkPassportQueryBuilder,
  ZkPassportStack
} from '@kohaku-eth/social-recovery'

export const zkPassportStackFor = (): ZkPassportStack => async (domain) => {
  const { ZKPassport } = await import('@zkpassport/sdk')
  const library = new ZKPassport(domain)
  const client: ZkPassportClient = library
  const closing = (builder: ZkPassportQueryBuilder): ZkPassportQueryBuilder => ({
    bind: (key, value) => closing(builder.bind(key, value)),
    done: () => {
      const request = builder.done()
      return Object.assign(request, { close: () => library.cancelRequest(request.requestId) })
    }
  })
  return {
    request: async (args) => closing(await library.request(args)),
    getSolidityVerifierParameters: (args) => client.getSolidityVerifierParameters(args)
  }
}
