# dsh-fs-snapshot

[English](README.md) | 中文

文件快照/回退：在 `tools/execute` waterfall 注入前置快照钩子（移植自 opencode-tui 的 `FileHistory`，Apache-2.0，见 `src/file-history.ts` 头部声明）。写工具（`str_replace_editor` 的写命令 / `write` / `edit`）执行**前**对目标文件做全文快照，供 `/rewind` 的文件回退（code/both 粒度）使用。

与 checkpoint-policy 的区分：checkpoint 是事件日志持久化（防崩溃丢 turn），本插件是文件内容快照（供 rewind 文件回退）——两者正交。

## 装配

```yaml
# cordis.yml（examples/tui 是可运行样例）
- id: fs-snapshot
  name: '@deepseek-ai/dsh-fs-snapshot'
```

配置（`Config`，schemastery 校验）：

| 字段 | 语义 |
|---|---|
| `backupDir` | 快照根目录；缺省 `<os.tmpdir()>/dsh-fs-snapshot`，备份落在 `<backupDir>/<sessionId>/<sha256(path)[:16]>@v<N>` |

依赖 `tools` 服务（`inject: ['tools']`）：无工具注册表时装配失败即报，不静默降级。

## 消费面

- `HISTORIES_KEY`（`'fsSnapshot.histories'`）— per-session `FileHistory` 映射，经 `ctx.get` 取回
- `getFileHistory(ctx, sessionId)` — 取某会话的快照索引（无记录返回 `undefined`）
- `FileHistory.rewindToBoundary(boundaryId)` — 恢复边界前每个文件最早的快照（`backupFileName === null` 表示文件当时不存在 → unlink）

快照上限 100 条（`MAX_SNAPSHOTS`），溢出淘汰最旧并删除其磁盘备份。

## 验证

```sh
pnpm vitest run packages/fs/fs-snapshot/tests/
```

## Model Experience

None, as the pre-write snapshot hook copies files aside and delegates to next() unchanged; it registers no model surface.

#### KV Cache effect

None; the hook adds no request content and touches no logged message.

## Known Limitations and Deferred Work

- **写工具白名单是封闭集** — 仅 `str_replace_editor`（写命令）/`write`/`edit` 触发快照；经 bash 直接写文件不产生备份，rewind 的文件回退对这类改动不可见（与 dsh-evidence-gate 编辑门同款盲区）。
- **备份目录默认在 tmpdir** — 操作系统清理 tmp 会使历史快照失效；跨重启的 rewind 需要显式配置持久 `backupDir`。
- **快照索引是内存态** — `HISTORIES_KEY` 映射随进程消失；重启后磁盘备份仍在但索引不重建（持久化索引为延期工作）。
