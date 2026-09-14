/**
 * Submodule exclusion driven by `.gitmodules`.
 *
 * `.git` presence is NOT the judgment for what stays out of a sync: a
 * folder carrying a `.git` entry (a manual `git clone`, a submodule
 * pulled by git CLI) is often a legitimate sync target through its own
 * mapping. The only contract is: whatever a repo's `.gitmodules`
 * declares as a submodule path must not be uploaded again as part of
 * the containing sync — it is synced through its own mapping instead.
 *
 * Discovery therefore walks the mapping folder, finds every git repo at
 * or below it (the mapping root itself included), reads each repo's
 * `.gitmodules`, and reports the declared submodule directories. The
 * caller turns them into exclude patterns honoured by the file walk,
 * the hidden-path augmentation, and the remote-path filter.
 */

/** Minimal folder shape the walk needs; Obsidian's TFolder satisfies it. */
export interface FolderLike {
  path: string;
}

/** Async probe: does this folder contain a `.git` entry (dir or file)? */
export type GitEntryProbe = (folderPath: string) => Promise<boolean>;

/** Reads the `.gitmodules` text of the repo rooted at repoRoot; "" when absent. */
export type ReadGitmodules = (repoRoot: string) => Promise<string>;

/**
 * Parse `path = <value>` entries from `.gitmodules` content. Handles
 * CRLF, comments, surrounding quotes, and skips empty or unsafe values
 * (absolute paths, `..` segments). Returns unique declaration order.
 */
export function parseGitmodules(content: string): string[] {
  const paths = new Set<string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.split("#", 1)[0].trim();
    const match = /^path\s*=\s*(.+)$/.exec(line);
    if (!match) continue;
    let value = match[1].trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).trim();
    }
    if (!value || value === "." || value.startsWith("/") || value.split("/").includes("..")) continue;
    paths.add(value.replace(/\/+$/, ""));
  }
  return [...paths];
}

/** True when path equals root or lives under it; root "" is the whole vault. */
export function isUnderPath(path: string, root: string): boolean {
  if (root === "" || root === "/") return true;
  return path === root || path.startsWith(`${root}/`);
}

function joinSubmodulePath(repoRoot: string, subPath: string): string {
  if (repoRoot === "" || repoRoot === "/") return subPath;
  return `${repoRoot}/${subPath}`;
}

/**
 * Walk `walkRoot` (the mapping folder; "" whole-vault root allowed)
 * breadth-first, probing each folder once. A folder with a `.git` entry
 * is a repo root: its `.gitmodules` declarations become reported
 * submodule directories. Folders already under a reported submodule dir
 * are pruned — their subtree is invisible to this mapping's sync, so
 * repos nested inside a declared submodule need no discovery here (they
 * get their own walk when synced through their own mapping).
 *
 * Returns vault-absolute submodule directory paths, discovery order.
 */
export async function collectDeclaredSubmodules<T extends FolderLike>(
  walkRoot: T | null,
  childFolders: (folder: T) => T[],
  hasGitEntry: GitEntryProbe,
  readGitmodules: ReadGitmodules,
): Promise<string[]> {
  const submodules: string[] = [];
  if (!walkRoot) return submodules;
  const queue: T[] = [walkRoot];
  const seen = new Set<string>();
  walk: while (queue.length > 0) {
    const folder = queue.shift()!;
    if (seen.has(folder.path)) continue;
    seen.add(folder.path);
    for (const dir of submodules) {
      if (isUnderPath(folder.path, dir)) continue walk;
    }
    if (await hasGitEntry(folder.path)) {
      let content = "";
      try {
        content = await readGitmodules(folder.path);
      } catch {
        content = "";
      }
      for (const declared of parseGitmodules(content)) {
        const dir = joinSubmodulePath(folder.path, declared);
        if (!submodules.some((root) => isUnderPath(dir, root))) {
          submodules.push(dir);
        }
      }
    }
    queue.push(...childFolders(folder));
  }
  return submodules;
}
