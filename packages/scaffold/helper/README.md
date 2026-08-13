# `@huiliyi37/dsh-helper`

English | [中文](README.zh.md)

Shared project domain and infrastructure for `create-sdk` and `dsh-sdk config`. `SdkProject` is a read-only snapshot; `ProjectEditSession` is the only mutation and commit boundary. The [SDK architecture Agent Note](../../../.agents/notes/proposed/architecture/2026-07-15-sdk-project-editing-architecture.md) owns the rationale.

The package owns the builtin typed-spec catalog, provider/app behavior entities, structured project file objects, helper-owned project templates, the shared typed `TextTemplate` renderer, package-manager strategies, local-plugin blueprints, typed questions, and the clack prompt adapter. It never boots a Cordis application.

All business and document validation completes before commit writes any affected file. Commit detects external edits made after the session opened, but deliberately provides no cross-file rollback after writing starts.

Builtin features are provider, bash, app, persistence, HMR, filesystem, todo, skill, web, subagent, workflow, compaction, hooks, repeat-tool guard, and timeout policy. The catalog owns feature options, required and non-default Cordis plugin config, feature requirements, resource contribution, and round-trip markers; create and config use the same registry and configurator. The ACP app option contributes only the automation bridge; interactive services belong to host compositions.

`SdkProject.open()` requires only readable root `package.json` and `cordis.yml`. A config referencing `@huiliyi37/dsh-tui` (root or a subpath) opens as the embed run interface; `@huiliyi37/dsh-acp` opens as the acp interface. A Cordis config entry anchors feature installation; a package present only through a linked NPM dependency closure leaves the feature absent. Once an owned Cordis config entry exists, an incomplete resource shape is `inconsistent` and cannot be modified automatically.

`.env.example` follows the currently selected features. `.env` is append-only: helper may add a missing differently named variable, but never updates or removes existing content.

The package root explicitly exports only the objects consumed by `create-sdk` and `dsh-scripts`; internal modules have no `src/*` or package-manifest subpath export.

## Model Experience

None, as the project domain edits files and never mounts a live agent or model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Commit is not transactional across files** — external edits are detected before each write, but a later failure does not roll back files already written.
