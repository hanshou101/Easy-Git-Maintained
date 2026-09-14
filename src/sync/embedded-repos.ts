/**
 * Detection of embedded git repositories inside a mapped vault folder.
 *
 * A folder that contains a `.git` entry — a directory (manual `git clone`)
 * or a file (`git submodule update --init`, `git worktree`) — is a
 * repository boundary. Git records such a folder as a single gitlink
 * (mode 160000) and never tracks the files inside it. Easy Git pushes
 * file blobs via the API and cannot represent gitlinks, so the whole
 * subtree of an embedded repo (a declared submodule's working tree, a
 * manually cloned repo, a linked worktree) must stay invisible to the
 * sync on both the local and the remote side, exactly like an excluded
 * path. Otherwise a cloned submodule is scanned as parent-repo content:
 * hundreds of API uploads, then failures on `.git` pack files.
 */

/** Minimal folder shape the detector needs; Obsidian's TFolder satisfies it. */
export interface FolderLike {
  path: string;
}

/**
 * Breadth-first walk over `seedFolders` and their descendants, probing
 * each folder exactly once. The first folder with a `.git` entry is an
 * embedded repo root: it is reported and NOT descended into, because git
 * can never track a parent repo's files inside a child repository.
 * The seed folders themselves are probed; the walk root is the caller's
 * responsibility (a mapping folder that is itself a repo root is a
 * legitimate sync target, not an embedded repo).
 *
 * Returns vault-absolute paths of embedded repo roots, discovery order.
 */
export async function findEmbeddedRepoRoots<T extends FolderLike>(
  seedFolders: T[],
  childFolders: (folder: T) => T[],
  hasGitEntry: (folderPath: string) => Promise<boolean>,
): Promise<string[]> {
  const roots: string[] = [];
  const queue = [...seedFolders];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const folder = queue.shift()!;
    if (seen.has(folder.path)) continue;
    seen.add(folder.path);
    if (await hasGitEntry(folder.path)) {
      roots.push(folder.path);
      continue;
    }
    queue.push(...childFolders(folder));
  }
  return roots;
}
