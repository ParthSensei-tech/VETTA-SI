import { unzipSync, zipSync, strToU8 } from "fflate";

/**
 * The OOXML package, written and read as a package.
 *
 * In production a `.docx` is handed to `mammoth.extractRawText`, which is the
 * right choice for a resume pipeline and the wrong one for forensics: it opens
 * `word/document.xml`, takes the text out and throws the rest of the ZIP away —
 * `docProps/core.xml`, `docProps/app.xml`, `word/settings.xml`. Those three parts
 * are where a Word document keeps its own editing history: who created it, who
 * last saved it, how many revisions, how many editing sessions (`w:rsid`), how
 * long the author claims to have spent, and how many words the count said at the
 * time of the last save.
 *
 * So the corpus needs both directions: a builder that can state each of those
 * fields independently — including states no word processor produces, because
 * that is what a fabrication looks like — and a reader that reports them without
 * normalising them away. The reader is deliberately not a parser of the
 * word-processing namespace: it extracts the handful of attributes the checks
 * compare and leaves the rest as text.
 *
 * Pure and isomorphic (fflate only), same as the PDF half of the corpus.
 */

const NS_CORE = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";
const NS_DC = "http://purl.org/dc/elements/1.1/";
const NS_DCTERMS = "http://purl.org/dc/terms/";
const NS_XSI = "http://www.w3.org/2001/XMLSchema-instance";
const NS_APP = "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties";
const NS_WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const NS_DOC_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** An ISO-8601 instant the way OOXML writes it — always a `Z` suffix. */
export function xmlDate(value: string | Date): string {
  if (typeof value === "string") return value;
  return value.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export type DocxCore = {
  creator?: string;
  lastModifiedBy?: string;
  revision?: number;
  created?: string | Date;
  modified?: string | Date;
  title?: string;
  subject?: string;
  keywords?: string;
  category?: string;
  description?: string;
};

export type DocxApp = {
  application?: string;
  appVersion?: string;
  docSecurity?: number;
  template?: string;
  totalEditingTime?: number;
  pages?: number;
  words?: number;
  characters?: number;
  lines?: number;
  paragraphs?: number;
  company?: string;
  manager?: string;
};

export type DocxParts = {
  /** One `w:p` per entry; a `|` splits the text into runs. */
  paragraphs: string[];
  core?: DocxCore;
  app?: DocxApp;
  /** `w:rsid` values — one per editing session Word noticed. */
  rsids?: string[];
  rootRsId?: string;
  trackChanges?: boolean;
  /** Raw XML appended to the document body, for states the builder cannot name. */
  documentExtras?: string;
  /** Raw XML appended to `w:settings`, same reason. */
  settingsExtras?: string;
  /** Extra package members, e.g. a `customXml/` folder or a thumbnail. */
  extraFiles?: Record<string, string>;
  /** ZIP entry timestamp for every member — a package is written in one save. */
  mtime?: Date;
  /** Compression. Word deflates; a store-only package is a writer fingerprint. */
  level?: number;
};

function runXml(paragraph: string): string {
  return paragraph
    .split("|")
    .map((chunk) => `<w:r><w:t xml:space="preserve">${xmlEscape(chunk)}</w:t></w:r>`)
    .join("");
}

export function documentXml(
  parts: Pick<DocxParts, "paragraphs" | "rsids" | "documentExtras">,
): string {
  const rsid = parts.rsids?.[0];
  const attrs = rsid ? ` w:rsidR="${rsid}" w:rsidRDefault="${rsid}"` : "";
  const body = parts.paragraphs.map((p) => `<w:p${attrs}>${runXml(p)}</w:p>`).join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${NS_W}"><w:body>${body}${parts.documentExtras ?? ""}` +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`
  );
}

export function coreXml(fields: DocxCore): string {
  const el = (name: string, value: string | undefined) =>
    value === undefined ? "" : `<${name}>${xmlEscape(value)}</${name}>`;
  const dated = (name: string, value: string | Date | undefined) =>
    value === undefined ? "" : `<${name} xsi:type="dcterms:W3CDTF">${xmlDate(value)}</${name}>`;
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<cp:coreProperties xmlns:cp="${NS_CORE}" xmlns:dc="${NS_DC}" xmlns:dcterms="${NS_DCTERMS}" xmlns:xsi="${NS_XSI}">` +
    el("dc:title", fields.title) +
    el("dc:subject", fields.subject) +
    el("dc:creator", fields.creator) +
    el("cp:keywords", fields.keywords) +
    el("dc:description", fields.description) +
    el("cp:lastModifiedBy", fields.lastModifiedBy) +
    (fields.revision === undefined ? "" : `<cp:revision>${fields.revision}</cp:revision>`) +
    dated("dcterms:created", fields.created) +
    dated("dcterms:modified", fields.modified) +
    el("cp:category", fields.category) +
    "</cp:coreProperties>"
  );
}

export function appXml(fields: DocxApp): string {
  const el = (name: string, value: string | number | undefined) =>
    value === undefined ? "" : `<${name}>${xmlEscape(String(value))}</${name}>`;
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<Properties xmlns="${NS_APP}" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes" xmlns:wp="${NS_WP}">` +
    el("Template", fields.template) +
    (fields.docSecurity === undefined ? "" : `<DocSecurity>${fields.docSecurity}</DocSecurity>`) +
    el("Application", fields.application) +
    el("AppVersion", fields.appVersion) +
    (fields.totalEditingTime === undefined
      ? ""
      : `<TotalTime>${fields.totalEditingTime}</TotalTime>`) +
    (fields.pages === undefined ? "" : `<Pages>${fields.pages}</Pages>`) +
    (fields.words === undefined ? "" : `<Words>${fields.words}</Words>`) +
    (fields.characters === undefined ? "" : `<Characters>${fields.characters}</Characters>`) +
    (fields.lines === undefined ? "" : `<Lines>${fields.lines}</Lines>`) +
    (fields.paragraphs === undefined ? "" : `<Paragraphs>${fields.paragraphs}</Paragraphs>`) +
    el("Company", fields.company) +
    el("Manager", fields.manager) +
    "</Properties>"
  );
}

export function settingsXml(
  parts: Pick<DocxParts, "rsids" | "rootRsId" | "trackChanges" | "settingsExtras">,
): string {
  const rsids = (parts.rsids ?? []).map((v) => `<w:rsid w:val="${v}"/>`).join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:settings xmlns:rv="${NS_DOC_REL}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:r="${NS_DOC_REL}" xmlns:w="${NS_W}" xmlns:w10="urn:schemas-microsoft-com:office:word" mc:Ignorable="w14 wp14">` +
    (parts.rootRsId ? `<w:rsidRoot w:val="${parts.rootRsId}"/>` : "") +
    rsids +
    (parts.trackChanges ? "<w:trackChanges/>" : "") +
    (parts.settingsExtras ?? "") +
    "</w:settings>"
  );
}

const CONTENT_TYPES = (has: (name: string) => boolean) =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  (has("/docProps/core.xml")
    ? `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`
    : "") +
  (has("/docProps/app.xml")
    ? `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`
    : "") +
  (has("/word/settings.xml")
    ? `<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>`
    : "") +
  "</Types>";

/** The package, in the member order a real writer uses. */
export function buildDocx(parts: DocxParts): Uint8Array {
  const files: Record<string, [Uint8Array, { level: number }]> = {};
  const add = (name: string, xml: string, level = parts.level ?? 6) => {
    files[name] = [strToU8(xml), { level }];
  };
  const wanted = new Set<string>(["word/document.xml"]);
  if (parts.core) wanted.add("docProps/core.xml");
  if (parts.app) wanted.add("docProps/app.xml");
  if (parts.rsids?.length || parts.trackChanges || parts.settingsExtras || parts.rootRsId)
    wanted.add("word/settings.xml");
  for (const name of Object.keys(parts.extraFiles ?? {})) wanted.add(name);

  add(
    "[Content_Types].xml",
    CONTENT_TYPES((n) => wanted.has(n.slice(1))),
  );
  add(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<Relationships xmlns="${NS_REL}">` +
      `<Relationship Id="rId1" Type="${NS_DOC_REL}/officeDocument" Target="word/document.xml"/>` +
      (parts.core
        ? `<Relationship Id="rId2" Type="${NS_REL}/metadata/core-properties" Target="docProps/core.xml"/>`
        : "") +
      (parts.app
        ? `<Relationship Id="rId3" Type="${NS_DOC_REL}/extended-properties" Target="docProps/app.xml"/>`
        : "") +
      "</Relationships>",
  );
  if (wanted.has("word/settings.xml")) {
    add(
      "word/_rels/document.xml.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        `<Relationships xmlns="${NS_REL}">` +
        `<Relationship Id="rId1" Type="${NS_DOC_REL}/settings" Target="settings.xml"/>` +
        "</Relationships>",
    );
  }
  add("word/document.xml", documentXml(parts));
  if (parts.core) add("docProps/core.xml", coreXml(parts.core));
  if (parts.app) add("docProps/app.xml", appXml(parts.app));
  if (wanted.has("word/settings.xml")) add("word/settings.xml", settingsXml(parts));
  for (const [name, xml] of Object.entries(parts.extraFiles ?? {})) add(name, xml);

  return zipSync(
    Object.fromEntries(Object.entries(files).map(([name, [data]]) => [name, data])),
    parts.mtime ? { mtime: parts.mtime } : undefined,
  );
}

/* ------------------------------------------------------------------- reader */

export type DocxEntry = { name: string; bytes: Uint8Array; text: string };

export type DocxPackage = {
  /** Member order is part of the writer fingerprint. */
  names: string[];
  entries: DocxEntry[];
  /** `word/document.xml` is the only member a resume pipeline actually needs. */
  document?: DocxEntry;
  core: Record<string, string>;
  app: Record<string, string>;
  /** Distinct `w:val` of every `w:rsid`, plus the `w:rsidR*` attributes. */
  rsids: string[];
  rootRsId?: string;
  trackChanges: boolean;
  /** Paragraph and run counts taken from the document body itself. */
  paragraphCount: number;
  runCount: number;
  /** The body text, whitespace-normalised the way the extractor would see it. */
  documentText: string;
  settingsRaw: string;
};

function tagText(xml: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml);
  if (!m) return undefined;
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

export function readDocxPackage(bytes: Uint8Array): DocxPackage {
  // fflate hands back a flat map of member name to bytes (plus an `Attr` field
  // for the archive), so the values are filtered by shape, not by name.
  const entries: DocxEntry[] = Object.entries(unzipSync(bytes))
    .filter(([, data]) => data instanceof Uint8Array && data.byteLength > 0)
    .map(([name, data]) => ({
      name,
      bytes: data as Uint8Array,
      text: new TextDecoder().decode(data as Uint8Array),
    }));
  const byName = new Map(entries.map((e) => [e.name.replace(/^\//, ""), e] as const));
  const get = (name: string) => byName.get(name)?.text ?? "";

  const document = byName.get("word/document.xml");
  const settings = get("word/settings.xml");
  const coreSource = get("docProps/core.xml");
  const appSource = get("docProps/app.xml");
  const core: Record<string, string> = {};
  for (const tag of [
    "dc:creator",
    "cp:lastModifiedBy",
    "cp:revision",
    "dcterms:created",
    "dcterms:modified",
    "dc:title",
    "cp:category",
    "cp:keywords",
  ]) {
    const value = tagText(coreSource, tag);
    if (value !== undefined) core[tag] = value;
  }
  const app: Record<string, string> = {};
  for (const tag of [
    "Application",
    "AppVersion",
    "Template",
    "TotalTime",
    "Pages",
    "Words",
    "Characters",
    "Lines",
    "Paragraphs",
    "Company",
    "Manager",
    "DocSecurity",
  ]) {
    const value = tagText(appSource, tag);
    if (value !== undefined) app[tag] = value;
  }

  const rsids = new Set<string>();
  for (const m of settings.matchAll(/<w:rsid\s+w:val="([0-9A-Fa-f]+)"\s*\/>/g))
    rsids.add(m[1].toUpperCase());
  for (const m of document?.text.matchAll(/\bw:rsid(?:RDefault|RPr|Edit|R)?="([0-9A-Fa-f]+)"/g) ??
    [])
    rsids.add(m[1].toUpperCase());
  const root = /<w:rsidRoot\s+w:val="([0-9A-Fa-f]+)"/.exec(settings);

  const text = (document?.text ?? "")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

  return {
    names: entries.map((e) => e.name),
    entries,
    document,
    core,
    app,
    rsids: [...rsids].sort(),
    rootRsId: root ? root[1].toUpperCase() : undefined,
    trackChanges: /<w:trackChanges\s*\/>/.test(settings),
    paragraphCount: (document?.text.match(/<w:p[\s>]/g) ?? []).length,
    runCount: (document?.text.match(/<w:r[\s>]/g) ?? []).length,
    documentText: text,
    settingsRaw: settings,
  };
}
