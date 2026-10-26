// One HTML file: inlined CSS, one minified classic IIFE, MIT notice.
import esbuild from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const NOTICE = `Copyright (c) 2019 Lawrence Kesteloot
Copyright (c) 2021 Lawrence Kesteloot
Copyright (c) 2026 Paul Yardley

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const built = await esbuild.build({
  absWorkingDir: root,
  entryPoints: ["src/main.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2022",
  platform: "browser",
  charset: "utf8",
  legalComments: "none",
  sourcemap: false,
  alias: {
    fs: resolve(root, "src/shims/fs.ts"),
    path: resolve(root, "src/shims/path.ts"),
  },
  loader: {
    ".asm": "text",
  },
  write: false,
  logLevel: "warning",
});

if (built.outputFiles.length !== 1) {
  throw new Error(`expected one JS file, got ${built.outputFiles.length}`);
}

const js = built.outputFiles[0].text;
const css = readFileSync(resolve(root, "src/style.css"), "utf8").replace(/\s+$/, "");

assertBundle(js);
assertStylesheet(css);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Z80Debug</title>
<!--
${NOTICE}
-->
<style>
${escapeStyle(css)}
</style>
</head>
<body>
<div id="app"></div>
<script>
${escapeScript(js)}
</script>
</body>
</html>
`;

if (/<script\b[^>]*\btype\s*=/i.test(html)) {
  throw new Error("script must be classic, with no type attribute");
}
if (!html.includes("Copyright (c) 2019 Lawrence Kesteloot")) {
  throw new Error("missing Lawrence Kesteloot copyright");
}
if (!html.includes("Copyright (c) 2021 Lawrence Kesteloot")) {
  throw new Error("missing Lawrence Kesteloot copyright");
}
if (!html.includes("Copyright (c) 2026 Paul Yardley")) {
  throw new Error("missing Paul Yardley copyright");
}
if (!html.includes("Permission is hereby granted, free of charge")) {
  throw new Error("missing MIT permission paragraph");
}

const out = resolve(root, "z80debug.html");
writeFileSync(out, html);
process.stdout.write(`wrote z80debug.html (${Buffer.byteLength(html)} bytes)\n`);

await writePlayPage();

function assertBundle(code) {
  if (code.length < 400_000) {
    throw new Error(`bundle is unexpectedly small (${code.length} bytes)`);
  }
  const trimmed = code.trim();
  if (!trimmed.endsWith("();")) {
    throw new Error("bundle is not an IIFE");
  }
  if (/\brequire\s*\(/.test(code) || code.includes("process.argv") || code.includes("commander")) {
    throw new Error("bundle includes Node CLI code");
  }
  for (const needle of [
    "Directory includes are not available in this debugger.",
    "Binary inserts are not available in this debugger.",
    "Console example",
    "Type a character and press Queue before stepping the IN.",
    "The browser kept this page open.",
    "Discard unsaved edits",
    "console-echo",
    "Current instruction, line ",
    "z80debug.displayFormat",
    "Top of stack",
    "stack.asm",
    "shifts.asm",
    "bits.asm",
    "DAA uses this to adjust BCD.",
  ]) {
    if (!code.includes(needle)) {
      throw new Error(`bundle missing ${JSON.stringify(needle)}`);
    }
  }
}

function assertStylesheet(code) {
  if (code.includes("@import") || /url\s*\(/.test(code)) {
    throw new Error("stylesheet fetches another file");
  }
}

function escapeScript(code) {
  return code.replace(/<\/(script)/gi, "<\\/$1");
}

function escapeStyle(code) {
  return code.replace(/<\/(style)/gi, "<\\/$1");
}

async function writePlayPage() {
  const built = await esbuild.build({
    absWorkingDir: root,
    entryPoints: ["src/play-main.ts"],
    bundle: true,
    minify: true,
    format: "iife",
    target: "es2022",
    platform: "browser",
    charset: "utf8",
    legalComments: "none",
    sourcemap: false,
    alias: {
      fs: resolve(root, "src/shims/fs.ts"),
      path: resolve(root, "src/shims/path.ts"),
    },
    loader: {
      ".asm": "text",
    },
    write: false,
    logLevel: "warning",
  });
  if (built.outputFiles.length !== 1) {
    throw new Error(`expected one play JS file, got ${built.outputFiles.length}`);
  }
  const js = built.outputFiles[0].text;
  const css = readFileSync(resolve(root, "src/play.css"), "utf8").replace(/\s+$/, "");
  assertPlayBundle(js);
  assertStylesheet(css);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Z80Debug</title>
<!--
${NOTICE}
-->
<!-- Tabletop presentation of Z80Debug. The plain debugger is z80debug.html. -->
<style>
${escapeStyle(css)}
</style>
</head>
<body>
<div id="app"></div>
<script>
${escapeScript(js)}
</script>
</body>
</html>
`;
  if (/<script\b[^>]*\btype\s*=/i.test(html)) {
    throw new Error("play script must be classic, with no type attribute");
  }
  if (!html.includes("Copyright (c) 2019 Lawrence Kesteloot")) {
    throw new Error("missing Lawrence Kesteloot copyright");
  }
  if (!html.includes("Copyright (c) 2021 Lawrence Kesteloot")) {
    throw new Error("missing Lawrence Kesteloot copyright");
  }
  if (!html.includes("Copyright (c) 2026 Paul Yardley")) {
    throw new Error("missing Paul Yardley copyright");
  }
  if (!html.includes("Permission is hereby granted, free of charge")) {
    throw new Error("missing MIT permission paragraph");
  }
  const playOut = resolve(root, "z80debug-play.html");
  writeFileSync(playOut, html);
  process.stdout.write(`wrote z80debug-play.html (${Buffer.byteLength(html)} bytes)\n`);
}

function assertPlayBundle(code) {
  if (code.length < 400_000) {
    throw new Error(`play bundle is unexpectedly small (${code.length} bytes)`);
  }
  const trimmed = code.trim();
  if (!trimmed.endsWith("();")) {
    throw new Error("play bundle is not an IIFE");
  }
  if (/\brequire\s*\(/.test(code) || code.includes("process.argv") || code.includes("commander")) {
    throw new Error("play bundle includes Node CLI code");
  }
  for (const needle of [
    "Directory includes are not available in this debugger.",
    "Binary inserts are not available in this debugger.",
    "Tabletop toy computer",
    "Motion on",
    "Discard unsaved edits",
    "The browser kept this page open.",
    "console-echo",
    "Current instruction, line ",
    "z80debug.displayFormat",
    "EX AF,AF' swaps only AF.",
    "Top of stack",
    "stack.asm",
    "shifts.asm",
    "bits.asm",
    "DAA uses this to adjust BCD.",
  ]) {
    if (!code.includes(needle)) {
      throw new Error(`play bundle missing ${JSON.stringify(needle)}`);
    }
  }
}
