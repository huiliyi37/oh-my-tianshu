import { Service } from '@huiliyi37/cordis'

/** Service whose public annotations are intentionally absent. */
export class WritableService extends Service {
  value = 1

  echo(input = 'value') {
    return input
  }
}

declare module '@huiliyi37/cordis' {
  interface Context {
    writable: WritableService
  }
}

export default WritableService
