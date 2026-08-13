import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@huiliyi37/dsh-api-remotes',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  { hostPhase: true },
)
