const MARKDOWN_NOISE = /[*_`~]+/g;
const CURLY_SINGLE_QUOTES = /[‘’]/g;
const CURLY_DOUBLE_QUOTES = /[“”]/g;
const CORRECTION_SUFFIX = /\s*\((?:user\s+corrects?:?)[^)]*\)\.?\s*$/iu;
const MARKDOWN_AVOIDANCE_SUFFIX = /\s*\((?:avoid\s+markdown[^)]*)\)\.?\s*$/iu;
const ASTERISK_PARENS = /\(\s*\*\s*\)/g;
const STANDALONE_ASTERISK = /(^|[\s([{'"])\*(?=$|[\s)\]}"'.,;:!?])/g;
const ASTERISK_PLURAL = /\basterisks\b/g;
const ASTERISK_CHARACTER = /\b(?:the\s+)?asterisk character\b/g;
const REPEATED_ASTERISK = /\basterisk(?:\s+asterisk)+\b/g;
const NON_SEMANTIC_SEPARATORS = /[^\p{L}\p{N}\s+#]+/gu;
const STANDALONE_TOKEN_SYMBOLS = /(?<![\p{L}\p{N}])[+#]+(?![\p{L}\p{N}])/gu;
const WHITESPACE = /\s+/g;

export function canonicalizeMemoryAtomText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(CURLY_SINGLE_QUOTES, "'")
    .replace(CURLY_DOUBLE_QUOTES, '"')
    .replace(CORRECTION_SUFFIX, " ")
    .replace(MARKDOWN_AVOIDANCE_SUFFIX, " ")
    .replace(ASTERISK_PARENS, " asterisk ")
    .replace(STANDALONE_ASTERISK, "$1asterisk")
    .replace(MARKDOWN_NOISE, " ")
    .toLowerCase()
    .replace(ASTERISK_PLURAL, "asterisk")
    .replace(ASTERISK_CHARACTER, "asterisk")
    .replace(REPEATED_ASTERISK, "asterisk")
    .replace(NON_SEMANTIC_SEPARATORS, " ")
    .replace(STANDALONE_TOKEN_SYMBOLS, " ")
    .replace(WHITESPACE, " ")
    .trim();
}

export function mergeNumberSets(...groups: number[][]): number[] {
  return [...new Set(groups.flat())].sort((left, right) => left - right);
}
