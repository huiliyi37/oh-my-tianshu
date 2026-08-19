# dsh-tui controller 分层

TuiApp 的可变状态按「挂起态状态机」与「渲染组合」两类分离。挂起态状态机
提取为独立 controller 类（`src/controllers/`），持有状态与回调，不 import
app.ts、不碰渲染；渲染组合与键仲裁仍留在 app.ts（装配职责）。

## 依赖方向

```
app.ts ──装配──▶ controllers/（question-controller · approval-controller）
   │                     │
   │ 构造注入回调         │ 只持有状态 + 回调
   ▼                     ▼
engine/（原语）    render/（纯函数面板投影）
```

- `app.ts → controllers` 单向：app 在 attach 处 new controller，注入
  `onEscapeImmediate` / `onChanged` / `getCurrentSessionId` 等回调。
- controllers 不 import app.ts；结算/取消由 app 的薄转发方法调 controller
  方法（`settle` / `cancel`），渲染只读 `peek()` 快照。
- 事件订阅（`ctx.on`）留在 app（装配职责），controller 不持有 ctx。

## controller 清单

| controller | 状态 | 接口 | 备注 |
|---|---|---|---|
| `QuestionController` | 挂起提问状态机（pendingQuestion + feedbackMode） | `ask()`（挂起存 resolve/reject 句柄）、`settle()`、`cancel()`、`peek()`、`isPending`、`feedbackMode` | 构造注入 `onEscapeImmediate`（保持挂起态 ESC 语义） |
| `ApprovalController` | 待审批请求（pendingApproval + alwaysApprove） | `handle()`（alwaysApprove 短路 + 非当前会话委托 next）、`settle()`、`peek()`、`isPending`、`setAlwaysApprove()` | 构造注入 `getCurrentSessionId` |

## 与 engine/ 既有 controller 的关系

`engine/` 下的 InputController / OverlayController / MetricsGlanceController
同样是状态持有者，但服务于渲染原语（输入行/overlay/指标行），属引擎层；
`src/controllers/` 是会话级业务状态机，属装配层。两者都遵守同一纪律：
只持状态与回调，不反向依赖 app.ts。

## 孤儿 controller 决策记录（C4 Wave 3）

计划期提取的两个 controller 在 Wave 3 与 app.ts 内联逻辑逐 case 对比：

| controller | app.ts 内联 | 对比结果 | 决策 |
|---|---|---|---|
| `engine/stream-render-controller.ts` | `handleStreamEvent`（L1466+） | 内联含 `tool/call`→fluency.setPhase、`tool/result`→fluency.recordToolResult、`turn/end`→fluency.onTurnComplete；controller 只有 assistant/chunk·message·turn/end 三 case，缺 fluency 处理 | **语义不等 → 删除提取**（保留内联） |
| `engine/tool-group-controller.ts` | `renderLive` 工具卡段（L1658+） | 内联传 `compact: this.compactMode`；controller.liveLines 无 compact 参数 | **语义不等 → 删除提取**（保留内联） |

判据：任何 case
语义不等则以 app.ts 内联为准（删除提取），不留孤儿。底层原语
（StreamRenderer / BlockStreamWriter / formatToolCard / format-tool-group
纯 fold）保留且有独立测试；app.spec 黑盒覆盖等价行为。

## 验证

- `question-controller.spec.ts` / `approval-controller.spec.ts`：挂起/结算/
  反馈 custom/取消/alwaysApprove 短路/非当前会话委托 next()。
- app.spec 黑盒（不改 import/构造）覆盖 controller 装配后的端到端行为，
  含订阅/释放平衡断言（`app.dispose()` 后无存活 ctx.on 订阅）。
