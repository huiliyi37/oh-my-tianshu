# @huiliyi37/cordis-plugin-group

Loader group plugin for nesting Cordis entries.

## Usage

```yaml
- id: tools
  name: '@huiliyi37/cordis-plugin-group'
  group: true
  config:
    - id: logger
      name: '@huiliyi37/cordis-plugin-logger-console'
```

Groups are always considered enabled themselves, but disabling a group entry
prevents its child entries from running. Nested entry ids use `:` separators,
for example `tools:logger`.

The package re-exports the `Group` implementation from
`@huiliyi37/cordis-plugin-loader` as its default plugin.
