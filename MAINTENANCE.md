# Maintenance model

This repository is an independent, long-lived maintained edition of Easy Git.

## Repository roles

- `origin`: `https://github.com/hanshou101/Easy-Git-Maintained.git` — the authoritative development and release repository.
- `upstream`: `https://github.com/Saiki77/Easy-Git.git` — a read-only reference for reviewing changes from the original project.
- A separate GitHub fork may be used only when contributing selected changes back upstream. Upstream pull requests never gate this repository's releases or merges.

## HugeRepo integration

This repository is consumed as `submodules/Easy-Git` by [`hanshou101/Awesome_ObsidianPlugin_HugeRepo`](https://github.com/hanshou101/Awesome_ObsidianPlugin_HugeRepo). Before work that can affect builds, releases, the submodule pointer, or installable artifacts, maintainers and agents must also read the HugeRepo [Submodule integration contract](https://github.com/hanshou101/Awesome_ObsidianPlugin_HugeRepo/blob/main/SUBMODULE_INTEGRATION.md).

The repository boundary is deliberate:

- Easy-Git-Maintained owns source, tests, releases, and its tracked production bundle `main.js`. Source changes that affect the bundle must rebuild and commit `main.js` here.
- After an Easy-Git PR is merged, a separate HugeRepo PR advances `submodules/Easy-Git` to the merged commit and regenerates `dist/Easy-Git/main.js`, `manifest.json`, and `styles.css` with `scripts/update-easy-git-package.mjs`.
- The HugeRepo gitlink and `dist/Easy-Git/` changes are delivered together. Do not hand-edit the copied files or publish them from an unmerged Easy-Git branch.
- An Easy-Git PR remains independently reviewable and mergeable; HugeRepo integration follows the merge and does not replace this repository's own validation.

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
