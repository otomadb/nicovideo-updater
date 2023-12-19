import esbuild from "esbuild";

await esbuild.build({
  logLevel: "info",
  bundle: true,
  entryPoints: ["./src/main.ts"],
  outdir: "./dist",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  minify: true,
  banner: {
    js: `
      const require = (await import("node:module")).createRequire(import.meta.url);
      const __filename = (await import("node:url")).fileURLToPath(import.meta.url);
      const __dirname = (await import("node:path")).dirname(__filename);
    `,
  },
});
