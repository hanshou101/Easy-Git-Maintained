// Bundles src/main.ts into the single main.js that Obsidian loads (CommonJS, `module.exports` is the plugin class).
// Vite 8 runs Rolldown underneath (this project bundled with esbuild before).
//
//   npm run build -> vite build                              (production: minified, no source map)
//   npm run dev   -> vite build --watch --mode development   (not minified, inline source map)
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  const prod = mode !== "development";
  return {
    // The plugin root is the output directory: only main.js is written, nothing else is touched.
    // Vite prints "build.outDir must not be the same directory of root" for this layout; it is expected here
    // because emptyOutDir is false, so no source file is ever deleted.
    publicDir: false,
    logLevel: "info",
    build: {
      lib: { entry: "src/main.ts", formats: ["cjs"], fileName: () => "main.js" },
      outDir: ".",
      emptyOutDir: false,
      copyPublicDir: false,
      target: "es2022",
      minify: prod,
      sourcemap: prod ? false : "inline",
      reportCompressedSize: false,
      watch: prod ? null : {},
      rolldownOptions: {
        // Provided by Obsidian at runtime; must not be bundled.
        external: ["obsidian", "electron", /^@codemirror\//, /^@lezer\//],
        output: {
          // src/main.ts has exactly one export, the default Plugin class, so this writes
          // `module.exports = EasyGitPlugin`. A named export added later fails the build instead of being dropped.
          exports: "default",
          codeSplitting: false,
          // The sources are ES modules, which are strict by definition, and the previous esbuild bundle began with
          // "use strict". Rolldown only emits the directive when a source file has one, so ask for it explicitly.
          strict: true,
        },
      },
    },
  };
});
