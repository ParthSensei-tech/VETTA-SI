// Rendered-copy proof for the Batch 2 format pass.
//
// ast-diff.mjs proves the syntax trees of all 153 formatted files are
// identical. The one construct it cannot judge from the tree alone is JSX
// text, where a formatter may replace `…{n} decisions` with `…{n}{" "}\ndecisions`.
// Those look different as source and are the same on screen — but that is a
// claim about the compiler's whitespace rules, so the rules are not
// hand-simulated here: both revisions are run through the real TypeScript JSX
// emitter, and the children it hands to React are compared as the ordered
// sequence of strings and expressions they are.
//
// Equal sequences mean every pixel of copy, and every space between inline
// elements, is unchanged.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";

const ROOT = process.cwd();

const files = execFileSync("git", ["diff", "--name-only"], { encoding: "utf8", cwd: ROOT })
  .trim()
  .split(/\r?\n/)
  .filter((f) => f.endsWith(".tsx"));

/** Emit JSX to plain calls, then read back the child list the runtime receives. */
function jsxChildren(src, fileName) {
  const js = ts.transpileModule(src, {
    fileName,
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      jsxFactory: "_h",
      jsxFragmentFactory: "_f",
      target: ts.ScriptTarget.ESNext,
      removeComments: true,
    },
  }).outputText;
  const sf = ts.createSourceFile(
    fileName.replace(/\.tsx$/, ".js"),
    js,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const seq = [];
  const walk = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.escapedText === "_h"
    ) {
      const args = node.arguments;
      if (args.length < 3) return; // _h(tag, props) with no children
      // _h(tag, props, ...children)
      for (let i = 2; i < args.length; i++) seq.push(childText(args[i]));
      for (let i = 2; i < args.length; i++) walk(args[i]);
      return;
    }
    node.forEachChild(walk);
  };
  const childText = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      return `STR:${JSON.stringify(node.text)}`;
    return `EXPR:${ts.SyntaxKind[node.kind]}`;
  };
  walk(sf);
  // Adjacent string children render as one run of text; a formatter is free to
  // split that run differently (`" · "` into `" ·"` + `" "`), so compare the
  // merged runs — which is what the viewer actually sees between expressions.
  const merged = [];
  for (const s of seq) {
    const prev = merged[merged.length - 1];
    if (prev && s.startsWith("STR:") && prev.startsWith("STR:"))
      merged[merged.length - 1] =
        `STR:${JSON.stringify(JSON.parse(prev.slice(4)) + JSON.parse(s.slice(4)))}`;
    else merged.push(s);
  }
  return { seq: merged, js };
}

let bad = 0;
let compared = 0;
let children = 0;
const reports = [];

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
  const a = jsxChildren(before, file);
  const b = jsxChildren(readFileSync(`${ROOT}/${file}`, "utf8"), file);
  compared++;
  children += a.seq.length;
  if (a.seq.length !== b.seq.length || a.seq.some((s, i) => s !== b.seq[i])) {
    bad++;
    const i = a.seq.findIndex((s, k) => s !== b.seq[k]);
    reports.push(
      `RENDERED JSX DIFFERS: ${file} at child ${i} (${a.seq.length}/${b.seq.length})\n` +
        `    was: ${JSON.stringify(a.seq.slice(Math.max(0, i - 2), i + 3))}\n` +
        `    now: ${JSON.stringify(b.seq.slice(Math.max(0, i - 2), i + 3))}`,
    );
  }
}

console.log(reports.slice(0, 10).join("\n") || "  no rendered JSX differences");
console.log(
  `\n.tsx files compared=${compared}   JSX children compared=${children}   files whose rendered output changed=${bad}`,
);
console.log(
  bad
    ? "VERDICT: rendered copy changed — inspect."
    : "VERDICT: React receives the same children in every file.",
);
process.exitCode = bad ? 1 : 0;
