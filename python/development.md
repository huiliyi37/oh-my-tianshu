# Python contributor workflows

English | [中文](development.zh.md)

Follow the workflow for the contributor outcome you need: build runtime artifacts, validate the SDK, run against source, or build distributions. Package behavior belongs in the [SDK reference](sdk/README.md) and [runtime carrier reference](sdk-runtime/README.md).

## Build runtime artifacts

Platform executables are build artifacts and are not checked into git. Run the build from the repository root:

```sh
pnpm install
pnpm exec tsx scripts/build-exe-for-python-sdk.ts
```

Use `--skip-build` when the required `lib/` artifacts already exist, or `--targets=node24-linux-x64,node24-linux-arm64,node24-macos-arm64` to select platforms. Products land in `dist-exe/` and the script syncs the selected carriers into `python/sdk-runtime/`. macOS builds also sync the matching spawn helper required by `node-pty`.

## Validate the SDK

Keep the virtual environment outside `python/`, install the test group, and run the Python suite:

```sh
export UV_PROJECT_ENVIRONMENT="$PWD/tmp/py-sdk-venv"
uv sync --project python/sdk --group test
uv run --project python/sdk pytest
```

`python/sdk/tests/test_bundled_runtime.py` exercises available bundled carriers and skips a carrier when its artifact has not been built. For repository-wide test policy, see [Testing](../docs/testing.md).

An interactive smoke test needs `DEEPSEEK_API_KEY` in the environment or repository-root `.env`:

```python
from deepseek_harness import DeepSeekHarness

with DeepSeekHarness() as harness:
    print(harness.run("say hi").final_response)
```

## Run against Node source

Repository contributors can select either development carrier:

- Set `DSH_RUNTIME_MODE=node` to use the built Node carrier on system Node `>=22.19`. The build script refreshes this carrier, but distributions never include or auto-select it.
- Set `launch_args_override=("./node_modules/.bin/tsx", "packages/examples/jsonrpc-demo/src/bin.ts")` with the repository root as `cwd` to run unbuilt TypeScript source. Supply `cordis=...` when the default configuration is not suitable.

See `python/sdk/tests/manual_sdk_agent_smoke.py` for a complete source-mode invocation.

## Build distributions

The root `package.json` version is authoritative for both Python distributions. The staging script injects that version into both wheels and pins the SDK to the same `deepseek-harness-runtime-bin` version.

Build the pure SDK wheel once and one runtime wheel on each native platform:

```sh
version="$(node -p "require('./package.json').version")"
python scripts/build-python-release.py --package sdk --output-dir dist-python
python scripts/build-python-release.py --package runtime --platform macos-arm64 --runtime-exe dist-exe/dsh-jsonrpc-agent-pkg-macos-arm64 --output-dir dist-python
pip install --find-links dist-python deepseek-harness=="$version"
```

The runtime distribution is wheel-only. The release pipeline publishes three platform wheels with the pure SDK wheel: Linux x64, Linux arm64, and macOS arm64. A `python-vX.Y.Z` tag is accepted only when it matches the repository version.
