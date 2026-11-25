# SDK Release Runbook

The TypeScript and Python SDKs share one package version and one release tag.
Registry versions are immutable; never reuse a published version for different
bytes.

## Current release

| Field | Value |
| --- | --- |
| SDK version | `0.1.0` |
| Release tag | `sdk-v0.1.0` |
| Source commit | `387595c312e605475b0951147fd0dd102d014ab2` |
| Telemetry contract | `0.1` |
| Release workflow | [45577565069](https://github.com/DraskyChen/Agent-Ops/actions/runs/45577565069) |
| GitHub Release | [sdk-v0.1.0](https://github.com/DraskyChen/Agent-Ops/releases/tag/sdk-v0.1.0) |
| npm | [agent-ops-otel-sdk](https://www.npmjs.com/package/agent-ops-otel-sdk) |
| PyPI | [agent-ops-otel-sdk 0.1.0](https://pypi.org/project/agent-ops-otel-sdk/0.1.0/) |

The release workflow completed successfully for:

- quality and integration gates;
- Node.js 20 installation and Trace smoke;
- Python 3.11, 3.12, and 3.13 installation and Trace smoke;
- npm publication with SLSA provenance;
- PyPI publication through OIDC Trusted Publishing;
- GitHub Release creation with npm, wheel, sdist, and SHA-256 files.

## Package identity

The npm distribution and PyPI distribution intentionally use the same name:

```bash
npm install agent-ops-otel-sdk@0.1.0
pip install agent-ops-otel-sdk==0.1.0
```

The Python import name remains:

```python
import agent_ops
```

The TypeScript package is ESM-only. The `@agent-ops/sdk` name was never
published and is not a compatibility alias.

## Compatibility

| Runtime | Supported | Tested in v0.1.0 |
| --- | --- | --- |
| Node.js | `>=20` | Node.js 20 and 24 |
| Python | `>=3.11` | Python 3.11, 3.12, and 3.13 |
| Browser | Not supported | Not tested or packaged |
| CommonJS | Not supported | ESM package only |
| Agent Ops telemetry contract | Major version `0` | `0.1` |

## Published artifacts

GitHub Release assets are the canonical fallback when a registry is
unavailable:

| Artifact | SHA-256 |
| --- | --- |
| `agent-ops-otel-sdk-0.1.0.tgz` | `4568b40fea1c3a192e112eaf70e04ad7628c5f9179506d90d3d823ac28e02cbb` |
| `agent_ops_otel_sdk-0.1.0-py3-none-any.whl` | `1184b30325471bd08e2dd9df408e19acf8537b2637df981e331290dd921c80a9` |
| `agent_ops_otel_sdk-0.1.0.tar.gz` | `c793a19ce4c8375d5f7093858bf3660f8baf44a6dd5d105820209b7df3439c1a` |

The npm artifact has a public provenance attestation:

```text
https://registry.npmjs.org/-/npm/v1/attestations/agent-ops-otel-sdk@0.1.0
```

## Bootstrap history

Trusted Publishing can only be configured after an npm package exists. The
package was initialized before the stable release with:

- `0.0.0-stage`, created while reserving the package name;
- `0.1.0-rc.0`, the first installable bootstrap version.

These versions are retained for registry history and are not supported release
targets. Consumers should explicitly use `0.1.0` or a later stable version.

The one-time bootstrap used a granular npm token because publishing did not
work until device 2FA was enabled. Credentials are never stored in this
repository. After Trusted Publisher validation, revoke the
`agent-ops-otel-sdk-release` token and select the most restrictive npm package
publishing access option.

## Trusted publishing setup

The following GitHub and registry settings are active:

- `sdk-release` GitHub environment;
- environment restricted to `sdk-v*` tags;
- required human reviewer before publication;
- npm Trusted Publisher for `DraskyChen/Agent-Ops`;
- workflow `publish-sdk.yml`;
- environment `sdk-release`;
- npm direct publish permission;
- PyPI Trusted Publisher with the same repository, workflow, and environment;
- device 2FA enabled for the npm account.

Registry tokens must not be committed to the repository or added to the
workflow.

## Dry run

Run the publish workflow manually from `main`:

```bash
gh workflow run publish-sdk.yml --repo DraskyChen/Agent-Ops --ref main
```

A manual run stops after verification. It validates synchronized versions,
builds all artifacts, installs the actual outputs in clean environments, runs
success and failure content-capture paths, and uploads the artifact bundle.

## Release procedure

1. Update the SDK version in `packages/sdk-typescript/package.json` and
   `packages/sdk-python/src/agent_ops/_version.py`.
2. Run `pnpm sdk:check` and `pnpm sdk:verify`.
3. Commit to a `codex/*` branch, push, and open a pull request.
4. Wait for all required branch checks to pass and merge through the protected
   `main` branch.
5. Run the manual publish workflow as a dry run.
6. Create an annotated tag whose version matches both package manifests:

   ```bash
   git tag -a sdk-vX.Y.Z -m "Agent Ops SDK vX.Y.Z"
   git push origin sdk-vX.Y.Z
   ```

7. Approve the `sdk-release` environment deployment.
8. Verify npm, PyPI, provenance, GitHub Release assets, and clean installs.

## Post-publish verification

Run these checks from a clean directory:

```bash
mkdir -p /tmp/agent-ops-sdk-release-check
cd /tmp/agent-ops-sdk-release-check
npm init -y
npm install agent-ops-otel-sdk@0.1.0
node --input-type=module \
  -e "import { SDK_VERSION } from 'agent-ops-otel-sdk'; console.log(SDK_VERSION)"

python -m venv .venv
.venv/bin/pip install agent-ops-otel-sdk==0.1.0
.venv/bin/python -c "import agent_ops; print(agent_ops.__version__)"
```

Check registry metadata:

```bash
npm view agent-ops-otel-sdk@0.1.0 \
  version license repository.url dist.integrity dist.attestations.url
curl -fsSL https://pypi.org/pypi/agent-ops-otel-sdk/0.1.0/json
gh release view sdk-v0.1.0 --repo DraskyChen/Agent-Ops
```

Registry propagation can lag the successful workflow log. If npm returns 404
immediately, check the write-region packument before republishing:

```bash
curl -fsSL 'https://registry.npmjs.org/agent-ops-otel-sdk?write=true'
```

## Failure handling

- Never overwrite or move a release tag.
- Never publish different bytes under an existing registry version.
- If one registry succeeds and the other fails, retry the failed publish job
  from the same workflow run.
- If any artifact must change, publish a new patch version and tag.
- If registry propagation remains inconsistent, stop and inspect the registry
  before creating another version.

## Package naming

PyPI rejects names that differ from existing projects only by punctuation or
normalization. Before choosing a new name, verify all of:

```bash
npm view NEW_NAME version
curl -fsSL "https://pypi.org/pypi/NEW_NAME/json"
```

Do not assume hyphens make a name distinct. For example, `agent-ops-sdk`
conflicts with the existing normalized name `agentops-sdk`. This is why both
SDKs now use `agent-ops-otel-sdk`.
