/**
 * 进程重启原语：以与当前进程相同的命令行（process.argv）重新启动，
 * 继承同一终端（stdio inherit）。供 /restart 命令使用——TUI 是 dsh 宿主的
 * 插件，重启宿主进程 = 重放宿主 argv。
 *
 * POSIX 上 detached（子进程成为新会话 leader）：父进程退出时子进程
 * 不会收到终端的 SIGHUP，也因脱离控制终端而不触发后台读 TTY 的
 * SIGTTIN；继承的 TTY fd 仍可正常读写（raw mode 是终端设备属性）。
 * Windows 上不用 detached（会另开控制台窗口），stdio 继承 +
 * windowsHide 让子进程继续占用同一控制台。
 *
 * 注：本模块是 tui-runner 内部原语（index.ts 装配层使用），不是公共 API——
 * 不提供 package exports 子路径，请勿按 @huiliyi37/dsh-tui/restart 导入。
 */

import { spawn } from 'node:child_process'

/** {@link spawnSelfRestart} 的选项。 */
export interface SpawnSelfRestartOptions {
  /** 重启命令行；缺省 process.argv（argv[0]=node 可执行，argv[1..]=脚本+参数）。 */
  argv?: string[]
}

/**
 * 尝试以相同命令重启当前进程。
 *
 * resolve true = 新进程已成功启动（'spawn' 事件，exec 完成）——调用方
 * 应随后退出当前进程，让新进程接管终端；resolve false = 无法启动
 * （argv 无效 / spawn error 如 ENOENT）。不等待新进程退出——成功后
 * unref，父进程随时可 exit。
 * @param options - 重启命令行覆盖（缺省重放 process.argv）。
 * @returns 新进程成功启动返回 true，无法启动返回 false。
 */
export function spawnSelfRestart(options: SpawnSelfRestartOptions = {}): Promise<boolean> {
  const argv = options.argv ?? process.argv
  const command = argv[0]
  const args = argv.slice(1)
  // argv[0]=node 可执行（空串/缺省视为无效），argv[1..] 至少要有一个脚本参数。
  if (command === undefined || command === '' || args.length === 0) return Promise.resolve(false)
  return new Promise((resolve) => {
    let settled = false
    const child: ReturnType<typeof spawn> = spawn(command, args, {
      stdio: 'inherit',
      // POSIX：新会话防 SIGHUP / SIGTTIN；Windows：detached 会开新控制台窗口，禁用。
      detached: process.platform !== 'win32',
      windowsHide: true,
    })
    child.once('spawn', () => {
      if (settled) return
      settled = true
      child.unref()
      resolve(true)
    })
    child.once('error', () => {
      if (settled) return
      settled = true
      resolve(false)
    })
  })
}
