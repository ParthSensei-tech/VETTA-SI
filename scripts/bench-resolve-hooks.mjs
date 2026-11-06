// Resolve hooks for running Vetta's TypeScript pipeline under plain `node`.
//
// Why this exists: `ai.server.ts` wraps its domain-embed / calibrate / outcome /
// rubric work in try-catch and continues without them on failure. Several of those
// modules import `@/platform/db` (a bundler alias) or extensionless relative specifiers,
// which plain `node --experimental-strip-types` cannot resolve. Without this shim the
// import throws ERR_MODULE_NOT_FOUND, gets swallowed, and the benchmark reports pure
// match-engine CPU time as if it were full fast-path latency.
//
// Imported with `--import` so the hooks are installed before any entry module loads.

import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import path from "node:path";

// `ai.server.ts:78` calls a bare `createHash(...)` with no import of its own. It works
// in the Vite/nitro bundle only because rollup merges module scopes and the symbol lands
// from `hash.ts`. Under real ESM scope it is a ReferenceError thrown on the first line of
// parseAndRank. Providing it here reproduces the bundled environment the app ships in,
// so the benchmark measures the production code path instead of an artifact of module
// scoping. (Logged separately as a latent bug — the source should import it.)
globalThis.createHash ??= createHash;

const projectRoot = path.resolve(fileURLToPath(import.meta.url), "../..");
const srcRoot = path.join(projectRoot, "src");

/** Specifiers whose resolution we track, so the CLI can assert nothing silently fell back. */
const probed = new Map();

function record(specifier, result) {
  probed.set(specifier, result);
}

function tryFiles(baseAbsolute) {
  // Order matters: exact file first, then the .ts sibling Node won't infer.
  for (const candidate of [baseAbsolute, `${baseAbsolute}.ts`, `${baseAbsolute}.tsx`]) {
    if (candidate.endsWith("/")) continue;
    if (existsSync(candidate)) return candidate;
  }
  // Directory imports: ./foo -> ./foo/index.ts
  for (const candidate of [
    path.join(baseAbsolute, "index.ts"),
    path.join(baseAbsolute, "index.tsx"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    // 1. `@/...` alias -> <root>/src/...
    if (specifier.startsWith("@/")) {
      const target = tryFiles(path.join(srcRoot, specifier.slice(2)));
      if (target) {
        const url = pathToFileURL(target).href;
        record(specifier, url);
        // No `format` override: let Node infer it so `--experimental-strip-types`
        // still transforms the .ts source.
        return { url, shortCircuit: true };
      }
    }

    // 2. Relative specifiers with no extension -> append `.ts` / `.tsx` / `index.ts`.
    if (specifier.startsWith(".") && !/\.(ts|tsx|mjs|cjs|js|json)$/.test(specifier)) {
      const parentUrl = context?.parentURL;
      if (parentUrl && parentUrl.startsWith("file:")) {
        const parentDir = path.dirname(fileURLToPath(parentUrl));
        const target = tryFiles(path.resolve(parentDir, specifier));
        if (target) {
          const url = pathToFileURL(target).href;
          record(specifier, url);
          return { url, shortCircuit: true };
        }
      }
    }

    return nextResolve(specifier, context);
  },
});

/** Which aliased/extensionless specifiers resolved, and to what. */
export function resolvedSpecifiers() {
  return Object.fromEntries(probed);
}

export const PROJECT_ROOT = projectRoot;
