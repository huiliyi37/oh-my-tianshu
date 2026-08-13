# @huiliyi37/cordis-plugin-logger-console

Console exporter for the built-in Cordis logger service.

## Usage

```ts
import { Context } from '@huiliyi37/cordis'
import ConsoleLogger from '@huiliyi37/cordis-plugin-logger-console'

const root = new Context()
await root.plugin(ConsoleLogger, {
  showDiff: true,
  levels: {
    default: 2,
    hmr: 3,
  },
})

root.logger('app').info('started')
```

## Config

| Field | Description |
| --- | --- |
| `colors` | Color support level, or `false` to disable colors. |
| `maxLength` | Maximum rendered line length before truncation. |
| `levels` | Per-logger minimum level map. |
| `showDiff` | Show elapsed time since the previous message. |
| `showTime` | Timestamp template. |
| `label` | Label width, margin, and alignment options. |

The Node entry uses `node:util.inspect` for `%o` and `%O`; the browser entry
passes log arguments through to `console`.
