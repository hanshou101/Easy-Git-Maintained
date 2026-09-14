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
// Scenario 1: the user's real topology — a whole-vault mapping over a
// plain library folder that CONTAINS the 2A-META repo. The repo carries
// .git and a .gitmodules declaring the Multica平台产物导出 submodule, which the
// user pulled by hand (it has .git and its own .gitmodules with a
// grandchild). Contract: ONLY .gitmodules-declared dirs are excluded;
// the repo's own files (and an undeclared nested repo's worktree) still
// sync; .git internals never do. Whole-vault sync must NOT drop 2A-META.
// ---------------------------------------------------------------------------
const root = folderOf("", [
  fileOf("note.md", bytes("vault note")),
  folderOf("2A-META", [
    fileOf("2A-META/note.md", bytes("repo note")),
    folderOf("2A-META/Multica平台产物导出", [
      fileOf("2A-META/Multica平台产物导出/export-note.md", bytes("sub repo note")),
      folderOf("2A-META/Multica平台产物导出/gc", [
        fileOf("2A-META/Multica平台产物导出/gc/inner.md", bytes("grandchild")),
      ]),
    ]),
  ]),
  folderOf("libs", [
    folderOf("libs/nested-sub", [fileOf("libs/nested-sub/nested.md", bytes("nested"))]),
  ]),
]);
const adapter1 = new MemoryAdapter(
  {
    "note.md": "vault note",
    ".gitignore": "node_modules/",
    "2A-META/note.md": "repo note",
    "2A-META/.gitmodules": '[submodule "export"]\\n\\tpath = Multica平台产物导出\\n\\turl = ../export.git',
    "2A-META/.git/HEAD": "ref: refs/heads/main",
    "2A-META/Multica平台产物导出/export-note.md": "sub repo note",
    "2A-META/Multica平台产物导出/.gitmodules": '[submodule "gc"]\\npath = gc\\nurl = ../gc.git',
    "2A-META/Multica平台产物导出/.git/HEAD": "ref: refs/heads/main",
    "2A-META/Multica平台产物导出/gc/inner.md": "grandchild",
    "2A-META/Multica平台产物导出/gc/.git/HEAD": "ref: refs/heads/main",
    "libs/nested-sub/nested.md": "nested",
    "libs/nested-sub/.git/HEAD": "ref: refs/heads/main",
  },
  {
    "/": { files: [".gitignore", "note.md"], folders: ["2A-META", "libs"] },
    "2A-META": {
      files: ["2A-META/note.md", "2A-META/.gitmodules"],
      folders: ["2A-META/.git", "2A-META/Multica平台产物导出"],
    },
    "2A-META/.git": { files: ["2A-META/.git/HEAD"], folders: [] },
    "2A-META/Multica平台产物导出": {
      files: ["2A-META/Multica平台产物导出/export-note.md", "2A-META/Multica平台产物导出/.gitmodules"],
      folders: ["2A-META/Multica平台产物导出/.git", "2A-META/Multica平台产物导出/gc"],
    },
    "2A-META/Multica平台产物导出/.git": { files: ["2A-META/Multica平台产物导出/.git/HEAD"], folders: [] },
    "2A-META/Multica平台产物导出/gc": {
      files: ["2A-META/Multica平台产物导出/gc/inner.md"],
      folders: ["2A-META/Multica平台产物导出/gc/.git"],
    },
    "2A-META/Multica平台产物导出/gc/.git": { files: ["2A-META/Multica平台产物导出/gc/.git/HEAD"], folders: [] },
    libs: { files: [], folders: ["libs/nested-sub"] },
    "libs/nested-sub": { files: ["libs/nested-sub/nested.md"], folders: ["libs/nested-sub/.git"] },
    "libs/nested-sub/.git": { files: ["libs/nested-sub/.git/HEAD"], folders: [] },
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
  scan1.ignoredSubmodules,
  ["2A-META/Multica平台产物导出"],
  "Only the .gitmodules-declared submodule dir is reported, not the repo itself and not undeclared repos",
);
assert.deepEqual(
  Object.keys(scan1.files).sort(),
  [".gitignore", "2A-META/.gitmodules", "2A-META/note.md", "libs/nested-sub/nested.md", "note.md"],
  "Repo files, parent dotfiles and undeclared-repo worktree files sync; submodule and grandchild files and all .git internals do not",
);
assert.ok(
  !scan1.excludePatterns.includes("2A-META/**"),
  "The repo itself must stay a sync target — .git presence is not an exclusion",
);
assert.equal(
  isExcluded("2A-META/Multica平台产物导出/export-note.md", scan1.excludePatterns),
  true,
  "Declared submodule paths must be excluded in remote-relative space for the runOnce filter",
);
assert.equal(
  isExcluded("2A-META/note.md", scan1.excludePatterns),
  false,
  "Repo files must stay syncable",
);

// ---------------------------------------------------------------------------
// Scenario 2: mapping root IS the repo (Easy Git maps 2A-META directly).
// Its own files sync; only its declared submodule dir is excluded, in
// both the vault-absolute and the mapping-relative pattern space.
// ---------------------------------------------------------------------------
const repoFolder = folderOf("2A-META", [
  fileOf("2A-META/note.md", bytes("repo note")),
  folderOf("2A-META/Multica平台产物导出", [
    fileOf("2A-META/Multica平台产物导出/export-note.md", bytes("sub repo note")),
  ]),
]);
const adapter2 = new MemoryAdapter(
  {
    "2A-META/note.md": "repo note",
    "2A-META/.gitmodules": '[submodule "export"]\\npath = Multica平台产物导出\\nurl = ../export.git',
    "2A-META/.git/HEAD": "ref: refs/heads/main",
    "2A-META/Multica平台产物导出/export-note.md": "sub repo note",
    "2A-META/Multica平台产物导出/.git/HEAD": "ref: refs/heads/main",
  },
  {
    "2A-META": {
      files: ["2A-META/note.md", "2A-META/.gitmodules"],
      folders: ["2A-META/.git", "2A-META/Multica平台产物导出"],
    },
    "2A-META/.git": { files: ["2A-META/.git/HEAD"], folders: [] },
    "2A-META/Multica平台产物导出": {
      files: ["2A-META/Multica平台产物导出/export-note.md"],
      folders: ["2A-META/Multica平台产物导出/.git"],
    },
    "2A-META/Multica平台产物导出/.git": { files: ["2A-META/Multica平台产物导出/.git/HEAD"], folders: [] },
  },
);
const engine2 = makeEnv(null, (p: string) => (p === "2A-META" ? repoFolder : null), adapter2);
const mapping2: any = {
  id: "m2",
  name: "Repo mapping",
  vaultFolder: "2A-META",
  direction: "both",
  destinations: [],
};
const scan2 = await engine2.scanLocalFolder(mapping2);

assert.deepEqual(
  scan2.ignoredSubmodules,
  ["2A-META/Multica平台产物导出"],
  "The mapping root being a repo with .git must still be walked for its .gitmodules",
);
assert.deepEqual(
  Object.keys(scan2.files).sort(),
  [".gitmodules", "note.md"],
  "Mapping-root repo files (including its own .gitmodules) sync; declared submodule files do not",
);
assert.ok(
  scan2.excludePatterns.includes("2A-META/Multica平台产物导出/**") &&
    scan2.excludePatterns.includes("Multica平台产物导出/**"),
  "Non-root mappings need both the vault-absolute and the mapping-relative pattern",
);
assert.equal(isExcluded("note.md", scan2.excludePatterns), false, "Mapping-root files must stay syncable");

// ---------------------------------------------------------------------------
// Scenario 3: the mapping root IS a pulled submodule (the user maps the
// sub-repo directly). Its .git is a FILE (gitlink pointer); its own
// files sync; only its OWN declared submodules (grandchildren) are
// excluded. Applying the same rule here must not block the mapping.
// ---------------------------------------------------------------------------
const subFolder = folderOf("sub", [
  fileOf("sub/data.md", bytes("data")),
  folderOf("sub/gc", [fileOf("sub/gc/inner.md", bytes("grandchild"))]),
]);
const adapter3 = new MemoryAdapter(
  {
    "sub/data.md": "data",
    "sub/.gitmodules": '[submodule "gc"]\\npath = gc\\nurl = ../gc.git',
    "sub/.git": "gitdir: ../.git/modules/sub",
    "sub/gc/inner.md": "grandchild",
    "sub/gc/.git/HEAD": "ref: refs/heads/main",
  },
  {
    sub: { files: ["sub/data.md", "sub/.gitmodules", "sub/.git"], folders: ["sub/gc"] },
    "sub/gc": { files: ["sub/gc/inner.md"], folders: ["sub/gc/.git"] },
    "sub/gc/.git": { files: ["sub/gc/.git/HEAD"], folders: [] },
  },
);
const engine3 = makeEnv(null, (p: string) => (p === "sub" ? subFolder : null), adapter3);
const mapping3: any = {
  id: "m3",
  name: "Submodule mapping",
  vaultFolder: "sub",
  direction: "both",
  destinations: [],
};
const scan3 = await engine3.scanLocalFolder(mapping3);

assert.deepEqual(
  scan3.ignoredSubmodules,
  ["sub/gc"],
  "A submodule mapped directly still excludes only its own declared children",
);
assert.deepEqual(
  Object.keys(scan3.files).sort(),
  [".gitmodules", "data.md"],
  "Submodule worktree files sync through their own mapping; grandchild files and the .git pointer file do not",
);
assert.ok(
  scan3.excludePatterns.includes("sub/gc/**") && scan3.excludePatterns.includes("gc/**"),
  "Both pattern spaces are needed for the remote-path filter",
);
assert.equal(
  isExcluded("gc/inner.md", scan3.excludePatterns),
  true,
  "Grandchild paths must be excluded in mapping-relative space",
);
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
