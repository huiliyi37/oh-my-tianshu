// @vitest-environment jsdom
/**
 * RoleModelsRow component tests (P2④ final tail): header summary, expansion,
 * catalog-backed role picking, follow-default clearing, and the unavailable
 * state.
 */

import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@huiliyi37/dsh-client-web-react'
import { createSnapshotStore } from '@huiliyi37/dsh-client-runtime/client'
import { RoleModelsRow } from '../src/client/RoleModelsRow.tsx'
import { zh } from '../src/client/locales.ts'
import type { RolePin, RolePinsState } from '../src/client/role-pins.ts'

const t = ((key: string): string => (zh as Record<string, string>)[key] ?? key) as never

const CATALOG = {
  groups: [{
    id: 'deepseek-official',
    name: 'DeepSeek',
    models: [
      { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' },
      { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
    ],
  }],
  failures: [],
}

function state(overrides: Partial<RolePinsState> = {}): RolePinsState {
  return {
    status: 'ready', error: null, writable: true, revision: 0,
    pins: { vision: { provider: 'deepseek-official', model: 'deepseek-v4-pro' } },
    catalog: CATALOG,
    ...overrides,
  }
}

function renderRow(
  overrides: Partial<RolePinsState> = {},
  selectRole = vi.fn<(role: 'vision' | 'secondary' | 'subagent', pin: RolePin | undefined) => Promise<void>>(async () => {}),
) {
  const store = createSnapshotStore(state(overrides))
  const props = {
    load: vi.fn(async () => {}),
    selectRole,
    useRolePins: bindSnapshotSelector(store),
    t,
  } as unknown as ComponentProps<typeof RoleModelsRow>
  render(<RoleModelsRow {...props} />)
  return { store, selectRole }
}

afterEach(cleanup)

describe('RoleModelsRow', () => {
  it('renders the header summary and expands to three role rows', () => {
    renderRow()
    expect(screen.getByText('角色模型')).toBeTruthy()
    expect(screen.getByText(/视觉: DeepSeek-V4-Pro/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /角色模型/ }))
    expect(screen.getByText('视觉')).toBeTruthy()
    expect(screen.getByText('次级')).toBeTruthy()
    expect(screen.getByText('子代理')).toBeTruthy()
  })

  it('picks a catalog model for a role and reports the selection', async () => {
    const { selectRole } = renderRow()
    fireEvent.click(screen.getByRole('button', { name: /角色模型/ }))
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek-V4-Pro' }))
    // The vision role's selector shows the pinned model; open the secondary's.
    const secondary = screen.getAllByRole('button', { name: '跟随默认' })[0] ?? document.body
    fireEvent.click(secondary)
    fireEvent.click(screen.getByRole('menuitem', { name: 'DeepSeek-V4-Flash' }))
    expect(selectRole).toHaveBeenCalledWith('secondary', { provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  })

  it('clears a pinned role back to follow-default', async () => {
    const { selectRole } = renderRow()
    fireEvent.click(screen.getByRole('button', { name: /角色模型/ }))
    const vision = screen.getByRole('button', { name: 'DeepSeek-V4-Pro' })
    fireEvent.click(vision)
    fireEvent.click(screen.getByRole('menuitem', { name: '跟随默认' }))
    expect(selectRole).toHaveBeenCalledWith('vision', undefined)
  })

  it('renders null when the namespace is unavailable', () => {
    renderRow({ status: 'unavailable' })
    expect(screen.queryByText('角色模型')).toBeNull()
  })
})
