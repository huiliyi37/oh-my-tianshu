/**
 * model-roles — /model 角色子命令（vision/secondary/subagent）的共享纯函数层。
 *
 * 集中角色保留字解析、中文标签、角色 picker 条目构建（首行「跟随默认（清除 pin）」
 * + provider×model 目录行 + 当前 pin ● 标记）与 pin/unpin/识图警告的中文回显
 * 文案，供命令层（commands/registry.ts）与装配层（ui/app.ts）共用——逻辑收在
 * 此模块，app.ts 只做接线（source-budget 棘轮）。服务访问（ctx.get('modelRoles')、
 * llm 目录读取）留在调用方；pin 语义（settings 用户层、热生效）归
 * dsh-model-roles 包所有。
 *
 * @module @huiliyi37/dsh-tui/model-roles
 */

import type { ModelRole, ModelRoleSelection } from '@huiliyi37/dsh-model-roles'
import type { PickerItem } from './picker.js'

/** 角色 → 中文名（picker 标题与命令回显共用）。 */
export const MODEL_ROLE_LABELS: Readonly<Record<ModelRole, string>> = {
  vision: '视觉模型',
  secondary: '副模型',
  subagent: '子代理模型',
}

/**
 * /model 首参的角色保留字解析：精确匹配 vision/secondary/subagent 返回角色，
 * 否则 undefined（裸模型名/别名/provider 路由原样走主模型路径）。角色名是
 * /model 首参的保留字——同名裸模型名不再可用（provider/model 形式不受影响）。
 * @param token - /model 的第一个空白分隔参数。
 * @returns 命中的角色；非保留字返回 undefined。
 */
export function parseModelRole(token: string): ModelRole | undefined {
  switch (token) {
    case 'vision':
    case 'secondary':
    case 'subagent':
      return token
    default:
      return undefined
  }
}

/** 「跟随默认（清除 pin）」行的提交值（目录行恒为 provider/model 含 /，不碰撞）。 */
export const FOLLOW_DEFAULT_VALUE = 'follow-default'

/** modelRoles 服务缺席的降级错误（角色子命令与角色 picker 共用同一文案）。 */
export const MODEL_ROLES_UNAVAILABLE = '⚠ 当前部署未装配 model-roles 服务，/model 角色子命令不可用'

/** 角色 picker 的目录模型行数据源（supportsVision 供 vision 角色警告；advisory）。 */
export interface RoleCatalogModel {
  /** 模型 id。 */
  id: string
  /** adapter 声明的识图能力；缺省 = 未知（不警告）。 */
  supportsVision?: boolean
}

/** 角色 picker 的 provider 行数据源。 */
export interface RoleCatalogProvider {
  /** provider 路由 id。 */
  id: string
  /** advisory 目录（空数组 = 未通告，该 provider 不出现在 picker）。 */
  models: readonly RoleCatalogModel[]
}

/** 角色 picker 条目构建结果。 */
export interface RoleModelPickerItems {
  /** 全部条目：首行「跟随默认（清除 pin）」，其后 provider×model 目录行。 */
  items: PickerItem[]
  /** 初始选中下标：当前 pin 命中的目录行；未 pin 或未命中时为「跟随默认」行。 */
  selectedIndex: number
}

/**
 * 构建角色 picker 条目：首行固定「跟随默认（清除 pin）」（选中即 unpin，目录
 * 为空时仍可达），其余为目录行；当前 pin 行带 ● 标记与（当前）后缀，未 pin 时
 * 标记在首行。pin 不在目录中（目录为空/模型已下线）时无目录行命中，选中回首
 * 行——与主模型 picker 的 currentKey 未命中行为一致。
 * @param providers - llm 目录（provider × 模型）。
 * @param pin - 当前 pin（undefined = 跟随默认）。
 * @returns 条目与初始选中下标。
 */
export function buildRoleModelPickerItems(
  providers: readonly RoleCatalogProvider[],
  pin: ModelRoleSelection | undefined,
): RoleModelPickerItems {
  const pinKey = pin === undefined ? null : `${pin.provider}/${pin.model}`
  const items: PickerItem[] = [{
    label: pinKey === null ? '跟随默认（清除 pin）（当前）' : '跟随默认（清除 pin）',
    value: FOLLOW_DEFAULT_VALUE,
    current: pinKey === null,
  }]
  let selectedIndex = 0
  for (const provider of providers) {
    for (const model of provider.models) {
      const key = `${provider.id}/${model.id}`
      const current = key === pinKey
      items.push({ label: current ? `${key}（当前）` : key, value: key, current })
      if (current) selectedIndex = items.length - 1
    }
  }
  return { items, selectedIndex }
}

/**
 * pin 成功回显（直参与 picker 确认共用）：热生效说明 + unpin 指引。
 * @param role - 被 pin 的角色。
 * @param selection - pin 的 provider/model 路由。
 * @returns 中文回显行。
 */
export function rolePinEcho(role: ModelRole, selection: ModelRoleSelection): string {
  return `${MODEL_ROLE_LABELS[role]}已 pin: ${selection.provider}/${selection.model}（热生效，无需重启；/model ${role} 选「跟随默认」可清除）`
}

/**
 * unpin 成功回显（picker 首行确认）。
 * @param role - 被清除 pin 的角色。
 * @returns 中文回显行。
 */
export function roleUnpinEcho(role: ModelRole): string {
  return `${MODEL_ROLE_LABELS[role]}已恢复跟随默认（热生效，无需重启）`
}

/**
 * vision 角色 pin 到未声明识图能力模型的警告：目录 supportsVision 是 advisory
 * （缺省 = 未知不警告），显式 false 才提示；警告不阻止 pin。
 * @param selection - pin 的 provider/model 路由。
 * @returns 中文警告行。
 */
export function roleVisionWarning(selection: ModelRoleSelection): string {
  return `⚠ ${selection.provider}/${selection.model} 未声明识图能力（supportsVision=false）——目录为 advisory 已放行 pin，若实际无法识图请换模型`
}
