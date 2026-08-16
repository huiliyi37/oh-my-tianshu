/**
 * Android/Termux install guard for the `@huiliyi37/oh-my-tianshu` package.
 *
 * On Android `process.platform` is `"android"` and the `koffi` FFI dependency
 * has no prebuilt binary, so it compiles from source. Its CMake configure
 * (Android host detection) reads `$PREFIX/include/android/api-level.h`; Termux
 * sets `PREFIX` in its own shells, but a proot-distro root (or any launcher
 * that strips it) leaves the variable unset and the build dies on the
 * unreadable `/include/android/api-level.h`. Fail here with the one-line fix
 * instead of letting the dependency's CMake error confuse the install.
 */

import { existsSync } from 'node:fs'

const TERMUX_PREFIX = '/data/data/com.termux/files/usr'

if (process.platform === 'android' && process.env.PREFIX === undefined && existsSync(TERMUX_PREFIX)) {
  process.stderr.write(
    '@huiliyi37/oh-my-tianshu: Termux detected without $PREFIX set. The koffi native dependency compiles from\n'
    + `source on Android and needs the Termux prefix to find its headers. Re-run the install with:\n\n`
    + `  export PREFIX=${TERMUX_PREFIX}\n`
    + `  npm i -g @huiliyi37/oh-my-tianshu\n\n`,
  )
  process.exit(1)
}
