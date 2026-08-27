import esbuild from "esbuild";
import process from "node:process";

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  banner: { js: "/* Obsidian plugin — generated build. Do not edit main.js directly. */" },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian", "electron", "@electron/remote",
    "@codemirror/autocomplete", "@codemirror/collab", "@codemirror/commands",
    "@codemirror/language", "@codemirror/lint", "@codemirror/search",
    "@codemirror/state", "@codemirror/view",
    "@lezer/common", "@lezer/highlight", "@lezer/lr",
  ],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  platform: "node",
});

if (prod) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
