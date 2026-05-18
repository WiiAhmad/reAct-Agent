import { BM25Encoder, type SparseVector } from "@tencentdb-agent-memory/tcvdb-text";

export type { SparseVector };

export type BM25LocalOptions = {
  enabled?: boolean;
  language?: "zh" | "en";
};

export type BM25LocalEncoder = {
  available: boolean;
  encodeTexts(texts: string[]): SparseVector[];
  encodeQueries(texts: string[]): SparseVector[];
};

const unavailableEncoder: BM25LocalEncoder = {
  available: false,
  encodeTexts: () => [],
  encodeQueries: () => [],
};

export function createBM25LocalEncoder(options: BM25LocalOptions = {}): BM25LocalEncoder {
  if (options.enabled === false) {
    return unavailableEncoder;
  }

  try {
    const encoder = BM25Encoder.default(options.language ?? "en");

    return {
      available: true,
      encodeTexts(texts: string[]): SparseVector[] {
        if (texts.length === 0) {
          return [];
        }

        try {
          return encoder.encodeTexts(texts);
        } catch {
          return [];
        }
      },
      encodeQueries(texts: string[]): SparseVector[] {
        if (texts.length === 0) {
          return [];
        }

        try {
          return encoder.encodeQueries(texts);
        } catch {
          return [];
        }
      },
    };
  } catch {
    return unavailableEncoder;
  }
}

export function sparseVectorScore(query: SparseVector, document: SparseVector): number {
  if (query.length === 0 || document.length === 0) {
    return 0;
  }

  const documentWeights = new Map<number, number>();
  for (const [token, weight] of document) {
    documentWeights.set(token, weight);
  }

  let score = 0;
  for (const [token, weight] of query) {
    score += weight * (documentWeights.get(token) ?? 0);
  }

  return score;
}
