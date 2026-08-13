# {{name}}

{{description}}

Built with the DeepSeek Harness SDK using the {{model}} model.

{{#if isAcp}}
## Run as an ACP automation server

Run `{{packageManager}} start` and configure a programmatic ACP client to launch this project. Standard output is reserved for ACP JSON-RPC.
{{else}}
## Embed the harness

Import and call the exported `main()` from `index.ts` in your host application.
{{/if}}

## Development

Install NPM dependencies with `{{packageManager}} {{installArgs}}`, then use:

- `dev`: `{{packageManager}} run dev`
- `build`: `{{packageManager}} {{buildArgs}}`
- `typecheck`: `{{packageManager}} run typecheck`
- `start`: `{{packageManager}} start`
- `config`: `{{packageManager}} run config`

Edit `cordis.yml` to change the runtime plugin tree. Add or remove builtin features with `{{packageManager}} exec dsh-sdk config`.
