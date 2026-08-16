# @huiliyi37/dsh-skill-badge

English | [中文](README.zh.md)

Optional bundled skill provider that contributes `dsh-badge` to `ctx.skills`. The skill supplies the official “powered by oh-my-tianshu” Markdown badge snippets.

Mount the plugin to enable the provider. It has no configuration. The shipped CLI composition includes the plugin as `disabled: true`; users must explicitly enable its `skill-badge` row before the skill enters a catalog.

The provider exposes its packaged `assets/` directory as the skill resource base.

## Model Experience

Indirectly, through `@huiliyi37/dsh-tool-skill`, which renders the catalog entry and selected skill body.

#### KV Cache effect

Disabled by default, the plugin changes no request. When enabled, its catalog entry and any loaded body change the provider KV prefix at their insertion points.

## Known Limitations and Deferred Work

- The provider contributes one fixed skill and has no runtime customization.
- The badge is a remote Shields.io image; targets that cannot fetch remote images need their own copy.
