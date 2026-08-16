# Agent Note: Android/Termux 安装与启动兼容性修复

Status: implemented

[English](2026-08-16-mobile-install-compat-fixes.md) | 中文

## 问题

来自 Android 手机(Termux + proot-distro,aarch64)的现场报告记录了安装并启动 `@huiliyi37/dsh-tianshu@0.2.1` 时遇到的 4 个问题:

1. `koffi`(FFI 依赖)没有 Android 预编译产物,回退源码编译,其 CMake configure 读取 `$PREFIX/include/android/api-level.h`;proot-distro root 未导出 `PREFIX`,路径退化为 `/include/android/api-level.h`,configure 失败。
2. npm 11 默认拦截未放行的生命周期脚本(`allowScripts`);被拦截列表包含 `koffi`、`node-pty`、`@huiliyi37/dsh-subprocess-local`、`@google/genai`、`protobufjs`,存在原生构建被静默跳过的风险。
3. `oh-my-tianshu tui` 报 `--expose-internals is required for HMR service` 崩溃:HMR 服务需要 Node 内部 ESM loader,而 npm bin 链接以裸 `node <script>` 启动,不带该 flag。
4. `oh-my-tianshu web` 报 `cannot get property "webStartup" without inject` 崩溃:官方 `@deepseek-ai/dsh` 共用默认 `$DSH_HOME`(`~/.dsh`),其残留的扁平 fallback 模块链接使 `web` profile 解析到另一安装的 rc.6 bundle,不满足本安装的启动契约。

## 决策

四项修复,各落在其责任边界:

- **bin 自动 re-exec(`apps/cli/src/bin.ts`)。** 当 `process.execArgv` 缺少 `--expose-internals` 时,在参数解析前以该 flag 重新执行一次自身,并保留 `process.execArgv` 使源码 launcher 的 `--import tsx/esm` hook 存活;`process.execArgv` 检查保证 re-exec 幂等。
- **profile bundle 所有权校验(`packages/boot/app-boot/src/profile.ts`)。** 当 `dsh.profile.bundles` 中的条目既不由本安装提供、也不在本 profile 自身依赖中声明、却仍能从 profile 目录解析时,`loadProfile` 立即 fail loud——那是另一安装的残留链接。错误信息直接给出修复:删除该 profile 目录,或用 `DSH_HOME=$HOME/.dsh-tianshu` 隔离本安装。
- **Termux 安装守护(`apps/cli/scripts/check-android-prefix.mjs`)。** 当 `process.platform === 'android'`、`PREFIX` 未设置且 Termux 前缀目录存在时,`preinstall` 脚本以 `export PREFIX=/data/data/com.termux/files/usr` 一行指引 fail loud——抢在依赖晦涩的 CMake 报错之前。
- **README 安装指引。** Install 一节补充 npm ≥ 11 的 `--allow-scripts` 放行列表与 Termux 的 `PREFIX` 要求。

## 备选方案

**发布 `@koromix/koffi-android-arm64` prebuilt。** 暂缓:需要上游合作与交叉编译流水线;守护脚本加文档今天就解锁手机端。

**在非 `--dev` profile 中禁用 HMR 行。** 拒绝:为了规避启动问题而静默降级所有长驻界面上已文档化的热重载契约,不如在入口处解决。

**首次运行自动隔离 `$DSH_HOME`。** 拒绝:静默搬动用户数据比响亮的归属错误更糟;`$DSH_HOME` 已是文档化的逃生通道。

## 影响

裸 npm bin 调用在所有模式下开箱即用;被异安装初始化的 profile 以可修复的诊断失败,而不是不可读的注入错误;Termux 安装会在 `koffi` 编译前得到 `PREFIX` 指引。re-exec 为每次裸启动增加一次进程 spawn(约 50 ms),相对启动可忽略;`--expose-internals` 与官方 dsh 在该平台上的要求一致。所有权校验只拒绝本安装无法提供且 profile 未声明的 bundle,因此通过 `oh-my-tianshu plugin --profile <name> install` 安装的 out-of-tree 插件不受影响。
