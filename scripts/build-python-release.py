#!/usr/bin/env python3
"""Stage and build one Python wheel at the repository version."""

from __future__ import annotations

import argparse
import email
import json
import os
import re
import shutil
import stat
import subprocess
import tempfile
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLATFORMS = {
    "linux-x64": ("manylinux_2_28_x86_64", "dsh-sdk-server-agent-pkg-linux-x64"),
    "linux-arm64": ("manylinux_2_28_aarch64", "dsh-sdk-server-agent-pkg-linux-arm64"),
    "macos-arm64": ("macosx_11_0_arm64", "dsh-sdk-server-agent-pkg-macos-arm64"),
}


def runtime_suffixes(executable_name: str) -> tuple[str, ...]:
    suffixes = ("", "-rg")
    return (*suffixes, "-spawn-helper") if "-macos-" in executable_name else suffixes


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", choices=("sdk", "runtime"), required=True)
    parser.add_argument(
        "--tag",
        help="optional python-vX.Y.Z release tag; it must match package.json",
    )
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--platform", choices=tuple(PLATFORMS))
    parser.add_argument("--runtime-exe", type=Path)
    args = parser.parse_args()
    version = repository_version()
    validate_release_tag(args.tag, version)
    if args.package == "runtime" and (args.platform is None or args.runtime_exe is None):
        parser.error("runtime builds require --platform and --runtime-exe")
    if args.package == "sdk" and (args.platform is not None or args.runtime_exe is not None):
        parser.error("SDK builds do not accept --platform or --runtime-exe")

    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="dsh-python-release-") as temporary:
        staging = Path(temporary) / args.package
        if args.package == "sdk":
            stage_sdk(staging, version)
            environment = None
            expected = output_dir / f"deepseek_harness-{version}-py3-none-any.whl"
        else:
            platform_tag, executable_name = PLATFORMS[args.platform]
            stage_runtime(staging, version, args.runtime_exe.resolve(), executable_name)
            environment = {"DSH_RUNTIME_PLATFORM_TAG": platform_tag}
            expected = output_dir / f"deepseek_harness_runtime_bin-{version}-py3-none-{platform_tag}.whl"
        command = ["uv", "build", "--wheel", "--out-dir", str(output_dir), str(staging)]
        subprocess.run(command, cwd=ROOT, env=None if environment is None else {**os.environ, **environment}, check=True)
    if not expected.is_file():
        raise RuntimeError(f"build did not produce expected wheel: {expected}")
    verify_wheel(expected, args.package, version, None if args.platform is None else PLATFORMS[args.platform])
    print(expected)


def repository_version(root: Path = ROOT) -> str:
    package_json = root / "package.json"
    try:
        payload = json.loads(package_json.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"could not read repository version from {package_json}") from error
    version = payload.get("version") if isinstance(payload, dict) else None
    if not isinstance(version, str) or re.fullmatch(r"\d+\.\d+\.\d+", version) is None:
        raise ValueError(
            f"{package_json} version must be stable X.Y.Z, got {version!r}"
        )
    return version


def validate_release_tag(tag: str | None, version: str) -> None:
    if tag is None:
        return
    expected = f"python-v{version}"
    if tag != expected:
        raise ValueError(
            f"release tag must match repository version: expected {expected!r}, got {tag!r}"
        )


def copy_package(source: Path, destination: Path) -> None:
    shutil.copytree(
        source,
        destination,
        ignore=shutil.ignore_patterns(
            ".venv",
            ".pytest_cache",
            "__pycache__",
            "*.pyc",
            "dist",
            "node_modules",
            "dsh-sdk-server-agent-pkg-*",
        ),
    )


def rewrite_version(pyproject: Path, version: str) -> None:
    text, count = re.subn(
        r'^version = "[^"]+"$',
        f'version = "{version}"',
        pyproject.read_text(),
        count=1,
        flags=re.MULTILINE,
    )
    if count != 1:
        raise RuntimeError(f"could not rewrite version in {pyproject}")
    pyproject.write_text(text)


def stage_sdk(destination: Path, version: str) -> None:
    copy_package(ROOT / "python" / "sdk", destination)
    pyproject = destination / "pyproject.toml"
    rewrite_version(pyproject, version)
    text, count = re.subn(
        r'"deepseek-harness-runtime-bin==[^"]+"',
        f'"deepseek-harness-runtime-bin=={version}"',
        pyproject.read_text(),
        count=1,
    )
    if count != 1:
        raise RuntimeError("SDK must contain exactly one runtime dependency pin")
    pyproject.write_text(text)


def stage_runtime(destination: Path, version: str, executable: Path, executable_name: str) -> None:
    copy_package(ROOT / "python" / "sdk-runtime", destination)
    rewrite_version(destination / "pyproject.toml", version)
    runtime_dir = destination / "src" / "deepseek_harness_runtime" / "runtime"
    runtime_dir.mkdir(parents=True, exist_ok=True)
    for suffix in runtime_suffixes(executable_name):
        shutil.copy2(Path(f"{executable}{suffix}"), runtime_dir / f"{executable_name}{suffix}")


def verify_wheel(
    wheel: Path,
    package: str,
    version: str,
    platform: tuple[str, str] | None,
) -> None:
    expected_tag = "py3-none-any" if platform is None else f"py3-none-{platform[0]}"
    with zipfile.ZipFile(wheel) as archive:
        wheel_metadata_path = next(name for name in archive.namelist() if name.endswith(".dist-info/WHEEL"))
        metadata_path = next(name for name in archive.namelist() if name.endswith(".dist-info/METADATA"))
        wheel_metadata = email.message_from_bytes(archive.read(wheel_metadata_path))
        metadata = email.message_from_bytes(archive.read(metadata_path))
        if wheel_metadata.get_all("Tag") != [expected_tag]:
            raise RuntimeError(f"{wheel} has wrong WHEEL tags: {wheel_metadata.get_all('Tag')}")
        if metadata.get("Version") != version:
            raise RuntimeError(f"{wheel} has version {metadata.get('Version')}, expected {version}")
        runtime_files = [
            name for name in archive.namelist() if "/runtime/dsh-sdk-server-agent-pkg-" in name
        ]
        if package == "runtime":
            assert platform is not None
            expected_files = [f"{platform[1]}{suffix}" for suffix in runtime_suffixes(platform[1])]
            found_files = sorted(Path(name).name for name in runtime_files)
            if found_files != expected_files:
                raise RuntimeError(f"{wheel} runtime payload must be {expected_files}, found {found_files}")
            for runtime_file in runtime_files:
                mode = archive.getinfo(runtime_file).external_attr >> 16
                if mode & stat.S_IXUSR == 0:
                    raise RuntimeError(f"{wheel} runtime executable lost its executable bit: {runtime_file}")
        elif runtime_files:
            raise RuntimeError(f"SDK wheel unexpectedly contains runtime executables: {runtime_files}")
        if package == "sdk":
            requirements = metadata.get_all("Requires-Dist") or []
            expected_requirement = f"deepseek-harness-runtime-bin=={version}"
            if expected_requirement not in requirements:
                raise RuntimeError(f"{wheel} does not pin {expected_requirement}; found {requirements}")


if __name__ == "__main__":
    main()
