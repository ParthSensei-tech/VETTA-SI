import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Flat ESLint config for the TanStack Start app-builder template. */
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
  // --- Vetta architecture boundaries (audit Batch 6) -------------------------
  // Server-only modules are identified by filename — `*.server.ts` and, in three
  // places, `server.ts` — and are pulled into the client bundle by any plain
  // `import`. These two rules freeze the layering the audit measured; both had
  // zero violations when they were added, so a failure here is a new breach.
  {
    files: ["src/components/**/*.{ts,tsx}", "src/routes/**/*.{ts,tsx}"],
    ignores: ["src/routes/api/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/*.server",
                "**/*.server.ts",
                "**/*.server.tsx",
                "**/server",
                "**/server.ts",
              ],
              message:
                "Client code cannot import a server-only module. Call a createServerFn wrapper (`*-api.ts` or `src/lib/recruiting/api.ts`) instead.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      // `no-restricted-imports` only inspects static specifiers, so `await
      // import("./x.server")` would slip through and still land in the bundle.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'ImportExpression > Literal[value=/\\.server(\\.tsx?)?$/], CallExpression > Identifier[name="require"] > Literal[value=/\\.server(\\.tsx?)?$/]',
          message:
            "Client code cannot import a server-only module, lazily or otherwise. Call a createServerFn wrapper (`*-api.ts` or `src/lib/recruiting/api.ts`) instead.",
        },
      ],
    },
  },
  {
    files: ["src/lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/routes/**",
                "@/components/**",
                "../routes/**",
                "../components/**",
                "../../routes/**",
                "../../components/**",
              ],
              message:
                "src/lib is the lower layer: it must not depend on routes or components. Move the shared logic down into src/lib.",
            },
          ],
        },
      ],
    },
  },
  // Disable rules that conflict with Prettier formatting.
  prettier,
);
