# Maintenance model

This repository is an independent, long-lived maintained edition of Easy Git.

## Repository roles

- `origin`: `https://github.com/hanshou101/Easy-Git-Maintained.git` — the authoritative development and release repository.
- `upstream`: `https://github.com/Saiki77/Easy-Git.git` — a read-only reference for reviewing changes from the original project.
- A separate GitHub fork may be used only when contributing selected changes back upstream. Upstream pull requests never gate this repository's releases or merges.

## Upstream base

| | |
|---|---|
| Upstream repository | `https://github.com/Saiki77/Easy-Git` |
| Base release | 1.7.2 (upstream tag `1.7.2`) |
| Base commit | `2a08f0cff4931718f5e4f60b056599375a7d3204` ("chore: release 1.7.2", 2026-07-26) |

`main` contains upstream's history up to the base commit, which is the merge base of `main` and `upstream/main`. This edition's own commits are `git log --oneline 2a08f0cff4931718f5e4f60b056599375a7d3204..main`, and everything it changed is `git diff 2a08f0cff4931718f5e4f60b056599375a7d3204 main`.

To see what upstream has done since the base, diff against the base commit instead of comparing files by hand. Add the upstream remote once (`git remote add upstream https://github.com/Saiki77/Easy-Git.git`), then:

```bash
git fetch upstream --tags
git log --oneline 2a08f0cff4931718f5e4f60b056599375a7d3204..upstream/main
git diff --stat 2a08f0cff4931718f5e4f60b056599375a7d3204 upstream/main
git diff 2a08f0cff4931718f5e4f60b056599375a7d3204 upstream/main -- <path>
```

Whenever upstream changes are merged (see "Updating from upstream"), update this table to the new upstream commit in the same pull request, so the recorded base always matches the code. After such a merge, `git merge-base main upstream/main` gives the new base commit.

## Plugin id

| | |
|---|---|
| Plugin id | `easy-git-maintained` (`manifest.json`), name "Easy Git (Maintained)" |
| Upstream id | `easy-git`, also used by this edition up to 1.7.2 |
| Versions | `<upstream base>-maintained.<n>`, for example `1.7.2-maintained.1` |

Obsidian looks up installed plugin ids in its community plugin list to offer updates. With the upstream id, Obsidian 1.14.5 offered upstream Easy Git 1.9.0 as an update of the installed edition, and installing it would have replaced the edition with the upstream build (AME-1088). Never go back to `easy-git` or any other id in that list.

- `src/upstream-plugin.ts`: while the upstream plugin is installed and enabled in the vault, `onload()` shows a notice that stays and returns before registering anything. At the first start without a `data.json` of its own, `loadSettings()` takes over the upstream `data.json` (mappings with their sync state, auth, exclusions, options) from the upstream plugin's folder and saves it as its own. `scripts/upstream-plugin-regression.mjs` covers both.
- Kept as upstream on purpose, so that a switch keeps working data: the token secret id `easy-git-token`, the backup folder `.easy-git-backup/`, `.easygitignore`, and the CSS classes. Command ids follow the plugin id (`easy-git-maintained:*`).
- A release is an annotated tag equal to the manifest version, without `v`, on a merged commit of `main`; `.github/workflows/release.yml` builds, attests and publishes `main.js`, `manifest.json` and `styles.css`. Bump with `npm version <version> --no-git-tag-version`, which also updates `manifest.json` and `versions.json`.

## HugeRepo integration

This repository is consumed as `submodules/Easy-Git` by [`hanshou101/Awesome_ObsidianPlugin_HugeRepo`](https://github.com/hanshou101/Awesome_ObsidianPlugin_HugeRepo). Before work that can affect builds, releases, the submodule pointer, or installable artifacts, maintainers and agents must also read the HugeRepo [Submodule integration contract](https://github.com/hanshou101/Awesome_ObsidianPlugin_HugeRepo/blob/main/SUBMODULE_INTEGRATION.md).

**Definition of done.** An Easy-Git change is not finished when its PR merges here. The release completes only after the follow-up HugeRepo PR has advanced `submodules/Easy-Git` to the merged commit and regenerated `dist/Easy-Git/`. Agents must plan for that half of the work from the start: **check out `hanshou101/Awesome_ObsidianPlugin_HugeRepo` first** — it consumes this repository as `submodules/Easy-Git`, which is exactly how the integration side sees every change — read its `SUBMODULE_INTEGRATION.md`, and keep the HugeRepo update ready to run immediately after the merge. Never publish `dist/` artifacts from an unmerged branch of this repository.

The repository boundary is deliberate:

- Easy-Git-Maintained owns source, tests, releases, and its tracked production bundle `main.js`. Source changes that affect the bundle must rebuild and commit `main.js` here.
- After an Easy-Git PR is merged, a separate HugeRepo PR advances `submodules/Easy-Git` to the merged commit and regenerates `dist/Easy-Git/main.js`, `manifest.json`, and `styles.css` with `scripts/update-easy-git-package.mjs`. Those files install into `.obsidian/plugins/easy-git-maintained/`, the folder named after the plugin id.
- The HugeRepo gitlink and `dist/Easy-Git/` changes are delivered together. Do not hand-edit the copied files or publish them from an unmerged Easy-Git branch.
- An Easy-Git PR remains independently reviewable and mergeable; HugeRepo integration follows the merge and does not replace this repository's own validation.

## Updating from upstream

Upstream changes are imported deliberately, not automatically:

```bash
git fetch upstream --tags
git switch -c review/upstream-<version> main
git merge --no-ff upstream/main
```

Review the full diff, run the local regression suite, and resolve any conflict in favor of this edition's compatibility and maintenance requirements before opening a pull request into `main`. In the same pull request, update the "Upstream base" table above.

## Local validation

```bash
npm ci
npm run test:crlf
npm run test:hidden
npm run test:submodule
npm run test:upstream
npm run build
npm run lint
git diff --check
```

The tracked `main.js` must be rebuilt and committed whenever source changes affect the plugin bundle.
