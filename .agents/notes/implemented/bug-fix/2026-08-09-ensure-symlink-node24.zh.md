# Agent Note: ensureSymlink 在 Node >= 24 上无法替换指向目录的符号链接

Status: implemented

[English](2026-08-09-ensure-symlink-node24.md) | 中文

## 问题

当 `~/.dsh/profiles/node_modules/@deepseek-ai/<pkg>` 链接指向较旧的 staging checkout 时，每条 `dsh` 命令都在 `healProfilesModuleFallback` 阶段失败——只要 profile link farm 指向陈旧 checkout，app-boot 的 profile 兜底逻辑就会在 engine >= 24 上阻断启动：

```
Error: Path is a directory: /Users/<user>/.dsh/profiles/node_modules/@deepseek-ai/dsh
    at rmSync (node:fs:1229:18)
    at ensureSymlink (packages/boot/app-boot/src/profile.ts:187:5)
```

`ensureSymlink` 先对链接做 lstat，确认它是符号链接，再将 `readlinkSync` 结果与目标比对，然后调用 `rmSync(link)` 替换指向错误目标的链接。在 Node >= 24 上，`fs.rmSync` 对目标解析为目录的符号链接会以 `ERR_FS_EISDIR` 拒绝；Node 22 则会直接 unlink 掉它。

`rmSync` 的文档语义是删除文件和目录树，不是替换符号链接。此处的链接按构造必然是符号链接（非符号链接会在同一函数更早处抛出），因此替换意图就是移除链接本身，而这正是 `unlinkSync` 的约定，且该约定在受支持的 engine 范围（`^22.19 || >=24`）内保持稳定。

## 决策

`packages/boot/app-boot/src/profile.ts` 的 `ensureSymlink` 用 `unlinkSync` 移除指向错误目标的链接，该函数由模块从 `node:fs` 导入：

```ts
import { readlinkSync, unlinkSync } from 'node:fs'
declare const link: string
declare const target: string
function guard(): void {
  if (readlinkSync(link) === target) return
  unlinkSync(link)  // rmSync throws EISDIR on symlinks-to-dirs (engines >= 24)
}
```

## 验证

- 已复现：在 link farm 指向陈旧 staging checkout 的情况下，`dsh run` 在 Node 24.1.0 上于 `rmSync` 处以 `ERR_FS_EISDIR` 失败。
- 修复后：link farm 修复为指向当前活动 checkout，`dsh run "<prompt>"` 携真实模型响应正常完成。
- `packages/boot/app-boot/tests/profile.spec.ts`：14/14 通过。

## 曾考虑的替代方案

**继续用 `rmSync` 做替换**。否决：它的文档语义是删除文件和目录树，而非替换符号链接；在 engine >= 24 上，它对目标解析为目录的符号链接以 `ERR_FS_EISDIR` 拒绝——而这恰恰是兜底逻辑要修复的陈旧链接场景。它此前之所以看起来可用，只是因为 Node 22 会改为直接 unlink 掉这类链接。

**按 engine 主版本分支处理替换**。否决：`unlinkSync` 在整个受支持范围（`^22.19 || >=24`）内都是移除链接本身，一次调用已经表达了替换意图；而按版本分支的路径必须在两种 engine 上同时保持正确，却换不来任何额外行为。

## 后果

修复路径不再依赖 `rmSync` 对符号链接的 engine 相关行为，一次调用即覆盖 `^22.19 || >=24`。它删除的范围也严格更小：`unlinkSync` 只删链接本身，永远不会触及链接解析到的那个目录。这种更窄的调用放弃的是对该路径上非符号链接的处理——那种情况仍会抛出更早的"存在且不是符号链接"错误，交给运维者处理，而这本来就是该函数既有的要求。
