# Agent Note: agent-router turn-end 触发跳过禅阶段并移出发布窗口

Status: implemented

[English](2026-08-21-agent-router-trigger-zen-skip-and-window.md) | 中文

## Problem

turn-end 触发原本无条件执行:每次 `turn/end`,`session/event` 观察者调用 `runTrigger`,而 shadow 模式下它在首个 `await` 之前就同步 append `router/decision`。这个 append 发生在 `Session.append` 仍处于 `turn/end` 发布窗口内时(`entry.appending === true`,观察者在同一窗口内被同步回调),于是重入守卫抛错、异常冒到顶层、进程退出:发货 TUI(`trigger: { mode: 'shadow', onTurnEnd: true }`)只要路由指标给出 delegate 决策就必然崩溃,重启后又进入会话恢复,循环往复。同一条观察者路径也会在会话开头几轮触发——禅阶段的受限只读工具面让工具成败成为噪声而非可路由信号,在那里记录 delegate 决策(auto 下则派发)会把锚定探测误读成挣扎。

重入没被测试拦住,是因为集成测试用假 session 驱动观察者(append 只是数组 push)——真实 `Session.append` 的发布窗口从未被走到。

## Decision

turn-end 触发加两道门,都在 `session/event` 观察者里:

1. **禅阶段跳过** — 触发前读 `foldZenPhase(owner.events)`,折叠仍为 `'zen'` 即返回。无 `zen/phase` 事件的日志折叠为 `'full'`(从未 arm),未装配 zen 的组合不受影响;子代理会话早已被 `parentSession` 检查排除。路由器因此在晋升(锚定谓词/超时/分诊)之后的第一个 turn end 才开始参与。
2. **微任务出窗** — `void queueMicrotask(() => …runTrigger(owner))` 把整个触发(含 shadow 的同步记录 append)移出 `turn/end` 发布窗口;决策仍然紧跟它所回应的事件落盘。

预测累计(`tool/result` → `recordPrediction`)不动:禅阶段探测照常进窗口,tipping-point 重置本就建模了恢复——门加在行动上,不加在观察上。

## Alternatives considered

- **放宽重入守卫**(允许嵌套 append)。否决:「一条事件完整发布后才轮到下一条」是会话观察者依赖的日志顺序契约;违规方是触发器。
- **按轮数热身**(跳过前 N 轮)。否决:在已记录、可折叠的事实(`zen/phase`)正好陈述条件的地方引入魔法常数;锚定五轮的会话与首轮探测即晋升的会话需要不同的热身。
- **在观察者里 catch 重入错误。** 否决:那会静默丢掉每一条 shadow 决策——崩溃是守卫在响亮地履行职责。

## Consequences

- 发货 TUI 不再在值得 delegate 的 turn end 崩溃;shadow 决策可靠落盘——这本来就是 shadow 验证的意义。
- 禅阶段会话不产出 `router/decision` 记录,auto 下也不派发;开局几轮的可观测性是刻意让渡的(指标本身仍在累计)。
- `@huiliyi37/dsh-zen` 成为 `@huiliyi37/dsh-agent-router` 的 peer,供 `foldZenPhase`(日志事件上的纯函数——无运行时插件耦合)。
- 测试钉住三个行为:禅阶段抑制(auto 断言不派发)、晋升后恢复触发、发布窗口出窗(`emit` 返回时零记录,决策仅在微任务后落盘)。
