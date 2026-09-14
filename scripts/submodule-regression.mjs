import assert from "node:assert/strict";
import esbuild from "esbuild";

const testSource = `
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { SyncEngine } from "./src/sync/engine";
import { isExcluded } from "./src/sync/exclusion";

const encoder = new TextEncoder();
const bytes = (s: string) => encoder.encode(s);

function folderOf(path: string, children: unknown[] = []): any {
  const folder = new TFolder(path) as any;
  for (const child of children) folder.children.push(child);
  return folder;
}

function fileOf(path: string, content: Uint8Array): any {
  const file = new TFile() as any;
  const name = path.slice(path.lastIndexOf("/") + 1);
  file.path = path;
  file.name = name;
  file.extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  file.stat = { ctime: 1, mtime: 2, size: content.byteLength };
  return file;
}

class MemoryAdapter {
  files: Map<string, Uint8Array>;
  listings: Map<string, { files: string[]; folders: string[] }>;
  constructor(files: Record<string, string>, listings: Record<string, { files: string[]; folders: string[] }>) {
    this.files = new Map(Object.entries(files).map(([p, c]) => [p, bytes(c)]));
    this.listings = new Map(Object.entries(listings));
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.listings.has(path);
  }
  async list(path: string) {
    const listing = this.listings.get(path === "" ? "/" : path);
    if (!listing) throw new Error("Folder not found: " + path);
    return listing;
  }
  async stat(path: string) {
    const file = this.files.get(path);
    return file ? { type: "file", ctime: 1, mtime: 2, size: file.byteLength } : null;
  }
  async read(path: string): Promise<string> {
    const file = this.files.get(path);
    if (!file) throw new Error("File not found: " + path);
    return new TextDecoder().decode(file);
  }
  async readBinary(path: string): Promise<ArrayBuffer> {
    const file = this.files.get(path);
    if (!file) throw new Error("File not found: " + path);
    return file.slice().buffer;
  }
}

function makeEnv(rootFolder: any, getFolderByPath: (p: string) => any, adapter: MemoryAdapter) {
  const app: any = {
    vault: {
      adapter,
      configDir: ".obsidian",
      getRoot: () => rootFolder,
      getFolderByPath,
      readBinary: async (file: any) => {
        const bytesFile = adapter.files.get(file.path);
        if (!bytesFile) throw new Error("File not found: " + file.path);
        return bytesFile.slice().buffer;
      },
    },
  };
  const settings: any = {
    auth: { method: "none", token: "", provider: "github" },
    mappings: [],
    excludedPaths: [],
    maxFileSizeBytes: 1024 * 1024,
    showNotifications: false,
    debugLogging: false,
  };
  const engine: any = new SyncEngine({
    app,
    settings,
    saveSettings: async () => undefined,
    resolveConflicts: async () => [],
  });
  return engine;
}

// ---------------------------------------------------------------------------
// Scenario 1: the AME-525 report — whole-vault mapping of a repo that
// declares a submodule, where the user cloned the sub-repo into the
// submodule path by hand. Neither the sub-repo's working tree nor its
// .git internals may be scanned; parent-repo dotfiles (.gitignore,
// .gitmodules) must still sync. A nested repo two levels down
// (libs/nested-sub) must be caught without flagging its parent.
// ---------------------------------------------------------------------------
const exportNote = fileOf("Multica平台产物导出/export-note.md", bytes("sub repo note"));
const root = folderOf("", [
  fileOf("note.md", bytes("vault note")),
  folderOf("Multica平台产物导出", [exportNote]),
  folderOf("libs", [folderOf("libs/nested-sub", [fileOf("libs/nested-sub/nested.md", bytes("nested"))])]),
]);
const adapter1 = new MemoryAdapter(
  {
    "note.md": "vault note",
    ".gitignore": "node_modules/",
    ".gitmodules": "[submodule export]\\n path = Multica平台产物导出",
    "Multica平台产物导出/export-note.md": "sub repo note",
    "Multica平台产物导出/.gitignore": "dist/",
    "Multica平台产物导出/.git/config": "[core]",
    "Multica平台产物导出/.git/objects/pack/pack-abc.pack": "PACK...",
    "libs/nested-sub/nested.md": "nested",
    "libs/nested-sub/.git/HEAD": "ref: refs/heads/main",
  },
  {
    "/": {
      files: [".gitignore", ".gitmodules"],
      folders: [".git", "Multica平台产物导出", "libs", ".hidden-clone"],
    },
    ".git": { files: [".git/config"], folders: [] },
    "Multica平台产物导出": {
      files: ["Multica平台产物导出/export-note.md", "Multica平台产物导出/.gitignore"],
      folders: ["Multica平台产物导出/.git"],
    },
    "Multica平台产物导出/.git": {
      files: ["Multica平台产物导出/.git/config"],
      folders: ["Multica平台产物导出/.git/objects"],
    },
    "Multica平台产物导出/.git/objects": {
      files: ["Multica平台产物导出/.git/objects/pack/pack-abc.pack"],
      folders: [],
    },
    libs: { files: [], folders: ["libs/nested-sub"] },
    "libs/nested-sub": { files: ["libs/nested-sub/nested.md"], folders: ["libs/nested-sub/.git"] },
    "libs/nested-sub/.git": { files: ["libs/nested-sub/.git/HEAD"], folders: [] },
    ".hidden-clone": { files: [".hidden-clone/data.json"], folders: [".hidden-clone/.git"] },
    ".hidden-clone/.git": { files: [".hidden-clone/.git/HEAD"], folders: [] },
  },
);
const engine1 = makeEnv(root, () => null, adapter1);
const mapping1: any = {
  id: "m1",
  name: "Whole vault",
  vaultFolder: "",
  direction: "push",
  destinations: [],
};
const scan1 = await engine1.scanLocalFolder(mapping1);

assert.deepEqual(
  scan1.ignoredEmbeddedRepos.slice().sort(),
  ["Multica平台产物导出", "libs/nested-sub"],
  "The cloned submodule folder and the nested repo must be reported as embedded repo roots, not their parents",
);
assert.deepEqual(
  Object.keys(scan1.files).sort(),
  [".gitignore", ".gitmodules", "note.md"],
  "Only parent-repo content may be scanned: no submodule worktree files, no .git internals, no hidden clone files",
);
assert.ok(
  scan1.excludePatterns.includes("Multica平台产物导出/**"),
  "The embedded repo root must become an exclude pattern",
);
assert.ok(
  !scan1.excludePatterns.includes("libs/**"),
  "A folder merely containing a repo must stay syncable",
);
assert.equal(
  isExcluded("Multica平台产物导出/export-note.md", scan1.excludePatterns),
  true,
  "Remote-side filter space: submodule paths must be excluded so they are invisible on both sides",
);
assert.equal(
  isExcluded("libs/nested-sub/nested.md", scan1.excludePatterns),
  true,
  "Nested repo paths must be excluded in repo-relative space too",
);
assert.equal(isExcluded("note.md", scan1.excludePatterns), false, "Normal files must stay syncable");

// ---------------------------------------------------------------------------
// Scenario 2: mapping points at a subfolder ("sub") that contains a
// cloned repo ("sub/mod"). Patterns must cover the mapping-relative
// space the remote-path filter matches against, and a .git directory
// inside the mapping root itself must never leak either.
// ---------------------------------------------------------------------------
const subFolder = folderOf("sub", [
  fileOf("sub/other.md", bytes("other")),
  folderOf("sub/mod", [fileOf("sub/mod/inner.md", bytes("inner"))]),
]);
const adapter2 = new MemoryAdapter(
  {
    "sub/other.md": "other",
    "sub/mod/inner.md": "inner",
    "sub/mod/.git/config": "[core]",
    "sub/.git/config": "[core]",
  },
  {
    sub: { files: ["sub/other.md"], folders: ["sub/mod", "sub/.git"] },
    "sub/mod": { files: ["sub/mod/inner.md"], folders: ["sub/mod/.git"] },
    "sub/mod/.git": { files: ["sub/mod/.git/config"], folders: [] },
    "sub/.git": { files: ["sub/.git/config"], folders: [] },
  },
);
const engine2 = makeEnv(null, (p: string) => (p === "sub" ? subFolder : null), adapter2);
const mapping2: any = {
  id: "m2",
  name: "Subfolder mapping",
  vaultFolder: "sub",
  direction: "both",
  destinations: [],
};
const scan2 = await engine2.scanLocalFolder(mapping2);

assert.deepEqual(
  scan2.ignoredEmbeddedRepos,
  ["sub/mod"],
  "A repo cloned inside the mapped subfolder must be detected with its vault-absolute path",
);
assert.deepEqual(
  Object.keys(scan2.files).sort(),
  ["other.md"],
  "Only mapping-folder files may be scanned: no repo worktree, no .git of the repo or of the mapping root",
);
assert.ok(
  scan2.excludePatterns.includes("sub/mod/**") && scan2.excludePatterns.includes("mod/**"),
  "Non-root mappings need both the vault-absolute and the mapping-relative pattern",
);
assert.equal(
  isExcluded("mod/inner.md", scan2.excludePatterns),
  true,
  "Remote paths are repo-relative relative to the mapping folder, so mod/** must exclude them",
);
assert.equal(isExcluded("other.md", scan2.excludePatterns), false, "Mapping-root files must stay syncable");
`;

const result = await esbuild.build({
  stdin: {
    contents: testSource,
    resolveDir: process.cwd(),
    sourcefile: "submodule-regression.ts",
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  write: false,
  plugins: [
    {
      name: "obsidian-stub",
      setup(build) {
        build.onResolve({ filter: /^obsidian$/ }, () => ({
          path: "obsidian",
          namespace: "obsidian-stub",
        }));
        build.onLoad({ filter: /.*/, namespace: "obsidian-stub" }, () => ({
          loader: "js",
          contents: `
            export class TFolder {
              constructor(path = "") { this.path = path; this.children = []; }
            }
            export class TFile {}
            export class Notice { constructor() {} }
            export function normalizePath(path) {
              return path.replace(/\\\\/g, "/").replace(/^\\/+/, "");
            }
            export const requestBodies = [];
            export async function requestUrl(options) {
              requestBodies.push(options.body);
              return { status: 200, text: "{}" };
            }
          `,
        }));
      },
    },
  ],
});

assert.equal(result.outputFiles.length, 1);
const encoded = Buffer.from(result.outputFiles[0].contents).toString("base64");
await import(`data:text/javascript;base64,${encoded}`);
console.log("Submodule regression checks passed");
