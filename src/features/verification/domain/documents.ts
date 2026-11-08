/**
 * The document store's rules, with no database and no bytes in sight.
 *
 * Keeping a candidate's original file is the most consequential thing this
 * product does with their data: text we parse can be re-derived, but a stored PDF
 * is the person's document, sitting in our database, and in India it very often
 * has an Aadhaar or PAN image inside it. So the decisions that bound that —
 * what class of file this is, whether we may hold it, for how long, and what
 * survives after the clock — live here, in the rail-pure side, where they can be
 * argued about with a unit test rather than asserted inside a query.
 *
 * Three rules this file is the only home for:
 *
 *  1. **An identity document is refused outright.** Refusal is not "store it with
 *     the bytes nulled": the digest is withheld too, because sha256 of an Aadhaar
 *     scan is still a permanent, comparable fingerprint of an Aadhaar scan.
 *  2. **Retention is opt-in and fails closed.** No settings row means no bytes.
 *     A caller that forgets to look the setting up cannot leak resumes, because
 *     the absence itself is the answer.
 *  3. **Purging removes bytes, not the ability to explain a verdict.** A purged
 *     row keeps its class, size, digest, expiry and hashed XMP ids, so a
 *     forensic arm that needs the file reports "needs the original document
 *     bytes, which are not retained" and the drawer stays truthful after
 *     day 90 instead of quietly dropping checks it used to run.
 *
 * Nothing here may read the environment, the filesystem or the database: the
 * same input must produce the same decision on any machine, in any year.
 */

export const DOC_CLASSES = ["resume", "certificate", "id", "other"] as const;
export type DocClass = (typeof DOC_CLASSES)[number];

export const CONTENT_STATES = ["stored", "purged", "refused", "not_retained"] as const;
export type ContentState = (typeof CONTENT_STATES)[number];

/** The clock's ceiling, and its default. Both are 90 until someone argues. */
export const MAX_RETENTION_DAYS = 90;
export const DEFAULT_RETENTION_DAYS = 90;

const DAY_MS = 86_400_000;

/**
 * File names and media types that mean "this is an identity document".
 *
 * Deliberately over-inclusive on names a recruiter would actually drop into a
 * resume folder, and matched against the *file name*, which is the only signal we
 * get before we would have already stored the bytes. A wrong guess here refuses a
 * resume, which costs a forensic arm and nothing else; a miss accepts an ID card,
 * which costs us the privacy posture. So the asymmetry decides the direction of
 * the bias.
 */
/**
 * A separator that a human typing a file name uses instead of nothing: space,
 * underscore or hyphen. Every pattern below allows it, because "national id.pdf"
 * and "national-id.pdf" are the same document and only one of them would be
 * refused by a stricter regex.
 */
const SEP = "[\\s_-]?";

const ID_PATTERNS = [
  /aadhaar/i,
  /adhaar/i,
  /\bpan\b/i,
  new RegExp(`pan${SEP}card`, "i"),
  new RegExp(`voter${SEP}id`, "i"),
  new RegExp(`election${SEP}card`, "i"),
  /passport/i,
  new RegExp(`driving${SEP}licen[cs]e`, "i"),
  new RegExp(`\\bdl${SEP}`, "i"),
  new RegExp(`govt${SEP}id`, "i"),
  new RegExp(`national${SEP}id`, "i"),
  new RegExp(`social${SEP}security`, "i"),
];

const CERTIFICATE_PATTERNS = [
  /certificate/i,
  /\bcert\b/i,
  /diploma/i,
  /degree/i,
  /marksheet/i,
  /mark[_-]?list/i,
  /transcript/i,
  /consolidated/i,
  /convocation/i,
];

const RESUME_PATTERNS = [/resume/i, /\bcv\b/i, /curriculum/i, /profile/i];

const IMAGE_MEDIA = /^image\//i;

/** Which pile a file belongs in — see `ID_PATTERNS` for why the order matters. */
export function classifyDocument(input: {
  filename: string;
  mediaType?: string;
}): DocClass {
  const haystack = `${input.filename ?? ""} ${input.mediaType ?? ""}`;
  if (ID_PATTERNS.some((re) => re.test(haystack))) return "id";
  if (CERTIFICATE_PATTERNS.some((re) => re.test(haystack))) return "certificate";
  if (RESUME_PATTERNS.some((re) => re.test(haystack))) return "resume";
  // A text-bearing document with no name signal is treated as the resume it was
  // dropped next to; an image with no name signal is not, because it is the one
  // class that could be a photo of an identity document.
  if (IMAGE_MEDIA.test(input.mediaType ?? "")) return "other";
  return "resume";
}

/**
 * May we hold these bytes?
 *
 * Two independent noes: the class is an identity document, and the org has not
 * turned retention on. Either one is enough, and neither is the other's default.
 */
export function retainsBytes(input: {docClass: DocClass; byteRetention: boolean}): boolean {
  return input.docClass !== "id" && input.byteRetention;
}

/** What the row's `content_state` says, given those two noes. */
export function contentStateFor(input: {docClass: DocClass; byteRetention: boolean}): ContentState {
  if (input.docClass === "id") return "refused";
  if (!input.byteRetention) return "not_retained";
  return "stored";
}

/**
 * The digest, or the refusal to keep one.
 *
 * A hash is only kept when we are also keeping the file. Without the bytes, a
 * stored hash is a permanent handle on something we said we would not hold — and
 * for an identity document it is worse than that, it is a cross-org identifier
 * derived from a government ID.
 */
export function digestFor(input: {
  docClass: DocClass;
  byteRetention: boolean;
  sha256: string;
}): string {
  return retainsBytes(input) ? input.sha256 : "";
}

/** Days into a positive, capped integer. Anything unrecognisable is the default. */
export function clampRetentionDays(days: number | null | undefined): number {
  if (typeof days !== "number" || !Number.isFinite(days)) return DEFAULT_RETENTION_DAYS;
  const whole = Math.floor(days);
  if (whole <= 0) return DEFAULT_RETENTION_DAYS;
  return Math.min(MAX_RETENTION_DAYS, whole);
}

/** When the clock runs out, as epoch milliseconds. */
export function expiryFrom(input: {nowMs: number; retentionDays: number}): number {
  return input.nowMs + clampRetentionDays(input.retentionDays) * DAY_MS;
}

/**
 * The one transition this store makes on its own.
 *
 * Returns the new state when a retained file's clock has run out, and `null` for
 * every row that has nothing to do: a file already purged, a refusal that never
 * had bytes, and a retention that has not expired yet. `null` rather than the
 * same state, so the caller's `where` clause and this function cannot disagree
 * about what "due" means.
 */
export function purgeTransition(input: {
  contentState: ContentState;
  expiresAtMs: number;
  nowMs: number;
}): ContentState | null {
  if (input.contentState !== "stored") return null;
  return input.expiresAtMs <= input.nowMs ? "purged" : null;
}

/**
 * Whose bytes a check may read.
 *
 * `stored` is necessary and not sufficient: an expired row that the clock has not
 * reached yet must still read as absent, or a purge that is a few minutes late
 * would look like a file we are still allowed to forensicate.
 */
export function bytesReadable(input: {
  contentState: ContentState;
  expiresAtMs: number;
  nowMs: number;
}): boolean {
  return input.contentState === "stored" && input.nowMs < input.expiresAtMs;
}

/**
 * The XMP ids that name an *original*, not a save.
 *
 * `xmpMM:InstanceID` changes on every write, so two files sharing it are the same
 * file; `xmpMM:DocumentID` and `xmpMM:OriginalDocumentID` are handed down through
 * edits, so two files sharing one of those came from the same starting document
 * even when their bytes no longer match. That is the difference between a
 * duplicate and a lineage, and the forge this product looks for — a certificate
 * re-printed from somebody else's template — is a lineage case, not a duplicate
 * one.
 *
 * The store keeps only a digest of the answer (see `xmp_ids_hash` in migration
 * 0029), because an id that ties two people's files together is exactly the kind
 * of value that must not sit in a table in plaintext. Both renderings writers
 * actually use are read — `xmpMM:DocumentID="uuid:…"` as an attribute, and
 * `<xmpMM:DocumentID>uuid:…</…>` as an element — and both id spellings, `uuid:`
 * and `xmp.did:`, because a parser that recognises one quietly returns nothing
 * for the other. Nothing here reads a decoder from the filesystem or the
 * network: `TextDecoder` is a global, and the bytes arrive as an argument, so the
 * same file still yields the same answer on any machine in any year.
 */
const XMP_LINEAGE =
  /xmpMM:(?:DocumentID|OriginalDocumentID)\s*(?:=\s*"([^"]+)"|>([^<]+)<)/gi;

export function xmpLineageIds(bytes: Uint8Array): string[] {
  if (bytes.length === 0) return [];
  const packet = new TextDecoder("latin1").decode(bytes);
  return [...packet.matchAll(XMP_LINEAGE)]
    .map((match) => (match[1] ?? match[2] ?? "").trim())
    .filter((id) => /^(uuid:|xmp\.did:)/i.test(id));
}

/** The sentence a forensic arm gives when there is no file to look at. */
export function bytesUnavailableReason(
  contentState: ContentState | "absent" | "withdrawn",
): string {
  if (contentState === "refused")
    return "Identity documents are never stored, so there are no bytes to check.";
  if (contentState === "not_retained")
    return "This workspace does not retain document bytes, so there are no bytes to check.";
  if (contentState === "purged")
    return "Needs the original document bytes, which are not retained past the verification window.";
  if (contentState === "absent")
    return "No original file was captured for this upload, so the byte-level checks could not run.";
  // Not a clock and not a workspace policy: one person's decision, which is why
  // it has its own sentence. A row that still has bytes and a withdrawn purpose
  // reads as this, so the refusal is in force from the moment it is recorded and
  // not only once a sweep has had time to run.
  if (contentState === "withdrawn")
    return "This candidate asked us not to keep their document, so there are no bytes to check.";
  return "Needs the original document bytes, which were not captured for this upload.";
}

