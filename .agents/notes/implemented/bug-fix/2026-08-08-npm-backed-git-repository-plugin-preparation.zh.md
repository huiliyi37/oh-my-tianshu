# Agent Note: 基于 NPM 的准备机制使 GitHub repository 插件自包含

状态：已实现

[English](2026-08-08-npm-backed-git-repository-plugin-preparation.md) | 中文

## 问题

repository 插件创作约定要求 `scripts.prepack` 调用 `dsh-plugin-prepare`。如果由正在运行的 DSH 安装提供该可执行文件，即使源包自身的 manifest（元数据清单）无法取得辅助程序，它也会显得有效。因此，这并未证明 `@deepseek-ai/dsh-repository-plugin` 发布后用户所需的行为：普通 Git 托管 NPM 包必须只依靠自身声明的依赖即可安装和准备。

pnpm workspace 内可选择的 `.dsh-plugin` 还有另一项隔离要求。pnpm 会在打包所选子目录前运行仓库首选的包管理器，以准备 Git 托管包。嵌套的 `pnpm install` 可能加入外层 workspace；当根 lockfile 未把 `.dsh-plugin` 列为 importer 时，pnpm 可能报告成功，却未安装仅由该包声明的依赖。随后，其 TypeScript 构建或准备命令会失败；也可能因为存在预生成产物，依赖缺失被掩盖。

签入仓库的 headless fixture（测试前置数据）挂载的是已准备好的包装层。它证明运行时组合，而不证明 GitHub 获取、NPM 解析或包自有准备。

## 决策

`.dsh-plugin` 包将已发布的 `@deepseek-ai/dsh-repository-plugin` 声明为普通开发依赖，并在 `scripts.prepack` 中调用其已发布的 `dsh-plugin-prepare` 可执行文件。该包可以声明其他任意构建依赖与运行时依赖，并在辅助程序前执行任意编译。repository 插件包把 Cordis 与 DSH 对等依赖（peer dependency）标为可选，因此仅为使用辅助程序而进行的开发安装只会解析辅助程序实际依赖的 `zod` 运行时依赖；应用组合仍会提供该包 Cordis 入口所使用的对等依赖。

DSH 不会生成准备阶段可执行文件，也不会将其前置到 `PATH`。`RepositoryCache` 只提供一个由事务持有的 `pnpm` 包装脚本：外层安装直接运行锁定的 pnpm 入口，而 pnpm 为 Git 包硬编码的 `pnpm install` 会以 `--ignore-workspace` 重新调用同一入口。因此，即使位于另一个 pnpm lockfile 之下，所选包仍自行负责依赖解析，正常的包管理器生命周期 `PATH` 构造会暴露 `node_modules/.bin/dsh-plugin-prepare`。临时 pnpm 包装脚本会在子进程结算后消失。repository 仍是受信任的包管理器输入：所有依赖与生命周期代码都按既有信任约定执行。

Node 24 消费方 CI 任务会传入从 PR（Pull Request）head 仓库与 SHA 派生的精确源。它复用现有私有 DeepSeek Harness 仓库，而不会为每次运行新建仓库。作业作用域的 Git 配置允许只读作业 token 访问该精确私有源，并把 pnpm 的 SSH 回退改写为已认证 HTTPS。

构建入口验收还会创建一个进程内 NPM 注册表。它通过移除 `private`、将 workspace protocol 替换为发布版本并打包声明的文件，把当前已构建的 `@deepseek-ai/dsh-repository-plugin` 暂存为发布产物。注册表会提供由此生成的 `packument` 与 tarball，作业本地 NPM 配置则只把 `@deepseek-ai` scope 指向它。实际构建的 `dsh run` 子进程随后获取精确 Git 源；该包通过 NPM 解析辅助程序，对 TypeScript Cordis 入口和 MCP server 进行类型检查与打包，准备相邻的 skill（技能），并加载全部三类贡献。一个刻意设为失败的宿主 `PATH` 命令可以证明，该生命周期选中的是依赖内的可执行文件。验收还要求经过注册表解析并检查不可变的已准备缓存，因此恢复宿主注入的辅助程序也无法通过。

## 考虑过的替代方案

**从正在运行的 DSH 安装注入 `dsh-plugin-prepare`。** 拒绝，因为这会让 manifest 不完整的 repository 包通过，并测试 NPM 消费方无法复现的纯宿主路径。

**把源 fixture 本身发布到 NPM。** 拒绝，因为产品约定明确要求 DSH 插件仍托管在 Git；只有可复用的准备辅助程序是 NPM 依赖。

**在每次 CI 运行中创建新的私有 GitHub 仓库。** 拒绝，因为 PR 仓库的精确 head SHA 已是经过认证的真实私有 Git remote。每次运行的仓库变更会增加凭据、清理和最终一致性失败模式，却不改变获取路径。

**在 `RepositoryCache` 安装所选包后再准备。** 拒绝，因为 pnpm 打包后的子目录不再包含 `../skills` 等路径所引用的同仓库相邻资源；准备必须在生成 packlist 前完成。

**在 DSH 中克隆 GitHub 仓库并绕过 pnpm 的 Git 获取器。** 拒绝，因为这会重复实现已由锁定包管理器负责的 ref 解析、子目录选择、依赖安装、packlist 行为和缓存完整性。

## 后果

- 仓库作者可以把 `.dsh-plugin` 包、TypeScript 源码、skill 与 MCP 定义提交到 GitHub，而无需把该插件包发布到 NPM。该包必须声明已发布的准备依赖。
- 私有 GitHub 源使用宿主的标准 Git 认证。CI 使用临时的只读配置而非运行器上的持久凭据来验证该路径。
- 创作格式使用 `prepack` 而不是 `prepare`。其中可以包含任意包自有构建步骤，但必须调用依赖提供的辅助程序；依赖或生命周期元数据缺失时，会在缓存 generation 可用前失败。
- pnpm 仓库中的所选包按自身 manifest 安装，而不继承外层 workspace。它不能依赖仅由 workspace 提升而可见的包；普通注册表依赖和相对 `file:` 依赖仍是包自有输入。
- 精确源字符串标识不可变缓存 generation；改变 ref 或源配置会选择另一个 generation。
- 包依赖、编译、准备和受信任的 `dsh.entry` 贡献仍由 repository 包和[受信任代码决策](../architecture/2026-08-08-trusted-repository-package-code.md)负责。

## 测试

`packages/boot/app-boot/tests/repository-cache.spec.ts` 会通过本地 Git 子路径运行一个未列入源仓库根 pnpm lockfile 的包，并要求相对 `file:` 依赖同时提供构建命令与 `dsh-plugin-prepare`；该测试还证明可见环境变量得以保留，而名称符合凭据模式的变量会被清除。`packages/self-modification/repository-plugin/tests/repository-plugin.spec.ts` 锁定包含辅助命令的 `prepack` 元数据与准备输出。`examples/headless-agent/tests/keyless-smoke.e2e.ts` 使签入仓库的已准备 fixture 继续符合该源格式约定。`apps/cli/tests/github-repository-plugin.built.e2e.ts` 是产品验收测试：模拟发布的辅助程序包、作业本地 NPM 注册表、全新 DSH 主目录、精确且经过认证的私有 GitHub 源、实际构建的 `dsh run`、包自有 TypeScript 构建、真实 MCP 执行、代码入口转换、mock LLM（大语言模型）请求观测，以及已准备缓存检查。
