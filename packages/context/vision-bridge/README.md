# @huiliyi37/dsh-vision-bridge

English | [中文](README.zh.md)

**Vision bridge plugin**: when the primary model cannot see images, user-supplied image attachments are described by a dedicated vision model and injected into the model-visible context via `agent/pre-step`.

The TUI input box lets users paste images (data URLs enter the session as `image` ContentBlocks). When the primary model supports vision, images are forwarded as-is; otherwise, if a dedicated vision model is configured (this plugin), the images are described by it and the description is injected as a plugin-source user message — **model-visible ⟺ logged**: the description lands in session events and is reconstructable from the log; the raw images never enter the session (a text-only primary never sees pixels).

## Config

```yaml
- id: vision-bridge
  name: '@huiliyi37/dsh-vision-bridge'
  config:
    provider: deepseek-official     # explicit vision model (omit when visionAutoBridge is on)
    model: deepseek-vl             # explicit vision model id (omit when visionAutoBridge is on)
    prompt: ''                     # optional; custom description prompt (auto mode otherwise)
    maxTokens: 1024                # optional; description output cap (default 1024)
    primarySupportsVision: false   # optional; whether the primary sees images (default false)
    enabled: true                  # optional; master switch (default true)
    fallback:                      # optional; backup vision model on error/aborted
      provider: deepseek-official
      model: deepseek-vl-backup
    visionAutoBridge: false        # optional; auto-pick the first supportsVision model when no explicit route
```

Vision route resolution order: **`vision` role pin** (the user-level override stored in settings through the optional `ctx.modelRoles` service, read live at each call so a settings.yaml change applies with no restart) > explicit `provider`/`model` > `visionAutoBridge` auto-pick. Mount fails loud unless at least one routing intent exists: the explicit pair, a vision pin already present at assembly, or the auto-bridge; `visionAutoBridge: true` resolves the route at call time by scanning registered providers' advisory catalogs for the first model with `supportsVision: true` (declared by the owning adapter via `LlmModelInfo.supportsVision`). A pin arriving only later does not waive the mount-time check — the composition must declare routing intent; the pin is an override, not an assembly basis. `fallback` is optional; when present its `provider`/`model` are both required, and the bridge retries once through it when the primary vision model errors or aborts (5xx/timeout).

## Key properties

- **Primary capability is declared**: `primarySupportsVision` is set by the assembler from the primary model's actual capability; when true the plugin does not intervene and images go through as-is.
- **Bridge failure never fails the turn**: vision-model timeout/error/empty output degrades to a visible bridge note (`[图片桥接失败]` / `[图片桥接提示]`) so the primary knows "there was an image but it was not read" — never a silent swallow or a whole failed turn.
- **Zero intervention passthrough**: image-free messages, `enabled=false`, and reject decisions pass through untouched.
- **Automatic description mode**: without an explicit `prompt`, the accompanying text hitting UI/error keywords (`报错`/`error`/`终端`/`日志`…) selects OCR-level verbatim transcription; otherwise the generic structured description.
- **Probe service for UIs**: at `apply` the plugin provides `visionBridge` (`{ providedBy: 'vision-bridge' }`), released on unload and absent when `enabled: false` — presentation layers (the TUI) detect bridge availability via `reflect.get('visionBridge', false)` instead of assembler-derived config.

## Verification

```sh
NO_COLOR=1 pnpm vitest run packages/context/vision-bridge/tests/
```

## Model Experience

### Bridged description message

#### What the model sees

When the primary cannot see images, an image-carrying user message is replaced by one text message: `[图片描述]\n<description>\n\n<original text>` (or the bridge-failure fallback). A vision-capable primary sees nothing extra (images pass through). Image-free sessions are completely unaffected.

#### Token effect

Each description costs one auxiliary call with `purpose: 'vision-description'` (capped by `maxTokens`, default 1024); the description text then enters the primary context as a user message. Bridge failure produces no description tokens (only a few fallback lines).

#### KV Cache effect

The injected message appends like any new user message. The bridge call itself is independent of the primary session cache (`vision-description` never joins the primary prefix).

## Known Limitations and Deferred Work

- **No ask_image tool / imageRegistry / description cache yet**: users get a one-shot bridge description at submit time but cannot re-interrogate an already-sent image; repeated same-angle descriptions re-call the vision model each time (opencode-tui's full vision-service surface — registry, cache, ask_image — is beyond the input-box port scope).
- **Primary capability is configuration, not capability lookup**: `primarySupportsVision` is set by the assembler rather than derived from an llm provider capability declaration (the llm service has no vision-capability field yet).
- **TUI hint consistency is the assembler's job**: `dsh-tui`'s `vision.bridgeEnabled` bubble hint derives from the same config source; no runtime cross-check is enforced.
