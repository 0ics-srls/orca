import { expect, expectTypeOf, it } from 'vitest'
import type { WebPairingOffer } from './web-pairing'
import type { WebRuntimeSubscribeOptions } from './web-runtime-subscription-contract'
import * as WebClient from './web-runtime-client'

it('keeps the paired-web client public export surface exact', () => {
  expectTypeOf<WebClient.WebRuntimeSubscribeOptions>().toEqualTypeOf<WebRuntimeSubscribeOptions>()
  expectTypeOf<WebClient.WebRuntimeSubscriptionHandle>().toEqualTypeOf<WebClient.WebRuntimeSubscriptionHandle>()
  expectTypeOf<ConstructorParameters<typeof WebClient.WebRuntimeClient>>().toEqualTypeOf<
    [
      pairing: WebPairingOffer,
      options?: ConstructorParameters<typeof WebClient.WebRuntimeClient>[1]
    ]
  >()
  expectTypeOf<keyof WebClient.WebRuntimeClient>().toEqualTypeOf<
    'call' | 'close' | 'subscribe' | 'statusOwner'
  >()
  expect(Object.keys(WebClient)).toEqual(['WebRuntimeClient'])
})
