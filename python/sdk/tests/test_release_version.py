"""Tests for repository-owned Python release versions."""

from __future__ import annotations

import json
import runpy
from pathlib import Path
from types import SimpleNamespace

import pytest


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts" / "build-python-release.py"
build_python_release = SimpleNamespace(**runpy.run_path(str(SCRIPT)))


def test_repository_version_matches_root_package_json() -> None:
    expected = json.loads((ROOT / "package.json").read_text())["version"]

    assert build_python_release.repository_version() == expected


def test_release_tag_is_optional_for_non_release_builds() -> None:
    build_python_release.validate_release_tag(None, "1.2.3")


def test_release_tag_must_match_repository_version() -> None:
    build_python_release.validate_release_tag("python-v1.2.3", "1.2.3")

    with pytest.raises(ValueError, match="expected 'python-v1.2.3'"):
        build_python_release.validate_release_tag("python-v1.2.4", "1.2.3")


def test_repository_version_rejects_non_stable_versions(tmp_path: Path) -> None:
    (tmp_path / "package.json").write_text('{"version":"1.2.3-dev"}\n')

    with pytest.raises(ValueError, match="must be stable X.Y.Z"):
        build_python_release.repository_version(tmp_path)


@pytest.mark.parametrize(("target", "with_helper"), [("linux-x64", False), ("macos-arm64", True)])
def test_stage_runtime_copies_platform_payload(
    tmp_path: Path, target: str, with_helper: bool
) -> None:
    executable = tmp_path / f"dsh-sdk-server-agent-pkg-{target}"
    executable.write_bytes(b"runtime")
    executable.chmod(0o755)
    expected = {executable.name: b"runtime"}
    ripgrep = Path(f"{executable}-rg")
    ripgrep.write_bytes(b"ripgrep")
    ripgrep.chmod(0o755)
    expected[ripgrep.name] = b"ripgrep"
    if with_helper:
        spawn_helper = Path(f"{executable}-spawn-helper")
        spawn_helper.write_bytes(b"helper")
        spawn_helper.chmod(0o755)
        expected[spawn_helper.name] = b"helper"
    destination = tmp_path / "staging"

    build_python_release.stage_runtime(destination, "1.2.3", executable, executable.name)

    runtime_dir = destination / "src" / "deepseek_harness_runtime" / "runtime"
    assert {path.name: path.read_bytes() for path in runtime_dir.glob("dsh-sdk-server-agent-pkg-*")} == expected
