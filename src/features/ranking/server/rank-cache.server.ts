import { getSql } from "../../../platform/db.ts";
import { parseJson } from "../../../shared/utils.ts";
import { cacheKey } from "../../../lib/recruiting/hash.ts";
import type { ParsedProfile, RankResult } from "../../../lib/recruiting/types.ts";

export type CachedRank = {
  profile: ParsedProfile;
  rank: RankResult;
  engine: string;
  model?: string;
  provider?: string;
  rubricVersionId?: string | null;
  rubricVersion?: number | null;
  rubricHash?: string | null;
  fromCache: true;
};

type MemEntry = {
  at: number;
  engine: string;
  model?: string;
  provider?: string;
  rubricVersionId?: string | null;
  rubricVersion?: number | null;
  rubricHash?: string | null;
  profile: ParsedProfile;
  rank: RankResult;
};

const MEM_MAX = 400;
const MEM_TTL_MS = 1000 * 60 * 60 * 6; // 6h process cache

const g = globalThis as typeof globalThis & {
  __vettaRankMem__?: Map<string, MemEntry>;
};

function mem(): Map<string, MemEntry> {
  g.__vettaRankMem__ ??= new Map();
  return g.__vettaRankMem__;
}

function touchEvict(map: Map<string, MemEntry>) {
  if (map.size <= MEM_MAX) return;
  const entries = [...map.entries()].sort((a, b) => a[1].at - b[1].at);
  const drop = entries.slice(0, Math.max(1, map.size - MEM_MAX));
  for (const [k] of drop) map.delete(k);
}

/** Evict all in-memory cache entries matching any of the specified resume hashes. */
export function evictRankCache(resumeHashes: string[]): number {
  if (!resumeHashes.length) return 0;
  const map = mem();
  let count = 0;
  const targets = new Set(resumeHashes.filter((h) => h.length > 0));
  for (const key of Array.from(map.keys())) {
    for (const h of targets) {
      if (key.includes(h)) {
        map.delete(key);
        count += 1;
        break;
      }
    }
  }
  return count;
}

/** Clear the entire in-memory rank cache. */
export function clearRankCache(): void {
  mem().clear();
}

/**
 * Invalidate all rank cache entries for a given role or when a rubric version changes.
 */
export async function invalidateRoleRankCache(opts: {
  userId: string;
  roleHash?: string;
  rubricVersionId?: string;
}): Promise<number> {
  const map = mem();
  let count = 0;
  for (const [key, entry] of Array.from(map.entries())) {
    const roleMatch = opts.roleHash ? key.includes(opts.roleHash) : true;
    const rubricMismatch = opts.rubricVersionId
      ? entry.rubricVersionId !== opts.rubricVersionId
      : true;
    if (roleMatch && rubricMismatch) {
      map.delete(key);
      count += 1;
    }
  }

  try {
    const sql = await getSql();
    if (opts.roleHash) {
      await sql`delete from rank_cache where user_id = ${opts.userId} and role_hash = ${opts.roleHash}`;
    } else if (opts.rubricVersionId) {
      await sql`delete from rank_cache where user_id = ${opts.userId} and (rubric_version_id is null or rubric_version_id != ${opts.rubricVersionId})`;
    }
  } catch {
    /* table may be unmigrated */
  }

  return count;
}

export async function getRankCache(opts: {
  userId: string;
  resumeHash: string;
  roleHash: string;
  mode: "fast" | "full";
  rubricVersionId?: string | null;
  rubricHash?: string | null;
}): Promise<CachedRank | null> {
  const key = cacheKey(opts);
  const now = Date.now();
  const hit = mem().get(key);
  if (hit && now - hit.at < MEM_TTL_MS) {
    // If a specific rubric hash was requested and cached entry doesn't match, invalidate as stale
    if (opts.rubricHash && hit.rubricHash && hit.rubricHash !== opts.rubricHash) {
      mem().delete(key);
      try {
        const sql = await getSql();
        await sql`
          delete from rank_cache
          where user_id = ${opts.userId}
            and resume_hash = ${opts.resumeHash}
            and role_hash = ${opts.roleHash}
            and mode = ${opts.mode}`;
      } catch {
        /* corrupt cache row — evict silently */
      }
      return null;
    }
    hit.at = now;
    return {
      profile: hit.profile,
      rank: hit.rank,
      engine: hit.engine,
      model: hit.model,
      provider: hit.provider,
      rubricVersionId: hit.rubricVersionId,
      rubricVersion: hit.rubricVersion,
      rubricHash: hit.rubricHash,
      fromCache: true,
    };
  }

  try {
    const sql = await getSql();
    const rows = await sql<{
      profile_json: string;
      rank_json: string;
      engine: string;
      model?: string;
      provider?: string;
      rubric_version_id?: string | null;
      rubric_version?: number | null;
      rubric_hash?: string | null;
    }>`
      select profile_json, rank_json, engine, model, provider,
             rubric_version_id, rubric_version, rubric_hash
      from rank_cache
      where user_id = ${opts.userId}
        and resume_hash = ${opts.resumeHash}
        and role_hash = ${opts.roleHash}
        and mode = ${opts.mode}
      limit 1`;
    const row = rows[0];
    if (!row) return null;

    // Check if the cached score is stale relative to the active rubric
    if (opts.rubricHash && row.rubric_hash && row.rubric_hash !== opts.rubricHash) {
      mem().delete(key);
      // Invalidate stale DB entry
      await sql`
        delete from rank_cache
        where user_id = ${opts.userId}
          and resume_hash = ${opts.resumeHash}
          and role_hash = ${opts.roleHash}
          and mode = ${opts.mode}`;
      return null;
    }

    const profile = parseJson<ParsedProfile | null>(row.profile_json, null);
    const rank = parseJson<RankResult | null>(row.rank_json, null);
    if (!profile || !rank) return null;

    mem().set(key, {
      at: now,
      engine: row.engine,
      model: row.model,
      provider: row.provider,
      rubricVersionId: row.rubric_version_id,
      rubricVersion: row.rubric_version,
      rubricHash: row.rubric_hash,
      profile,
      rank,
    });
    touchEvict(mem());

    await sql`
      update rank_cache
      set hit_count = hit_count + 1, updated_at = now()
      where user_id = ${opts.userId}
        and resume_hash = ${opts.resumeHash}
        and role_hash = ${opts.roleHash}
        and mode = ${opts.mode}`;

    return {
      profile,
      rank,
      engine: row.engine || "cache",
      model: row.model,
      provider: row.provider,
      rubricVersionId: row.rubric_version_id,
      rubricVersion: row.rubric_version,
      rubricHash: row.rubric_hash,
      fromCache: true,
    };
  } catch {
    // Table may not exist yet on first boot — ignore and miss.
    return null;
  }
}

export async function setRankCache(opts: {
  userId: string;
  resumeHash: string;
  roleHash: string;
  mode: "fast" | "full";
  engine: string;
  model?: string;
  provider?: string;
  rubricVersionId?: string | null;
  rubricVersion?: number | null;
  rubricHash?: string | null;
  profile: ParsedProfile;
  rank: RankResult;
}): Promise<void> {
  const key = cacheKey(opts);
  const now = Date.now();
  mem().set(key, {
    at: now,
    engine: opts.engine,
    model: opts.model,
    provider: opts.provider,
    rubricVersionId: opts.rubricVersionId,
    rubricVersion: opts.rubricVersion,
    rubricHash: opts.rubricHash,
    profile: opts.profile,
    rank: opts.rank,
  });
  touchEvict(mem());

  try {
    const sql = await getSql();
    const id = crypto.randomUUID();
    const profileJson = JSON.stringify(opts.profile);
    const rankJson = JSON.stringify(opts.rank);
    await sql`
      insert into rank_cache (
        id, user_id, resume_hash, role_hash, mode, engine,
        model, provider, rubric_version_id, rubric_version, rubric_hash,
        profile_json, rank_json, hit_count
      ) values (
        ${id}, ${opts.userId}, ${opts.resumeHash}, ${opts.roleHash}, ${opts.mode}, ${opts.engine},
        ${opts.model ?? ""}, ${opts.provider ?? opts.engine}, ${opts.rubricVersionId ?? null},
        ${opts.rubricVersion ?? null}, ${opts.rubricHash ?? ""},
        ${profileJson}, ${rankJson}, ${0}
      )
      on conflict (user_id, resume_hash, role_hash, mode) do update set
        engine = excluded.engine,
        model = excluded.model,
        provider = excluded.provider,
        rubric_version_id = excluded.rubric_version_id,
        rubric_version = excluded.rubric_version,
        rubric_hash = excluded.rubric_hash,
        profile_json = excluded.profile_json,
        rank_json = excluded.rank_json,
        updated_at = now()`;
  } catch {
    // Best-effort durable cache.
  }
}
