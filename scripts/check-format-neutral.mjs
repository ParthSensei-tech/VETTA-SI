// Proves an edit left the program's behaviour untouched, by comparing the
// working tree against HEAD. Written for restructure Batch 2 (a 153-file
// prettier pass) and re-run for every batch that rewrites source.
//
// A formatter may move bytes around; what must stay fixed is what the compiler
// sees. Both revisions are parsed with the TypeScript parser and compared as a
// *semantic projection* of their syntax trees.
//
// The projection ignores the transforms a formatter is defined to perform, and
// is strict about everything else:
//
//   - string literals contribute their decoded VALUE, so a quote-style change
//     ('x' -> "x") is invisible but any change to the text inside is not.
//   - property names are projected by value, so prettier's `quoteProps:
//     "as-needed"` (`{"a": 1}` -> `{a: 1}`) is invisible, while `obj["a"]` ->
//     `obj[a]` still differs, because element access is not a property name.
//   - ParenthesizedExpression nodes are walked through: adding or dropping a
//     redundant group is formatting by definition.
//   - JSX text and a whitespace-only `{" "}` are skipped entirely: judging them
//     needs the JSX whitespace rules, and check-jsx-render.mjs applies the real
//     emitter to exactly that question.
//
// Comments are compared as a multiset of their text: they are not in the AST,
// and a format pass must not add, drop or reword one.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";

const ROOT = process.cwd();

const files = execFileSync("git", ["diff", "--name-only"], { encoding: "utf8", cwd: ROOT })
  .trim()
  .split(/\r?\n/)
  .filter((f) => /\.(ts|tsx|mjs)$/.test(f));

const COMMENT_RE = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

function projectedText(node, sf) {
  if (
    node.kind === ts.SyntaxKind.StringLiteral ||
    node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
    node.kind === ts.SyntaxKind.JsxAttribute
  )
    return node.text;
  if (ts.isIdentifier(node)) return node.escapedText;
  return node.getText(sf);
}

function project(src, fileName) {
  const kind = fileName.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : fileName.endsWith(".mjs")
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, kind);
  const out = [];
  const comments = [];
  const skipNames = new Set();
  const walk = (node) => {
    if (ts.isJsxText(node)) return; // judged by check-jsx-render.mjs, not here
    if (ts.isToken(node)) {
      // Every comment lives in some token's leading trivia, so capturing it
      // here counts each one exactly once.
      const full = src.slice(node.getFullStart(sf), node.getStart(sf));
      for (const m of full.matchAll(COMMENT_RE)) comments.push(m[0].trim());
      if (skipNames.has(node.pos)) return; // emitted by the parent, by value
      if (node.kind === ts.SyntaxKind.NumericLiteral) {
        // Prettier normalises a literal's spelling (`0.40` -> `0.4`); the double
        // is unchanged, so compare the value the engine actually sees.
        out.push(`NumericLiteral:${Number(node.getText(sf))}`);
        return;
      }
      if (
        node.kind === ts.SyntaxKind.Identifier ||
        node.kind === ts.SyntaxKind.StringLiteral ||
        node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
        node.kind === ts.SyntaxKind.NumericLiteral ||
        node.kind === ts.SyntaxKind.BigIntLiteral ||
        node.kind === ts.SyntaxKind.RegularExpressionLiteral ||
        node.kind === ts.SyntaxKind.JsxIdentifier
      )
        out.push(`${ts.SyntaxKind[node.kind]}:${projectedText(node, sf)}`);
      return;
    }
    if (node.kind === ts.SyntaxKind.ParenthesizedExpression) {
      node.forEachChild(walk);
      return;
    }
    // A whitespace-only `{" "}` is how a formatter keeps a space that JSX would
    // otherwise eat at a line break. It is spacing, not code, so it stays out of
    // the projection; check-jsx-render.mjs judges the rendered result.
    if (ts.isJsxExpression(node) && node.expression && ts.isStringLiteral(node.expression)) {
      const sp = node.expression.text;
      if (sp && !sp.trim() && !sp.includes("\n")) return;
    }
    out.push(ts.SyntaxKind[node.kind]);
    if (
      ts.isPropertyAssignment(node) ||
      ts.isPropertySignature(node) ||
      ts.isShorthandPropertyAssignment(node)
    ) {
      if (node.name) {
        out.push(`Name:${projectedText(node.name, sf)}`);
        // The name token is projected once, by value; walking past it would
        // show its quoting, which is exactly what a formatter is free to change.
        skipNames.add(node.name.pos);
        if (ts.isStringLiteral(node.name) || ts.isNumericLiteral(node.name))
          skipNames.add(node.name.pos + 1);
      }
    }
    node.forEachChild(walk);
  };
  walk(sf);
  return { out, comments, diagnostics: (sf.parseDiagnostics ?? []).length };
}

let treeBad = 0;
let commentBad = 0;
let parseBad = 0;
let compared = 0;
let entries = 0;
const treeDiffs = [];

for (const file of files) {
  let before;
  try {
    before = execFileSync("git", ["show", `HEAD:${file}`], {
      encoding: "utf8",
      maxBuffer: 1 << 26,
      cwd: ROOT,
    });
  } catch {
    continue;
  }
  const a = project(before, file);
  const b = project(readFileSync(`${ROOT}/${file}`, "utf8"), file);
  if (a.diagnostics || b.diagnostics) {
    parseBad++;
    treeDiffs.push(`PARSE DIAGNOSTICS (${a.diagnostics}/${b.diagnostics}): ${file}`);
    continue;
  }
  compared++;
  entries += a.out.length;

  if (a.out.length !== b.out.length || a.out.some((s, i) => s !== b.out[i])) {
    treeBad++;
    const i = a.out.findIndex((s, k) => s !== b.out[k]);
    treeDiffs.push(
      `AST DIFFERS: ${file} at ${i} (${a.out.length}/${b.out.length})\n` +
        `    was: ${JSON.stringify(a.out[i])}  now: ${JSON.stringify(b.out[i])}\n` +
        `    ctx: ${a.out.slice(Math.max(0, i - 3), i + 2).join(" | ")}`,
    );
  }

  // Rendered JSX copy is not screened here: a formatter legitimately re-splits
  // the text around an expression (" · " -> " ·" + " "), which needs the JSX
  // whitespace rules to judge. check-jsx-render.mjs applies the real emitter.

  const ca = [...a.comments].sort();
  const cb = [...b.comments].sort();
  if (ca.length !== cb.length || ca.some((s, i) => s !== cb[i])) {
    commentBad++;
    treeDiffs.push(
      `COMMENT DIFFERS: ${file} -${ca.filter((c) => !cb.includes(c)).length} +${cb.filter((c) => !ca.includes(c)).length}`,
    );
  }
}

console.log("=== AST / comment differences (must be zero) ===");
console.log(treeDiffs.slice(0, 15).join("\n") || "  none");
console.log(
  `\nfiles=${compared}/${files.length}  projection entries=${entries}  ast-diff files=${treeBad}  ` +
    `comment-diff files=${commentBad}  unparseable=${parseBad}`,
);
process.exitCode = treeBad || commentBad || parseBad ? 1 : 0;
