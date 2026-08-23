from __future__ import annotations

import os
import platform
import stat
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


_PLATFORMS = {
    "linux-x64": ("manylinux_2_28_x86_64", "dsh-sdk-server-agent-pkg-linux-x64"),
    "linux-arm64": ("manylinux_2_28_aarch64", "dsh-sdk-server-agent-pkg-linux-arm64"),
    "macos-arm64": ("macosx_11_0_arm64", "dsh-sdk-server-agent-pkg-macos-arm64"),
}


def _host_platform_tag() -> str:
    machine = platform.machine().lower()
    arch = "arm64" if machine in {"arm64", "aarch64"} else "x64" if machine in {"x86_64", "amd64"} else machine
    system = platform.system().lower()
    key = f"macos-{arch}" if system == "darwin" else f"linux-{arch}" if system == "linux" else system
    try:
        return _PLATFORMS[key][0]
    except KeyError as exc:
        raise RuntimeError(f"unsupported deepseek-harness-runtime-bin build platform: {key}") from exc


class RuntimeBuildHook(BuildHookInterface):
    """Assign the native wheel tag and reject incomplete or mixed-platform payloads."""

    def initialize(self, version: str, build_data: dict[str, object]) -> None:
        if version == "editable":
            return
        if self.target_name == "sdist":
            raise RuntimeError(
                "deepseek-harness-runtime-bin is wheel-only; build and publish platform wheels only."
            )

        platform_tag = os.environ.get("DSH_RUNTIME_PLATFORM_TAG") or _host_platform_tag()
        matches = [value for value in _PLATFORMS.values() if value[0] == platform_tag]
        if len(matches) != 1:
            supported = ", ".join(value[0] for value in _PLATFORMS.values())
            raise RuntimeError(
                f"unsupported DSH_RUNTIME_PLATFORM_TAG {platform_tag!r}; expected one of {supported}"
            )
        expected_executable = matches[0][1]
        runtime_dir = Path(self.root) / "src" / "deepseek_harness_runtime" / "runtime"
        runtime_files = sorted(runtime_dir.glob("dsh-sdk-server-agent-pkg-*") if runtime_dir.is_dir() else [])
        expected_files = [expected_executable, f"{expected_executable}-rg"]
        if "-macos-" in expected_executable:
            expected_files.append(f"{expected_executable}-spawn-helper")
        found_files = [path.name for path in runtime_files]
        if found_files != expected_files:
            raise RuntimeError(
                f"runtime wheel {platform_tag} payload must be {expected_files}; found {found_files}"
            )
        for executable in runtime_files:
            if executable.stat().st_mode & stat.S_IXUSR == 0:
                raise RuntimeError(f"runtime executable is not executable: {executable}")
        build_data["pure_python"] = False
        build_data["infer_tag"] = False
        build_data["tag"] = f"py3-none-{platform_tag}"
