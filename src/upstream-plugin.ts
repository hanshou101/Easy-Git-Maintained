import { App, PluginManifest } from "obsidian";

/**
 * Easy-Git-Maintained: the id of the upstream Easy Git plugin, which builds of
 * this edition up to 1.7.2 used as well. Obsidian offers updates by plugin id
 * from its community plugin list, so with that id every upstream release was
 * offered as an update that replaces this edition. The edition's own id
 * (manifest.json) is not in that list.
 */
export const UPSTREAM_PLUGIN_ID = "easy-git";

/** Obsidian's plugin manager is not in the public typings but is stable at
 * runtime. A narrow structural view keeps every access optional. */
interface AppWithPlugins {
  plugins?: {
    enabledPlugins?: Set<string>;
    manifests?: Record<string, PluginManifest | undefined>;
  };
}

function pluginManager(app: App): AppWithPlugins["plugins"] {
  return (app as unknown as AppWithPlugins).plugins;
}

/**
 * Whether the upstream plugin is installed and enabled in this vault. It
 * syncs the same folders to the same repositories with a sync state of its
 * own, so this edition does not start next to it.
 *
 * An id still listed as enabled whose plugin folder is gone, or now holds
 * this edition (its files copied over the old ones), does not count.
 */
export function upstreamPluginEnabled(app: App, manifest: PluginManifest): boolean {
  if (manifest.id === UPSTREAM_PLUGIN_ID) return false;
  const plugins = pluginManager(app);
  return (
    plugins?.enabledPlugins?.has(UPSTREAM_PLUGIN_ID) === true &&
    plugins.manifests?.[UPSTREAM_PLUGIN_ID] !== undefined
  );
}

/**
 * The upstream plugin's data.json in this vault, or null when it has none or
 * it cannot be read. On Obsidian 1.11.4+ the token is not in it: both
 * editions keep it in the system keychain under the same secret id, so this
 * edition finds it there.
 */
export async function readUpstreamSettings(
  app: App,
  manifest: PluginManifest,
): Promise<Record<string, unknown> | null> {
  if (manifest.id === UPSTREAM_PLUGIN_ID) return null;
  // A manual install may sit in a folder not named after the id.
  const dir =
    pluginManager(app)?.manifests?.[UPSTREAM_PLUGIN_ID]?.dir ??
    `${app.vault.configDir}/plugins/${UPSTREAM_PLUGIN_ID}`;
  const file = `${dir}/data.json`;
  try {
    if (!(await app.vault.adapter.exists(file))) return null;
    const data: unknown = JSON.parse(await app.vault.adapter.read(file));
    if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
    return data as Record<string, unknown>;
  } catch (e) {
    console.error(`Easy Git: could not read ${file}.`, e);
    return null;
  }
}
