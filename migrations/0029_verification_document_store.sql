-- Migration 0029: the document store, its consent clock and its erasure path.
--
-- Verification's Tier A checks run on extracted text, which is why they can only
-- ever catch a liar who is bad at arithmetic. The checks that catch a *forged
-- file* — incremental-update history, an XMP toolchain that post-dates the
-- document, a certificate re-printed over an old page — need the original bytes,
-- and bytes are the one thing this product has never kept. So this table is a
-- privacy decision expressed as a schema, not a convenience feature:
--
--  1. **Retention is off until an org turns it on.** There is no row in
--     `org_document_settings` for an org that has not, and the absence is read
--     as OFF. `documents.content` is nullable precisely so that "we may hold the
--     metadata" and "we hold the file" are different facts in the database, not
--     two states of the same blob.
--  2. **An identity document is never stored at all.** Indian resumes routinely
--     embed Aadhaar or PAN images; `doc_class = 'id'` rows carry no bytes *and no
--     hash*, because a fingerprint of a government ID is still a fingerprint of a
--     government ID. The row exists to record the refusal, which is the part an
--     auditor asks for.
--  3. **A row is per upload, not per content.** Two candidates who both upload
--     the same template must get two rows, because each row is the evidence
--     behind one person's verdict: a unique key on `(org, sha256)` looks like
--     free de-duplication and is actually a silent starvation — the second
--     upload's insert conflicts, its job binds to nothing, and the person who
--     did nothing wrong is the one whose forensic checks cannot run. Duplicates
--     are a query over `sha256`, not a constraint, so they get an index.
--     Refusals and metadata-only rows are excluded from it anyway: they carry no
--     digest at all, by rule 2.
--
-- `expires_at` is the 90-day byte clock. Purging rewrites `content` to null and
-- moves `content_state` to 'purged' while keeping everything that explains a
-- verdict: the class, the size, the digest, the hashed lineage ids and the
-- timestamps. The forensic arms then report `skipped` — "needs the original
-- document bytes, which are not retained" — instead of silently disappearing,
-- which is what keeps the drawer honest after the clock runs out.

create table if not exists documents (
  id text primary key,
  org_id text not null,
  user_id text not null,
  -- The job this file arrived under, and the person it became. A captured upload
  -- has a job and no candidate yet; the queue binds the rest when it ranks it.
  ingest_job_id text,
  candidate_id text,
  application_id text,
  role_id text,
  -- 'resume' | 'certificate' | 'other' | 'id' — 'id' is the refusal class.
  doc_class text not null,
  filename text not null default '',
  media_type text not null default '',
  -- Empty for a refused document, by rule, not by accident.
  sha256 text not null default '',
  size_bytes integer not null default 0,
  -- Document ids from XMP / metadata are stored hashed: they identify a person's
  -- tool, not their identity, and a plaintext InstanceID is a join key we have no
  -- business keeping.
  xmp_ids_hash text not null default '',
  content bytea,
  -- 'stored' (we hold the file) | 'purged' (we held it, the clock ran out) |
  -- 'refused' (an identity document, never taken) | 'not_retained' (the org has
  -- not turned byte retention on, so this row is only the fact that a file came).
  content_state text not null,
  -- What authorised keeping it: 'document_forensics' for a retained file, '' for
  -- a row that only ever held metadata.
  consent_basis text not null default '',
  retention_days integer not null default 90,
  expires_at timestamptz not null default now(),
  purged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Where a later duplicate or lineage cluster starts: same content, different
-- people. Partial because a refusal keeps no digest, and an empty digest is the
-- same value for every refused row in every workspace.
create index if not exists documents_org_sha_idx
  on documents (org_id, sha256) where sha256 <> '';
-- The clock's query, and the per-person erasure query, both start here.
create index if not exists documents_org_expiry_idx on documents (org_id, content_state, expires_at);
create index if not exists documents_candidate_idx on documents (candidate_id);
create index if not exists documents_job_idx on documents (ingest_job_id);

-- One org's decision about holding files at all. Absent row = OFF, so an org that
-- never saw this feature cannot be accumulating resumes by default.
create table if not exists org_document_settings (
  org_id text primary key,
  user_id text not null default '',
  byte_retention boolean not null default false,
  -- Capped at 90 in code; the column is a number, not a promise.
  retention_days integer not null default 90,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
