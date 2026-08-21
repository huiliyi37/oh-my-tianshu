# Oh My Tianshu 品牌标识设计说明（BRAND.md）

> 版本 1 · 设计提案 · 配套资产见本目录 `logo/`、`mascot/`、`tui/`。
> 品牌色 `#4D6BFE` 沿用现有 badge / TUI brandColor，保持产品连续性。

## 1. 品牌名与命名故事

- **oh my tianshu**：向 *Oh My Zsh* 致敬——「oh my」是终端极客第一次把环境调顺时脱口而出的惊呼，也是产品该有的温度。
- **Tianshu / 天枢**：北斗七星第一星（大熊座 α，Dubhe）。《晋书·天文志》中天枢为「斗纲」，斗柄所指、四时由此定——**星之枢纽**。
- 双关：harness 本义「马具 / 枢纽」，天枢是「天上的枢纽」，两者都是**把力量导向正确方向**的装置；而天枢所在的星座正是**大熊座**——吉祥物的出身由此而来。

**品牌主张**：*The pivot of your terminal.*（中文：天枢定位，行必有方。）

## 2. 设计关键词

**枢纽 · 导航 · 手作温度 · 插件轨道**

手绘感是刻意选择：TUI 是开发者的手工作坊，「oh my」是惊喜而非威压。所有线条带轻微抖动与双描，拒绝完美几何。

## 3. Logo 系统

### 3.1 主标识「星枢徽章」（`logo/logo-star-pivot.svg`）

- 手绘五角星 = **天枢**；一笔未闭合的笔触星环 = **插件轨道**（一切围绕 harness 运转），也是「oh」的 **o**；
- 星的上、下两角突破星环 = **枢纽定位**；环左端收笔留口 = 手作与未完待续；
- 右上琥珀四角星辉 = 唯一点缀色，呼应「天枢所指」的导航光。

变体：徽章（透明底）/ lockup 横版（`logo/logo-lockup.svg`，云纸卡片）/ monogram `✦` / favicon（简化纯星）。

### 3.2 字标

手写体 **oh my tianshu**（Caveat，OFL），`tianshu` 下一笔天枢蓝手绘轨道弧；中文附标「天枢 · 星之枢纽」（霞鹜文楷）。

### 3.3 使用守则

- 安全间距 = 星高的 1/2；最小尺寸：徽章 24px、monogram 16px、favicon 用简化纯星；
- 不用投影、渐变、描边改色重绘；星辉琥珀只用于「天枢」星点；
- 深底场景星体不变，墨线换云纸白 `#F7F4EC`。

## 4. 色彩系统

| 名称 | HEX | 用途 | 16 色 ANSI 近似 |
| --- | --- | --- | --- |
| 天枢蓝 Pivot Blue | `#4D6BFE` | 主色：星体 / 身体 / brandColor | blueBright |
| 星辉琥珀 Star Amber | `#FFC94D` | 点缀：星辉 / 小旗 | yellow |
| 墨线 Ink | `#232734` | 手绘轮廓 / 正文墨色 | default |
| 云纸 Paper | `#F7F4EC` | 浅底卡片 | — |
| 夜幕 Night | `#10131F` | 终端深底 | — |
| 肚皮白 Belly | `#F2F5FA` | 吉祥物口鼻 / 肚皮 | whiteBright |
| 腮红 Blush | `#F5A8B8` | 吉祥物腮红 | magenta（近似） |

## 5. 字体系统

- **手写标题 / 字标**：Caveat（拉丁，OFL）+ 霞鹜文楷 LXGW WenKai（中文，OFL）；
- **终端 / 代码**：JetBrains Mono；
- **文档正文**：系统 UI 字体（PingFang SC / Segoe UI）。

## 6. 吉祥物「枢宝 Shubao」

- **名字**：枢宝 Shūbǎo，英文昵称 **Shu**——「枢」取天枢，「宝」取呆萌；
- **出身**：大熊座的小熊崽（天枢星所在星座），年龄不详，永远在接线、插插件；
- **特征**：天枢蓝身体、墨线双描手绘轮廓、奶白肚皮上的**北斗七星**（第一颗天枢为蓝色四角星辉）、腮红、头顶呆毛、手持 `>_` 提示符小旗；
- **形态谱系**：完整形态（`mascot/mascot-shubao.svg`，Web / 文档 / 官网）→ 像素形态（`tui/mascot-shubao-grid.txt`，TUI 欢迎页 24×16）→ 星枢终端形态（`mascot/mascot-star-mode.svg`，极小尺寸 / icon）；
- **人格**：勤快、可靠，专注时认真，完成时得意；口头禅「天枢到，方向准」；
- **守则**：不改形、不裁切、不用非品牌色重绘；星辉只用于天枢星点。

## 7. TUI 应用规范

- **欢迎页 hero**：枢宝像素画替换现有鲸鱼（`packages/tui/tui/src/format/whale.ts` 的 GRID 换新网格，`pixelColor` 增 `S` 档）；格式、宽度守恒、降级矩阵（宽 <40 / 行 <22 / 无色 / legacy conhost）全部沿用；
- **星形 glyph 双轨**：unicode 轨 `✦` / ascii 轨 `*`，跟随 `useAsciiGlyphs` 既有约定；
- **欢迎卡顶边**：`╭─ ✦ Oh My Tianshu ───╮`（可选，改 `formatWelcomeCard` 缺省 brand 文案）；
- **顶栏 brandColor 保持 `#4D6BFE` 不变**；`--version` / headless 用 `tui/banner-omt.txt`。

## 8. 旧鲸鱼资产迁移建议

默认欢迎页 hero 由枢宝替换；鲸鱼（whale.ts）保留为可切换的「怀旧模式」或彩蛋，渲染器无需改动——二者共用同一套半块渲染代码。

## 9. 落地清单（后续按 PR 拆分）

1. TUI 欢迎页枢宝替换（代码 + 单测 + 快照）；
2. `apps/web/public/favicon.svg` 与 website favicon 换简化纯星；
3. README / 官网头图与徽章；
4. banner 接入 CLI `--version` / help；
5. BRAND.md 英文对版（如需，按仓库 i18n 契约补对）。

## 10. 资产清单

| 文件 | 用途 |
| --- | --- |
| `logo/logo-star-pivot.svg` | 主标识徽章（透明底） |
| `logo/logo-lockup.svg` | 横版 lockup（云纸卡片） |
| `mascot/mascot-shubao.svg` | 枢宝完整形态 |
| `mascot/mascot-star-mode.svg` | 星枢终端形态（icon） |
| `tui/mascot-shubao-grid.txt` | TUI 像素画网格 + 集成说明 |
| `tui/mascot-shubao.ansi` | 像素画 truecolor 预览（`cat` 即可） |
| `tui/banner-omt.txt` | OMT 等宽 banner + glyph 双轨规范 |
| `tui/banner-omt.ansi` | banner 彩色版预览 |
