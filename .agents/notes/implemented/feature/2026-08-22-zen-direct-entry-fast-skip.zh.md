# Agent Note：禅直连入场——出厂卸载意图桥，新增 /fast 用户跳过

Status: implemented

[English](2026-08-22-zen-direct-entry-fast-skip.md) | 中文

## 问题

出厂 TUI patch 让每个新会话都先过意图桥，而桥产出的多行任务卡在结构上必然击穿禅的首消息分诊（单行、≤80 字符），于是连琐碎请求也要付满锚定阶段外加一轮对齐模型往返。用户没有任何手段为自己确知无需锚定的任务谢绝禅。另外，挂载桥但设 `enabled: false` 会让 `newSession` 直接崩溃：TUI 把服务存在当成路由许可，而 `createAlignedSession` 在关闭态会抛错。

## 决策

- **注释卸载而非删除**——`packages/tui/tui/cordis.patch.yml` 里的 `intent-bridge` 行连同路由原位保留为注释，重新启用即取消注释一个块。新会话直接武装禅，分诊恢复其短消息跳过；`bundle-patch.spec.ts` 现断言该行缺席。
- **`/fast [消息]` 作为用户显式跳过**——zen 给 `ZenTransitionReason` 增加 `'user'`，并经可选 `commands` 注入注册该命令（`/plan` 模式；TUI 经其 CommandService 回退可达）。在首条消息之前执行时晋升落在首次组装之前，模型从未见过禅 face（与分诊等价）；禅中途执行则解锁从下一次组装可见、不注入叙述。可选消息转向该轮；已晋升会话落为良性幂等成功；`faceSelection` 下命令拒绝，因为 face 已冻结。禅不变量接受这第四个晋升理由。
- **关闭态的桥回退而非抛错**——`IntentBridgeService` 暴露 `enabled` 访问器，`newSession` 在调用 `createAlignedSession` 前先检查它，挂载但关闭的桥产出普通的直连进禅会话。

## 后果

- 质量仍是默认（禅阶段本身未变）；速度是一条确定性的命令；短单行请求重新自动跳过。
- 晋升理由词汇表现为 `arm | anchor | timeout | triage | user`；persistence、config、cordis 三个目录及 zen/intent-bridge 双语 README 已重录配对。
- 仍要对齐流程的部署取消注释该 patch 行；经桥会话继续以禅已完成的种子日志入场，两种入场模式并存。

## 备选方案

- **加宽分诊的边车分类器**——否决：每会话多一跳模型正是卸桥要省回的成本，且禅入场对消息形状（长度／换行）本就确定，用户无需推理即可掌控。
- **保留行但设 `enabled: false` 出厂**——否决为默认：加载时仍会因缺路由响亮失败，且同样需要这次的回退修复；作为灰度部署状态继续受支持。
- **把 /fast 注册进 TUI 斜杠表而非 zen**——否决：阶段所有者注册自己的出口（呼应 plan-mode 的 `/plan`），且 TUI 的 CommandService 回退无需 UI 耦合即可派发它。
