# SDK Release Runbook

The TypeScript and Python SDKs share one version and one release tag. Registry
versions are immutable; never reuse a published version for different bytes.

## External setup

Before the first tag release:

1. Make this source repository public. npm provenance requires the repository
   referenced by `package.json` to be publicly accessible.
2. Confirm `agent-ops-otel-sdk` is still available on npm and PyPI.
3. Configure npm Trusted Publishing for this repository and workflow.
4. Configure a PyPI pending/trusted publisher for this repository, workflow,
   and the `sdk-release` GitHub environment.
5. Create the `sdk-release` environment and require a human reviewer.
6. Confirm both registry accounts use multi-factor authentication.

Credentials and registry tokens are not stored in this repository.

## Dry run

Run the publish workflow manually from `main`. The `verify` job must:

- validate synchronized package and runtime versions;
- build the npm tarball, Python wheel, and source distribution;
- install each package into an isolated temporary environment;
- run success and failure-path content capture smoke tests;
- upload the immutable artifacts and SHA-256 checksums.

A manual run stops after verification and does not publish.

## Publish

Create an annotated tag from the verified commit:

```bash
git tag -a sdk-v0.1.0 -m "Agent Ops SDK v0.1.0"
git push origin sdk-v0.1.0
```

The workflow publishes npm and PyPI independently after environment approval,
then creates or updates the GitHub Release with the exact verified artifacts.

If one registry succeeds and the other fails, re-run only the failed publish
job. It must use the artifacts from that workflow run. If an artifact must
change, increment the patch version and create a new tag instead of replacing
the existing release.

## Post-publish verification

Run the package checks from a clean machine:

```bash
mkdir -p /tmp/agent-ops-otel-sdk-check-npm
cd /tmp/agent-ops-otel-sdk-check-npm
npm init -y
npm install agent-ops-otel-sdk@0.1.0
node --input-type=module -e "import { SDK_VERSION } from 'agent-ops-otel-sdk'; console.log(SDK_VERSION)"
python -m venv /tmp/agent-ops-otel-sdk-check-python
/tmp/agent-ops-otel-sdk-check-python/bin/pip install agent-ops-otel-sdk==0.1.0
/tmp/agent-ops-otel-sdk-check-python/bin/python -c "import agent_ops; print(agent_ops.__version__)"
```

The authoritative npm metadata check is:

```bash
npm view agent-ops-otel-sdk@0.1.0 version license repository.url
```
