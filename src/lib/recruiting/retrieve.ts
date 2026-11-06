/**
 * Merge lexical (Postgres FTS) and semantic scores.
 * Semantic vectors come from a multilingual embedding model at runtime.
 */

export function candidateDocument(parts: {
  fullName: string;
  title: string;
  company: string;
  location: string;
  resumeText: string;
}): string {
  return [parts.fullName, parts.title, parts.company, parts.location, parts.resumeText]
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n");
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  if (d < 1e-8) return 0;
  return Math.max(-1, Math.min(1, dot / d));
}

/** FTS rank is unbounded. Squash to 0–1 so it can sit next to cosine. */
export function lexicalUnit(rank: number): number {
  if (!Number.isFinite(rank) || rank <= 0) return 0;
  return rank / (rank + 0.3);
}

/**
 * Filters and full-text run first. Semantic retrieval still surfaces a
 * cross-lingual hit when the words do not match (Hindi query, English resume).
 */
export function mergeRetrievalScore(lexical: number, semantic: number | null): number {
  const lex = lexicalUnit(lexical);
  if (semantic == null) return lex;
  const sem = (semantic + 1) / 2;
  if (lex === 0) return sem * 0.92;
  return lex * 0.42 + sem * 0.58;
}

export type ScoredItem = {
  id: string;
  score: number;
};

export type FusionResult = {
  id: string;
  rrfScore: number;
  lexicalRank: number | null;
  semanticRank: number | null;
  lexicalScore: number;
  semanticScore: number;
  blendedScore: number;
};

/**
 * Reciprocal Rank Fusion (RRF).
 * Combines rankings from separate retrieval towers (e.g. Lexical FTS and Semantic Dense Vectors).
 *
 * Formula:
 *   RRF_score(d) = sum_{m in models} w_m / (k + rank_m(d))
 * Standard constant k = 60 prevents high ranks from dominating.
 */
export function reciprocalRankFusion(
  lexicalList: ScoredItem[],
  semanticList: ScoredItem[],
  options?: {
    k?: number;
    lexicalWeight?: number;
    semanticWeight?: number;
  },
): FusionResult[] {
  const k = options?.k ?? 60;
  const wLex = options?.lexicalWeight ?? 1.0;
  const wSem = options?.semanticWeight ?? 1.0;

  // Map to store combined candidate entries
  const map = new Map<
    string,
    {
      lexRank: number | null;
      semRank: number | null;
      lexScore: number;
      semScore: number;
    }
  >();

  // Sort and assign 1-based ranks
  const sortedLex = [...lexicalList].sort((a, b) => b.score - a.score);
  sortedLex.forEach((item, idx) => {
    map.set(item.id, {
      lexRank: idx + 1,
      semRank: null,
      lexScore: item.score,
      semScore: 0,
    });
  });

  const sortedSem = [...semanticList].sort((a, b) => b.score - a.score);
  sortedSem.forEach((item, idx) => {
    const existing = map.get(item.id);
    if (existing) {
      existing.semRank = idx + 1;
      existing.semScore = item.score;
    } else {
      map.set(item.id, {
        lexRank: null,
        semRank: idx + 1,
        lexScore: 0,
        semScore: item.score,
      });
    }
  });

  const results: FusionResult[] = [];
  for (const [id, entry] of map.entries()) {
    let rrf = 0;
    if (entry.lexRank !== null) {
      rrf += wLex / (k + entry.lexRank);
    }
    if (entry.semRank !== null) {
      rrf += wSem / (k + entry.semRank);
    }

    const lexNorm = lexicalUnit(entry.lexScore);
    const semNorm = entry.semRank !== null ? Math.max(0, Math.min(1, (entry.semScore + 1) / 2)) : 0;
    
    // Calibrated blended score between 0 and 1
    let blendedScore = 0;
    if (entry.lexRank !== null && entry.semRank !== null) {
      blendedScore = (wLex * lexNorm + wSem * semNorm) / (wLex + wSem);
    } else if (entry.lexRank !== null) {
      blendedScore = lexNorm * 0.9;
    } else {
      blendedScore = semNorm * 0.95;
    }

    results.push({
      id,
      rrfScore: rrf,
      lexicalRank: entry.lexRank,
      semanticRank: entry.semRank,
      lexicalScore: entry.lexScore,
      semanticScore: entry.semScore,
      blendedScore,
    });
  }

  // Sort by RRF score descending, breaking ties by blendedScore
  results.sort((a, b) => {
    if (Math.abs(b.rrfScore - a.rrfScore) > 1e-7) {
      return b.rrfScore - a.rrfScore;
    }
    return b.blendedScore - a.blendedScore;
  });

  return results;
}

/**
 * Recall@K: Proportion of relevant documents successfully retrieved within top-k positions.
 */
export function recallAtK(
  relevantIds: Set<string> | string[],
  retrievedIds: string[],
  k: number,
): number {
  const relSet = relevantIds instanceof Set ? relevantIds : new Set(relevantIds);
  if (relSet.size === 0) return 0;
  const topK = retrievedIds.slice(0, k);
  let hits = 0;
  for (const id of topK) {
    if (relSet.has(id)) hits += 1;
  }
  return hits / relSet.size;
}

/**
 * Mean Reciprocal Rank (MRR): Average of reciprocal rank of the first relevant document.
 */
export function meanReciprocalRank(
  queries: Array<{
    relevantIds: Set<string> | string[];
    retrievedIds: string[];
  }>,
): number {
  if (queries.length === 0) return 0;
  let sumRr = 0;
  for (const q of queries) {
    const relSet = q.relevantIds instanceof Set ? q.relevantIds : new Set(q.relevantIds);
    let rank = 0;
    for (let i = 0; i < q.retrievedIds.length; i += 1) {
      if (relSet.has(q.retrievedIds[i]!)) {
        rank = i + 1;
        break;
      }
    }
    if (rank > 0) {
      sumRr += 1 / rank;
    }
  }
  return sumRr / queries.length;
}

/**
 * Normalized Discounted Cumulative Gain at K (NDCG@K).
 * Evaluates ranking quality with graded relevance levels (e.g. 0 = irrelevant, 1 = relevant, 2 = highly relevant).
 */
export function ndcgAtK(
  relevanceMap: Map<string, number> | Record<string, number>,
  retrievedIds: string[],
  k: number,
): number {
  const getRelevance = (id: string): number => {
    if (relevanceMap instanceof Map) return relevanceMap.get(id) ?? 0;
    return (relevanceMap as Record<string, number>)[id] ?? 0;
  };

  const topK = retrievedIds.slice(0, k);
  let dcg = 0;
  for (let i = 0; i < topK.length; i += 1) {
    const rel = getRelevance(topK[i]!);
    dcg += (Math.pow(2, rel) - 1) / Math.log2(i + 2);
  }

  // Calculate ideal DCG (IDCG)
  const allRelevances: number[] = [];
  if (relevanceMap instanceof Map) {
    for (const v of relevanceMap.values()) allRelevances.push(v);
  } else {
    for (const id of Object.keys(relevanceMap)) {
      allRelevances.push((relevanceMap as Record<string, number>)[id]!);
    }
  }
  allRelevances.sort((a, b) => b - a);

  let idcg = 0;
  for (let i = 0; i < Math.min(k, allRelevances.length); i += 1) {
    const rel = allRelevances[i]!;
    idcg += (Math.pow(2, rel) - 1) / Math.log2(i + 2);
  }

  if (idcg === 0) return 0;
  return dcg / idcg;
}

export type BenchmarkEvaluationResult = {
  recallAt1: number;
  recallAt3: number;
  recallAt5: number;
  recallAt10: number;
  mrr: number;
  ndcgAt5: number;
  vocabularyMismatchRecoveryRate: number;
};

/**
 * Computes benchmark evaluation metrics across a suite of query test cases.
 */
export function computeRetrievalMetrics(
  testCases: Array<{
    query: string;
    relevantIds: string[];
    gradedRelevance?: Record<string, number>;
    isVocabularyMismatch?: boolean;
    retrievedIds: string[];
  }>,
): BenchmarkEvaluationResult {
  if (testCases.length === 0) {
    return {
      recallAt1: 0,
      recallAt3: 0,
      recallAt5: 0,
      recallAt10: 0,
      mrr: 0,
      ndcgAt5: 0,
      vocabularyMismatchRecoveryRate: 0,
    };
  }

  let r1Sum = 0;
  let r3Sum = 0;
  let r5Sum = 0;
  let r10Sum = 0;
  let ndcg5Sum = 0;
  let mismatchCount = 0;
  let mismatchRecovered = 0;

  for (const tc of testCases) {
    r1Sum += recallAtK(tc.relevantIds, tc.retrievedIds, 1);
    r3Sum += recallAtK(tc.relevantIds, tc.retrievedIds, 3);
    r5Sum += recallAtK(tc.relevantIds, tc.retrievedIds, 5);
    r10Sum += recallAtK(tc.relevantIds, tc.retrievedIds, 10);

    const relMap: Record<string, number> = tc.gradedRelevance ?? {};
    if (Object.keys(relMap).length === 0) {
      for (const id of tc.relevantIds) relMap[id] = 2;
    }
    ndcg5Sum += ndcgAtK(relMap, tc.retrievedIds, 5);

    if (tc.isVocabularyMismatch) {
      mismatchCount += 1;
      const rec = recallAtK(tc.relevantIds, tc.retrievedIds, 5);
      if (rec > 0) mismatchRecovered += 1;
    }
  }

  const n = testCases.length;
  const mrr = meanReciprocalRank(
    testCases.map((tc) => ({
      relevantIds: tc.relevantIds,
      retrievedIds: tc.retrievedIds,
    })),
  );

  return {
    recallAt1: r1Sum / n,
    recallAt3: r3Sum / n,
    recallAt5: r5Sum / n,
    recallAt10: r10Sum / n,
    mrr,
    ndcgAt5: ndcg5Sum / n,
    vocabularyMismatchRecoveryRate: mismatchCount > 0 ? mismatchRecovered / mismatchCount : 1.0,
  };
}
