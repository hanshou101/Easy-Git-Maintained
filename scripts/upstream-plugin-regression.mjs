import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = "\0upstream-plugin-regression.ts";
const OBSIDIAN_STUB = "\0obsidian-stub";

const testSource = `
import assert from "node:assert/strict";
import { notices } from "obsidian";
import EasyGitPlugin from "./src/main";
import {
  UPSTREAM_PLUGIN_ID,
  readUpstreamSettings,
  upstreamPluginEnabled,
} from "./src/upstream-plugin";

const OWN = { id: "easy-git-maintained", name: "Easy Git (Maintained)", version: "1.7.2-maintained.1", dir: ".obsidian/plugins/easy-git-maintained" };
const UPSTREAM = { id: UPSTREAM_PLUGIN_ID, name: "Easy Git", version: "1.7.2", dir: ".obsidian/plugins/easy-git" };

interface Vault {
  files?: Record<string, string>;
  enabled?: string[];
  installed?: Record<string, { id: string; dir?: string }>;
  secrets?: Record<string, string> | null;
  pluginsApi?: boolean;
}

function appOf(vault: Vault = {}) {
  const files = new Map(Object.entries(vault.files ?? {}));
  const reads: string[] = [];
  const secrets = vault.secrets === null ? null : new Map(Object.entries(vault.secrets ?? {}));
  const app: any = {
    vault: {
      configDir: ".obsidian",
      adapter: {
        exists: async (p: string) => files.has(p),
        read: async (p: string) => {
          reads.push(p);
          if (!files.has(p)) throw new Error("ENOENT " + p);
          return files.get(p);
        },
      },
      getFolderByPath: () => null,
      getAllFolders: () => [],
      on: () => ({}),
      offref: () => {},
    },
    workspace: { onLayoutReady: () => {} },
  };
  if (vault.pluginsApi !== false) {
    app.plugins = {
      enabledPlugins: new Set(vault.enabled ?? []),
      manifests: { ...(vault.installed ?? {}) },
    };
  }
  if (secrets) {
    app.secretStorage = {
      getSecret: (id: string) => secrets.get(id) ?? null,
      setSecret: (id: string, value: string) => void secrets.set(id, value),
    };
  }
  return { app, files, reads, secrets };
}

/** The plugin as Obsidian constructs it, with data.json in its own folder. */
function pluginOf(vault: Vault = {}, manifest = OWN) {
  const context = appOf(vault);
  const plugin: any = new EasyGitPlugin(context.app, manifest as any);
  return { plugin, ...context };
}

const upstreamData = {
  mappings: [
    {
      id: "m1",
      name: "Notes",
      vaultFolder: "Notes",
      direction: "both",
      autoMode: { kind: "interval", minutes: 5 },
      destinations: [
        {
          id: "d1",
          repoOwner: "alice",
          repoName: "notes",
          branch: "main",
          remoteFolder: "",
          lastSyncAt: 1790000000000,
          lastSyncState: { baseCommitSha: "abc123", baseTreeSha: "def456", files: { "Notes/a.md": { sha: "sha-a", size: 3 } } },
        },
      ],
    },
  ],
  auth: { method: "pat", token: "", provider: "github", username: "alice" },
  excludedPaths: [".easy-git-backup/**", ".DS_Store", ".trash/**", ".obsidian/**", ".git/**", "Private/**"],
  maxFileSizeBytes: 50_000_000,
};

// --- upstreamPluginEnabled ---
{
  const installed = { [UPSTREAM_PLUGIN_ID]: UPSTREAM };
  assert.equal(upstreamPluginEnabled(appOf({ enabled: [UPSTREAM_PLUGIN_ID], installed }).app, OWN as any), true);
  assert.equal(upstreamPluginEnabled(appOf({ installed }).app, OWN as any), false, "installed but disabled");
  assert.equal(
    upstreamPluginEnabled(appOf({ enabled: [UPSTREAM_PLUGIN_ID] }).app, OWN as any),
    false,
    "an id left in community-plugins.json after its folder now holds this edition",
  );
  assert.equal(upstreamPluginEnabled(appOf({ pluginsApi: false }).app, OWN as any), false, "no plugins API");
  assert.equal(
    upstreamPluginEnabled(appOf({ enabled: [UPSTREAM_PLUGIN_ID], installed }).app, UPSTREAM as any),
    false,
    "a build with the upstream id is never next to itself",
  );
}

// --- readUpstreamSettings ---
{
  const json = JSON.stringify(upstreamData);
  // Folder named after the id.
  let { app } = appOf({ files: { ".obsidian/plugins/easy-git/data.json": json } });
  assert.deepEqual(await readUpstreamSettings(app, OWN as any), upstreamData);
  // A manual install in a folder of another name.
  ({ app } = appOf({
    files: { ".obsidian/plugins/Easy-Git/data.json": json },
    installed: { [UPSTREAM_PLUGIN_ID]: { id: UPSTREAM_PLUGIN_ID, dir: ".obsidian/plugins/Easy-Git" } },
  }));
  assert.deepEqual(await readUpstreamSettings(app, OWN as any), upstreamData);
  ({ app } = appOf());
  assert.equal(await readUpstreamSettings(app, OWN as any), null, "no upstream data.json");
  const error = console.error;
  console.error = () => {};
  try {
    ({ app } = appOf({ files: { ".obsidian/plugins/easy-git/data.json": "{ truncated" } }));
    assert.equal(await readUpstreamSettings(app, OWN as any), null, "unreadable upstream data.json");
  } finally {
    console.error = error;
  }
  ({ app } = appOf({ files: { ".obsidian/plugins/easy-git/data.json": "[]" } }));
  assert.equal(await readUpstreamSettings(app, OWN as any), null, "not a settings object");
  ({ app } = appOf({ files: { ".obsidian/plugins/easy-git/data.json": json } }));
  assert.equal(await readUpstreamSettings(app, UPSTREAM as any), null, "a build with the upstream id");
}

// --- First start: the edition takes over the upstream settings ---
{
  notices.length = 0;
  const { plugin, secrets } = pluginOf({
    files: { ".obsidian/plugins/easy-git/data.json": JSON.stringify(upstreamData) },
    secrets: { "easy-git-token": "ghp_from_keychain" },
  });
  plugin.data = null;
  await plugin.loadSettings();

  const dest = plugin.settings.mappings[0].destinations[0];
  assert.equal(plugin.settings.mappings.length, 1);
  assert.equal(plugin.settings.mappings[0].vaultFolder, "Notes");
  assert.deepEqual(dest.lastSyncState, upstreamData.mappings[0].destinations[0].lastSyncState, "sync state carried over");
  assert.equal(dest.lastSyncAt, 1790000000000);
  assert.ok(plugin.settings.excludedPaths.includes("Private/**"));
  assert.equal(plugin.settings.auth.method, "pat", "still signed in");
  assert.equal(plugin.settings.auth.token, "ghp_from_keychain", "token read from the keychain");
  assert.equal(plugin.saved.length, 1, "saved once into the edition's own data.json");
  assert.equal(plugin.saved[0].auth.token, "", "no token in data.json");
  assert.equal(plugin.saved[0].mappings[0].destinations[0].lastSyncState.baseCommitSha, "abc123");
  assert.equal(secrets.get("easy-git-token"), "ghp_from_keychain");
  assert.deepEqual(notices, [
    { message: "Easy Git (Maintained) copied the settings of the upstream Easy Git plugin (easy-git).", duration: undefined },
  ]);
}

// --- A token kept in data.json (Obsidian before 1.11.4) comes along ---
{
  notices.length = 0;
  const { plugin } = pluginOf({
    files: {
      ".obsidian/plugins/easy-git/data.json": JSON.stringify({
        ...upstreamData,
        auth: { ...upstreamData.auth, token: "ghp_plaintext" },
      }),
    },
    secrets: null,
  });
  plugin.data = null;
  await plugin.loadSettings();
  assert.equal(plugin.settings.auth.token, "ghp_plaintext");
  assert.equal(plugin.saved[0].auth.token, "ghp_plaintext");
}

// --- Later starts read the edition's own data.json only ---
{
  notices.length = 0;
  const own = { ...upstreamData, mappings: [] };
  const { plugin, reads } = pluginOf({
    files: { ".obsidian/plugins/easy-git/data.json": JSON.stringify(upstreamData) },
    secrets: { "easy-git-token": "ghp_from_keychain" },
  });
  plugin.data = own;
  await plugin.loadSettings();
  assert.equal(plugin.settings.mappings.length, 0);
  assert.deepEqual(reads, [], "upstream data.json not read");
  assert.deepEqual(notices, []);
}

// --- An unreadable own data.json is not replaced by the upstream settings ---
{
  notices.length = 0;
  const { plugin, reads } = pluginOf({
    files: { ".obsidian/plugins/easy-git/data.json": JSON.stringify(upstreamData) },
  });
  plugin.data = new Error("Unexpected end of JSON input");
  const error = console.error;
  console.error = () => {};
  try {
    await plugin.loadSettings();
  } finally {
    console.error = error;
  }
  assert.equal(plugin.settings.mappings.length, 0);
  assert.deepEqual(reads, []);
  assert.equal(notices.length, 1);
  assert.match(notices[0].message, /could not read saved settings/);
}

// --- A vault without the upstream plugin starts from the defaults ---
{
  notices.length = 0;
  const { plugin } = pluginOf();
  plugin.data = null;
  await plugin.loadSettings();
  assert.equal(plugin.settings.mappings.length, 0);
  assert.deepEqual(notices, []);
}

// --- Next to the enabled upstream plugin the edition does not start ---
{
  notices.length = 0;
  const { plugin } = pluginOf({
    files: { ".obsidian/plugins/easy-git/data.json": JSON.stringify(upstreamData) },
    enabled: [UPSTREAM_PLUGIN_ID, OWN.id],
    installed: { [UPSTREAM_PLUGIN_ID]: UPSTREAM, [OWN.id]: OWN },
  });
  plugin.data = null;
  await plugin.onload();
  assert.equal(plugin.stoppedForUpstream, true);
  assert.equal(plugin.commands.length, 0, "no commands");
  assert.equal(plugin.saved.length, 0, "no data.json of its own");
  assert.equal(plugin.settings, undefined);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].duration, 0, "the notice stays until dismissed");
  assert.match(notices[0].message, /^Easy Git \\(Maintained\\) is not running because the upstream Easy Git plugin \\(easy-git\\) is enabled\\./);
  plugin.onunload();
}

// --- Without it, the edition starts as before ---
{
  notices.length = 0;
  const { plugin } = pluginOf({
    files: { ".obsidian/plugins/easy-git/data.json": JSON.stringify(upstreamData) },
    enabled: [OWN.id],
    installed: { [UPSTREAM_PLUGIN_ID]: UPSTREAM, [OWN.id]: OWN },
    secrets: { "easy-git-token": "ghp_from_keychain" },
  });
  plugin.data = null;
  await plugin.onload();
  assert.equal(plugin.stoppedForUpstream, false);
  assert.deepEqual(
    plugin.commands.map((c: { id: string }) => c.id),
    ["sync-all", "sync-mapping", "push-mapping", "pull-mapping", "open-settings", "show-log", "reset-sync-state"],
  );
  assert.equal(plugin.settings.mappings[0].name, "Notes");
  plugin.onunload();
}
`;

// Bundle the test source (a virtual TypeScript entry whose "./src/..." imports resolve against the repo root) with
// Vite in SSR mode, so Node built-ins stay external and every dependency is inlined, then run it from memory.
// `obsidian` is replaced by a stub module: just enough of Plugin and the UI classes to construct the plugin.
const result = await build({
  configFile: false,
  root: repoRoot,
  publicDir: false,
  logLevel: "warn",
  ssr: { noExternal: true },
  plugins: [
    {
      name: "upstream-plugin-regression-entry",
      enforce: "pre",
      resolveId(source, importer) {
        if (source === ENTRY) return ENTRY;
        if (importer === ENTRY && source.startsWith("./")) {
          return this.resolve(path.join(repoRoot, source), undefined, { skipSelf: true });
        }
        return null;
      },
      load: (id) => (id === ENTRY ? testSource : null),
    },
    {
      name: "obsidian-stub",
      enforce: "pre",
      resolveId: (source) => (source === "obsidian" ? OBSIDIAN_STUB : null),
      load: (id) =>
        id === OBSIDIAN_STUB
          ? `
            export const notices = [];
            export class Notice {
              constructor(message, duration) { notices.push({ message, duration }); }
            }
            const element = () => ({
              addClass() {}, removeClass() {}, empty() {}, setText() {}, addEventListener() {},
            });
            export class Plugin {
              constructor(app, manifest) {
                this.app = app;
                this.manifest = manifest;
                // Test hooks: what loadData() returns (an Error is thrown), and what saveData() got.
                this.data = null;
                this.saved = [];
                this.commands = [];
              }
              async loadData() {
                if (this.data instanceof Error) throw this.data;
                return this.data === null ? null : structuredClone(this.data);
              }
              async saveData(data) { this.saved.push(structuredClone(data)); }
              addCommand(command) { this.commands.push(command); return command; }
              addSettingTab() {}
              addRibbonIcon() { return element(); }
              addStatusBarItem() { return element(); }
              registerEvent() {}
              registerInterval(handle) { clearInterval(handle); return handle; }
            }
            export class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; } }
            export class Modal { constructor(app) { this.app = app; } }
            export class FuzzySuggestModal extends Modal {}
            export class Menu {}
            export class Setting {}
            export class ButtonComponent {}
            export class ToggleComponent {}
            export class TAbstractFile {}
            export class TFile extends TAbstractFile {}
            export class TFolder extends TAbstractFile {}
            export const Platform = { isMobile: false, isDesktop: true };
            export function debounce(fn) {
              const run = (...args) => fn(...args);
              run.cancel = () => run;
              return run;
            }
            export function normalizePath(path) {
              return path.replace(/\\\\/g, "/").replace(/^\\/+/, "");
            }
            export async function requestUrl() {
              throw new Error("no network in this test");
            }
          `
          : null,
    },
  ],
  build: {
    ssr: true,
    write: false,
    emptyOutDir: false,
    copyPublicDir: false,
    target: "node20",
    minify: false,
    reportCompressedSize: false,
    rolldownOptions: { input: ENTRY, output: { format: "esm", codeSplitting: false } },
  },
});

const output = (Array.isArray(result) ? result : [result]).flatMap((entry) => entry.output);
if (output.length !== 1 || output[0].type !== "chunk") throw new Error("expected one bundled chunk");
// The status bar ticker uses window.setInterval; Node has the same function globally.
globalThis.window ??= globalThis;
const encoded = Buffer.from(output[0].code).toString("base64");
await import(`data:text/javascript;base64,${encoded}`);
console.log("Upstream plugin regression checks passed");
