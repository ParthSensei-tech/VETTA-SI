import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Flat ESLint config for the TanStack Start app-builder template. */

// The three tiers the boundary rules care about, kept deliberately DISJOINT.
// This is not style: in flat config, when two objects both define the same rule
// key and their `files` overlap, the later object REPLACES the earlier one
// rather than merging. A single combined `no-restricted-imports` file list that
// covered `domain/` twice — once as a client surface, once as a lower layer —
// silently dropped the client→server restriction from domain exactly when the
// restructure created those folders. Probes caught it; the disjoint split is the
// fix, and `scripts/check-tree-invariants.mjs` re-runs the probes on demand.
const VIEW_SURFACES = [
  "src/components/**/*.{ts,tsx}",
  "src/routes/**/*.{ts,tsx}",
  "src/shared/**/*.{ts,tsx}",
  "src/features/**/ui/**/*.{ts,tsx}",
];
// Isomorphic by contract: pure logic, no I/O, no server module, no view.
const DOMAIN_SURFACES = ["src/features/**/domain/**/*.{ts,tsx}"];
// Everything below the view: it may reach sideways and down, never up into UI.
// `src/features/**` minus the two upper tiers, rather than a list of tier folder
// names — because a feature may hold sub-folders that are not tiers. Batch 8
// moves `src/lib/recruiting/{harness,benchmark}` whole into `src/features/eval/`,
// and neither is a tier; probed at each destination, the old `server/**`+`api/**`
// spelling left every file in them matched by *no* rule object at all, so the
// boundary went silent on exactly the code the restructure exists to put under it.
// The subtraction belongs in the rule object's `ignores`, NOT as `!`-entries in
// this array: measured, negated `files` entries do not un-match here, and because
// this object is the later one they let it REPLACE the domain/ui restrictions
// instead of widening its own reach — the precise hazard named above, re-created
// by the fix and caught only by the probes.
const LOWER_SURFACES = [
  "src/lib/**/*.{ts,tsx}",
  "src/platform/**/*.{ts,tsx}",
  "src/features/**/*.{ts,tsx}",
];
const LOWER_EXEMPTIONS = [
  "src/**/*.test.ts",
  "src/**/*.test.tsx",
  "src/features/**/domain/**",
  "src/features/**/ui/**",
];
// Exemptions, each measured rather than assumed:
// - `src/routes/api/**` is the server entrypoint; it is server code.
// - `src/routes/__root.tsx:12-16` builds a `createServerFn` inline, so its
//   `await import("@/platform/auth/verify.server")` runs on the server, not in the
//   browser bundle. Legal today; open item to fold into the api edge.
// - `*.test.ts` runs under `node --test` with no client bundle at all.
const VIEW_EXEMPTIONS = [
  "src/routes/api/**",
  "src/routes/__root.tsx",
  "src/**/*.test.ts",
  "src/**/*.test.tsx",
];
const UPPER_VIEW_GLOBS = [
  "@/routes/**",
  "@/components/**",
  "@/shared/components/**",
  "@/features/**/ui/**",
  "../routes/**",
  "../components/**",
  "../../routes/**",
  "../../components/**",
];
// `group` globs are matched against the specifier string, so the `../` list above
// only covers the two depths it enumerates. Batch 9 puts a lower tier at
// `src/features/recruiting/api/` — three levels under `src/` — and the codemod
// preserves specifier form, so `../../../routes/x` is a shape this tree produces
// (12 lower-tier files already import `../../../shared/utils.ts`). Probed before
// the fix: from that folder, `@/routes/app/talent` and
// `@/features/recruiting/ui/client-card-view` each errored, while
// `../../../routes/__root` and `../../../shared/components/app-shell` produced
// nothing. Latent, not exercised — no file reaches up that way today — but the
// rails must not depend on which spelling an author happens to pick. Depth-agnostic
// regex, mirroring SERVER_MODULE_REGEX below; `shared/utils` stays legal because
// only `shared/components` is an upper surface.
const UPPER_VIEW_REGEX =
  "^(?:\\.{1,2}/)+(?:routes|components)(?:/|$)|^(?:\\.{1,2}/)+shared/components(?:/|$)|^(?:\\.{1,2}/)+(?:[\\w.@-]+/)*ui(?:/|$)";

// Server-only modules are identified by filename. Both forms are anchored to
// *local* specifiers on purpose: the previous `**/server.ts` group also matched
// the framework's own `@tanstack/react-start/server`, which `origin.ts` imports
// legitimately — and `origin.ts` is destined for `domain/`, so an unanchored
// group would have turned a correct import into a lint error mid-move.
const SERVER_MODULE_GLOBS = [
  "@/**/*.server",
  "@/**/*.server.ts",
  "@/**/*.server.tsx",
  "@/**/server",
  "@/**/server.ts",
  "@/**/server.tsx",
  "@/**/server/**",
];
const SERVER_MODULE_REGEX =
  "^(?:\\.{1,2}/)+(?:[\\w.@-]+/)*[\\w.@-]*(?:\\.server|/server)(?:\\.tsx?|/.*)?$";
const SERVER_EDGE_HINT =
  "Client code cannot import a server-only module. Call a createServerFn wrapper (`*-api.ts`, or after the restructure any file under `features/*/api/`) instead.";
const LAZY_SERVER_SELECTOR =
  'ImportExpression > Literal[value=/^(?:\\.\\.?\\/|@\\/)[^"]*(?:\\.server(?:\\.tsx?)?|\\/server(?:\\.tsx?)?(?:\\/|$))/], CallExpression > Identifier[name="require"] > Literal[value=/^(?:\\.\\.?\\/|@\\/)[^"]*(?:\\.server(?:\\.tsx?)?|\\/server(?:\\.tsx?)?(?:\\/|$))/]';

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      ".output/**",
      ".vercel/**",
      ".nitro/**",
      "node_modules/**",
      "src/routeTree.gen.ts",
      "artifacts/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // --- Vetta architecture boundaries (audit Batch 6; re-keyed for the feature
  // tree in restructure Batch 1) -----------------------------------------------
  // Zero violations when this was written, so a failure here is a new breach.
  // The `files` lists are deliberately wider than the tree today: a target glob
  // matches nothing until a batch creates the folder, which costs nothing and
  // means the rule is already in force for code written in the new shape.
  {
    files: VIEW_SURFACES,
    ignores: VIEW_EXEMPTIONS,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: SERVER_MODULE_GLOBS, message: SERVER_EDGE_HINT },
            { regex: SERVER_MODULE_REGEX, message: SERVER_EDGE_HINT },
          ],
        },
      ],
      // `no-restricted-imports` only inspects static specifiers, so `await
      // import("./x.server")` would slip through and still land in the bundle.
      "no-restricted-syntax": ["error", { selector: LAZY_SERVER_SELECTOR, message: SERVER_EDGE_HINT }],
    },
  },
  {
    files: DOMAIN_SURFACES,
    ignores: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: SERVER_MODULE_GLOBS, message: SERVER_EDGE_HINT },
            { regex: SERVER_MODULE_REGEX, message: SERVER_EDGE_HINT },
            {
              group: UPPER_VIEW_GLOBS,
              message:
                "domain/ is isomorphic pure logic: it may not depend on the view layer, and importing a feature's ui/ folder inverts the dependency direction.",
            },
            {
              regex: UPPER_VIEW_REGEX,
              message:
                "domain/ is isomorphic pure logic: it may not depend on the view layer, and importing a feature's ui/ folder inverts the dependency direction.",
            },
          ],
        },
      ],
      "no-restricted-syntax": ["error", { selector: LAZY_SERVER_SELECTOR, message: SERVER_EDGE_HINT }],
    },
  },
  {
    // Everything below the view must not reach up into it. Same reason as
    // above: keyed to where the infrastructure *will* live, not only to where
    // it lives today.
    files: LOWER_SURFACES,
    ignores: LOWER_EXEMPTIONS,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: UPPER_VIEW_GLOBS,
              message:
                "This is the lower layer: it must not depend on routes or components. Move the shared logic down into src/platform or a feature domain.",
            },
            {
              regex: UPPER_VIEW_REGEX,
              message:
                "This is the lower layer: it must not depend on routes or components. Move the shared logic down into src/platform or a feature domain.",
            },
          ],
        },
      ],
    },
  },
  // Disable rules that conflict with Prettier formatting.
  prettier,
);
