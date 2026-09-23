import { build } from "esbuild";
import { build as viteBuild } from "vite";
import { chmod, mkdir } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/cli/index.ts"],
  outfile: "dist/cli.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  banner: { js: "#!/usr/bin/env node" },
  sourcemap: true,
});
await build({
  entryPoints: ["src/extension/index.ts"],
  outfile: "dist/extension.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  sourcemap: true,
});
await Promise.all(
  ["main", "preload"].map((entry) =>
    build({
      entryPoints: [`src/desktop/${entry}.ts`],
      outfile: `dist/desktop/${entry}.cjs`,
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node22",
      external: ["electron"],
    }),
  ),
);
await viteBuild();
await chmod("dist/cli.cjs", 0o755);
