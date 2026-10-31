import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: {
    main: "src/main.ts",
    styles: "src/styles/index.css",
  },
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/state",
    "@codemirror/view",
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outdir: ".",
  loader: { ".css": "css" },
  minify: prod,
});

if (prod) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
