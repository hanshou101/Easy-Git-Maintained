# Maintenance model

This repository is an independent, long-lived maintained edition of Easy Git.

## Repository roles

- `origin`: `https://github.com/hanshou101/Easy-Git-Maintained.git` — the authoritative development and release repository.
- `upstream`: `https://github.com/Saiki77/Easy-Git.git` — a read-only reference for reviewing changes from the original project.
- A separate GitHub fork may be used only when contributing selected changes back upstream. Upstream pull requests never gate this repository's releases or merges.

## Updating from upstream

Upstream changes are imported deliberately, not automatically:

```bash
git fetch upstream --tags
git switch -c review/upstream-<version> main
git merge --no-ff upstream/main
```

Review the full diff, run the local regression suite, and resolve any conflict in favor of this edition's compatibility and maintenance requirements before opening a pull request into `main`.

## Local validation

```bash
npm ci
npm run test:crlf
npm run test:hidden
npm run build
npm run lint
git diff --check
```

The tracked `main.js` must be rebuilt and committed whenever source changes affect the plugin bundle.
