const MARKDOWN_NOISE = /[*_`~]+/g;
const CURLY_SINGLE_QUOTES = /[‘’]/g;
const CURLY_DOUBLE_QUOTES = /[“”]/g;
const NON_SEMANTIC_SEPARATORS = /[^\p{L}\p{N}\s+#]+/gu;
const STANDALONE_TOKEN_SYMBOLS = /(?<![\p{L}\p{N}])[+#]+(?![\p{L}\p{N}])/gu;
const WHITESPACE = /\s+/g;

export function canonicalizeMemoryAtomText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(CURLY_SINGLE_QUOTES, "'")
    .replace(CURLY_DOUBLE_QUOTES, '"')
    .replace(MARKDOWN_NOISE, " ")
    .toLowerCase()
    .replace(NON_SEMANTIC_SEPARATORS, " ")
    .replace(STANDALONE_TOKEN_SYMBOLS, " ")
    .replace(WHITESPACE, " ")
    .trim();
}

export function mergeNumberSets(...groups: number[][]): number[] {
  return [...new Set(groups.flat())].sort((left, right) => left - right);
}
