import assert from "node:assert/strict";
import esbuild from "esbuild";

const testSource = `
import assert from "node:assert/strict";
import { classify } from "./src/sync/classifier";
import { rewriteWikilinks } from "./src/sync/wikilink-rewrite";
import { applyPullRestores, applyPushTransforms } from "./src/sync/markdown-transforms";
import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  computeGitBlobShaFromArrayBuffer,
  computeGitBlobShaFromString,
  decodeUtf8,
  encodeUtf8,
} from "./src/sync/blob-sha";
import {
  preparePullBuffer,
  preparePushBuffer,
  preferredLineEnding,
  preferredMergeLineEnding,
  pullLineEndingPolicy,
  pushLineEndingPolicy,
  splitLinesForMerge,
  splitLinesPreservingEndings,
} from "./src/sync/line-endings";
import { createFolderMapping } from "./src/types";

function assertOnlyCrLf(text: string, message: string): void {
  assert.equal(text.replace(/\\r\\n/g, "").includes("\\n"), false, message);
}

for (const fixture of [
  "",
  "one line",
  "ends with LF\\n",
  "ends with CRLF\\r\\n",
  "ends with CR\\r",
  "mixed\\r\\nsecond\\nthird\\rfourth",
]) {
  const rebuilt = splitLinesPreservingEndings(fixture)
    .map((line) => line.content + line.ending)
    .join("");
  assert.equal(rebuilt, fixture, "Line tokenization must be byte-for-byte reversible");
}

const input = [
  "# CRLF fixture",
  "plain text",
  "~~~ts",
  "const value = 1;",
  "~~~",
  "",
].join("\\r\\n");

const rewritten = rewriteWikilinks(input, {
  sourcePath: "notes/example.md",
  mappingVaultFolder: "notes",
  mappingRemoteFolder: "",
  resolve: () => null,
}).markdown;
const pushed = applyPushTransforms(rewritten).markdown;

assert.equal(
  pushed,
  input,
  "The Markdown-to-Blob preprocessing pipeline must preserve CRLF bytes when no content rewrite is needed",
);

const sourceBytes = new TextEncoder().encode(input);
const encodedBlob = arrayBufferToBase64(new TextEncoder().encode(pushed).buffer);
assert.deepEqual(
  new Uint8Array(base64ToArrayBuffer(encodedBlob)),
  sourceBytes,
  "The Base64 payload sent to the Git Blob API must contain the original CRLF bytes",
);

const defaultMapping = createFolderMapping();
assert.equal(defaultMapping.pushLineEndings, "preserve");
assert.equal(defaultMapping.pullLineEndings, "preserve");
assert.equal(
  pushLineEndingPolicy({ pushLineEndings: undefined } as any),
  "preserve",
  "Existing mappings must keep byte-preserving push behavior",
);
assert.equal(
  pullLineEndingPolicy({ pullLineEndings: undefined } as any),
  "preserve",
  "Existing mappings must keep byte-preserving pull behavior",
);

const lfMapping = { ...defaultMapping, pushLineEndings: "lf" as const };
const diskBuffer = encodeUtf8(input);
assert.equal(
  preparePushBuffer(defaultMapping, "example.md", diskBuffer),
  diskBuffer,
  "Preserve push policy must return the original bytes",
);
assert.equal(
  preparePullBuffer(defaultMapping, "example.md", diskBuffer),
  diskBuffer,
  "Preserve pull policy must return the original bytes",
);
const lfPushBuffer = preparePushBuffer(lfMapping, "example.md", diskBuffer);
const expectedLfBuffer = encodeUtf8(input.replace(/\\r\\n/g, "\\n"));
assert.deepEqual(
  new Uint8Array(lfPushBuffer),
  new Uint8Array(expectedLfBuffer),
  "LF push policy must normalize CRLF vault text before upload",
);
assert.deepEqual(
  new Uint8Array(diskBuffer),
  sourceBytes,
  "Push normalization must not mutate the vault buffer",
);

const canonicalSha = await computeGitBlobShaFromArrayBuffer(lfPushBuffer);
assert.equal(
  canonicalSha,
  await computeGitBlobShaFromArrayBuffer(expectedLfBuffer),
  "The local scan SHA must use the same LF bytes as the uploaded blob",
);
const secondSyncPlan = classify({
  local: {
    "example.md": {
      path: "example.md",
      sha: canonicalSha,
      size: lfPushBuffer.byteLength,
      mtime: 1,
    },
  },
  remote: {
    "example.md": {
      path: "example.md",
      sha: canonicalSha,
      size: lfPushBuffer.byteLength,
    },
  },
  lastState: {
    "example.md": { sha: canonicalSha, size: lfPushBuffer.byteLength, mtime: 1 },
  },
  direction: "both",
});
assert.equal(secondSyncPlan.actions.length, 0);
assert.equal(secondSyncPlan.conflicts.length, 0);
assert.equal(
  secondSyncPlan.noopCount,
  1,
  "A second sync of the unchanged CRLF vault file must not report modified",
);

const binaryBytes = new Uint8Array([0, 13, 10, 255, 13, 10]);
assert.deepEqual(
  new Uint8Array(preparePushBuffer(lfMapping, "image.png", binaryBytes.buffer)),
  binaryBytes,
  "Binary files must not be changed by line-ending policy",
);
assert.deepEqual(
  new Uint8Array(
    preparePullBuffer(
      { ...lfMapping, pullLineEndings: "crlf" },
      "image.png",
      binaryBytes.buffer,
    ),
  ),
  binaryBytes,
  "Binary files must not be changed by pull line-ending policy",
);

const wikilinkInput = ["![[asset.png]]", "after link", ""].join("\\r\\n");
const bomWikilinkDecoded = decodeUtf8(encodeUtf8(wikilinkInput, true));
const bomWikilinkOutput = rewriteWikilinks(bomWikilinkDecoded.text, {
  sourcePath: "notes/example.md",
  mappingVaultFolder: "notes",
  mappingRemoteFolder: "",
  resolve: () => ({ path: "notes/asset.png" }),
}).markdown;
const bomWikilinkBuffer = encodeUtf8(bomWikilinkOutput, bomWikilinkDecoded.hasBom);
assert.deepEqual(
  Array.from(new Uint8Array(bomWikilinkBuffer).slice(0, 3)),
  [0xef, 0xbb, 0xbf],
  "A rewritten Markdown file must retain its UTF-8 BOM",
);
assertOnlyCrLf(bomWikilinkOutput, "BOM-bearing Markdown must retain CRLF separators");

const normalizedBomBuffer = preparePushBuffer(
  lfMapping,
  "example.md",
  encodeUtf8(input, true),
);
assert.deepEqual(
  Array.from(new Uint8Array(normalizedBomBuffer).slice(0, 3)),
  [0xef, 0xbb, 0xbf],
  "LF push normalization must preserve a UTF-8 BOM",
);
assert.equal(
  decodeUtf8(normalizedBomBuffer).text,
  input.replace(/\\r\\n/g, "\\n"),
  "LF push normalization must only change line separators",
);

const crlfMapping = { ...lfMapping, pullLineEndings: "crlf" as const };
const pulledBuffer = preparePullBuffer(crlfMapping, "example.md", normalizedBomBuffer);
assert.deepEqual(
  Array.from(new Uint8Array(pulledBuffer).slice(0, 3)),
  [0xef, 0xbb, 0xbf],
  "CRLF pull conversion must preserve a UTF-8 BOM",
);
assert.equal(
  decodeUtf8(pulledBuffer).text,
  input,
  "CRLF pull policy must create a Windows-style vault copy",
);
assert.notEqual(
  await computeGitBlobShaFromString(input),
  await computeGitBlobShaFromString(input.replace(/\\r\\n/g, "\\n")),
  "CRLF and LF content must remain distinct Git blobs",
);

const bomBuffer = encodeUtf8(input, true);
const bomDecoded = decodeUtf8(bomBuffer);
assert.equal(bomDecoded.hasBom, true, "UTF-8 BOM must be detected");
assert.equal(bomDecoded.text, input, "UTF-8 BOM decoding must preserve the document text");
assert.deepEqual(
  new Uint8Array(encodeUtf8(bomDecoded.text, bomDecoded.hasBom)),
  new Uint8Array(bomBuffer),
  "UTF-8 BOM and CRLF bytes must round-trip together",
);

const lfInput = input.replace(/\\r\\n/g, "\\n");
const lfOutput = applyPushTransforms(
  rewriteWikilinks(lfInput, {
    sourcePath: "notes/example.md",
    mappingVaultFolder: "notes",
    mappingRemoteFolder: "",
    resolve: () => null,
  }).markdown,
).markdown;
assert.equal(lfOutput, lfInput, "LF documents must remain LF documents");

const wikilinkOutput = rewriteWikilinks(wikilinkInput, {
  sourcePath: "notes/example.md",
  mappingVaultFolder: "notes",
  mappingRemoteFolder: "",
  resolve: () => ({ path: "notes/asset.png" }),
}).markdown;
assert.equal(
  wikilinkOutput.startsWith("![](asset.png)\\r\\n"),
  true,
  "Wikilink content should be rewritten without changing its line separator",
);
assertOnlyCrLf(wikilinkOutput, "Wikilink rewrites must preserve CRLF separators");

const transformedInput = [
  "> [!warning] Keep CRLF",
  "Text with ==highlight==.",
  "",
].join("\\r\\n");
const transformed = applyPushTransforms(transformedInput).markdown;
assertOnlyCrLf(
  transformed,
  "Content rewrites must not introduce lone LF line endings into a CRLF document",
);
const restored = applyPullRestores(transformed).markdown;
assert.equal(restored, transformedInput, "Push/pull transforms must round-trip CRLF exactly");

assert.equal(
  preferredLineEnding("local\\r\\nvalue\\r\\n", "base\\nvalue\\n"),
  "\\r\\n",
  "Three-way merge output must prefer the local document's line ending",
);
assert.equal(
  preferredMergeLineEnding(
    lfMapping,
    "example.md",
    "local\\r\\nvalue\\r\\n",
    "base\\nvalue\\n",
  ),
  "\\n",
  "Three-way merge output must use canonical LF when the push policy is LF",
);
assert.deepEqual(
  splitLinesForMerge("first\\r\\nsecond\\r\\n"),
  ["first", "second", ""],
  "Merge comparison must ignore CRLF separators without losing the final newline",
);
`;

const result = await esbuild.build({
  stdin: {
    contents: testSource,
    resolveDir: process.cwd(),
    sourcefile: "crlf-regression.ts",
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  write: false,
});

assert.equal(result.outputFiles.length, 1);
const encoded = Buffer.from(result.outputFiles[0].contents).toString("base64");
await import(`data:text/javascript;base64,${encoded}`);
console.log("CRLF regression checks passed");
