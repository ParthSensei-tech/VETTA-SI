# `src/lib/recruiting` — module kinds and dependency direction

100 `.ts` files, one flat directory, four (ish) kinds. The kind is in the **filename**, and the
filename is what the toolchain and the lint rules read — so the suffix is load-bearing, not a style
choice.

| Kind                        | Pattern                 | Count | May import                               | Imported by                                    |
| --------------------------- | ----------------------- | ----- | ---------------------------------------- | ---------------------------------------------- |
| **Server-only**             | `*.server.ts`           | 32    | anything under `src/lib`                 | other server modules, `api.ts` wrappers, tests |
| **Server-function wrapper** | `*-api.ts` and `api.ts` | 13    | server-only modules                      | client code (components, routes)               |
| **Test**                    | `*.test.ts`             | 19    | anything                                 | `npm test` only                                |
| **Pure domain**             | plain `*.ts`            | 36    | other pure modules, `@/lib/utils`, `zod` | both sides                                     |

The two subfolders used to be where the naming rule broke. `harness/server.ts`, `harness/api.ts` and
`benchmark/phases.ts` were server-side code and a wrapper named by **folder**, not suffix, so they
evaded the globs that read the filename. They now carry their own suffixes, and every file in this
directory is classified by the patterns above — no exceptions.

| Folder       | Files                                                                        |
| ------------ | ---------------------------------------------------------------------------- |
| `harness/`   | `harness-api.ts` (wrapper), `harness.server.ts` (I/O), `gold.ts`, `scorer.ts` |
| `benchmark/` | `phases.server.ts` (I/O), `corpus.ts`                                          |

## The rules, and where they are enforced

```
routes  →  components  →  api.ts / *-api.ts  →  *.server.ts  →  pure .ts  →  lib/db · lib/auth · lib/observability
```

1. **Client must not reach server-only code.** Components and page routes cannot import `*.server.ts`
   (statically or via `await import()`). They call a `createServerFn` wrapper instead. Enforced by
   `no-restricted-imports` + `no-restricted-syntax` in `eslint.config.mjs`.
2. **`src/lib` must not reach outward.** No module under `src/lib` may import from `src/routes` or
   `src/components`. Enforced by `no-restricted-imports`.
3. Pure domain files import I/O **lazily** (`await import("./org.server")`) when they must — that is
   deliberate: it keeps the module isomorphic for tests and the client bundle while still reaching the
   DB at runtime. The lint rules allow it; a static import there would not be allowed.

Both rules had **zero violations** the day they were added (audit Batch 6). A failure is a new breach,
not an existing one to tolerate.

## The one thing the naming convention cannot express

A `*-api.ts` file is only callable if a **client** file imports it — TanStack Start registers
`createServerFn` at import time. An unwired wrapper compiles, typechecks and passes tests while being
unreachable from the product. Before deleting one, grep for importers in `src/components` and
`src/routes`, not in `src/lib`.
