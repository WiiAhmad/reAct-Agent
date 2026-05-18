import type { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";

const VECTOR_DIMENSIONS = 64;

export function vectorDimensions(): number {
  return VECTOR_DIMENSIONS;
}

function normalizeEmbeddingText(input: string): string {
  return (input.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join("");
}

function hashGram(gram: string): number {
  let hash = 2166136261;
  for (const char of gram) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function loadSqliteVec(db: Database): void {
  sqliteVec.load(db as never);
}

export function ensureSqliteVecTable(db: Database, tableName = "memory_atoms_vec"): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
    throw new Error(`Invalid sqlite-vec table name: ${tableName}`);
  }

  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${tableName} USING vec0(embedding float[${VECTOR_DIMENSIONS}])`);
}

export function embedTextToVector(text: string): Float32Array {
  const normalized = normalizeEmbeddingText(text);
  const vector = new Float32Array(VECTOR_DIMENSIONS);
  const codepoints = Array.from(normalized);

  if (codepoints.length === 0) {
    return vector;
  }

  const grams = codepoints.length <= 3
    ? [codepoints.join("")]
    : Array.from({ length: codepoints.length - 2 }, (_, index) => codepoints.slice(index, index + 3).join(""));

  for (const gram of grams) {
    const slot = hashGram(gram) % VECTOR_DIMENSIONS;
    vector[slot] = (vector[slot] ?? 0) + 1;
  }

  let magnitude = 0;
  for (const value of vector) {
    magnitude += value * value;
  }

  if (magnitude === 0) {
    return vector;
  }

  const scale = Math.sqrt(magnitude);
  for (let index = 0; index < vector.length; index += 1) {
    vector[index] = (vector[index] ?? 0) / scale;
  }

  return vector;
}

export function isZeroVector(vector: Float32Array): boolean {
  for (const value of vector) {
    if (value !== 0) {
      return false;
    }
  }

  return true;
}

export function serializeVector(vector: Float32Array): string {
  return JSON.stringify(Array.from(vector));
}

export function deserializeVector(raw: string): Float32Array {
  const parsed = JSON.parse(raw) as unknown;
  const inputValues = Array.isArray(parsed) ? parsed : [];
  const values = Array.from({ length: VECTOR_DIMENSIONS }, (_, index) => {
    const value = inputValues[index];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  });

  return new Float32Array(values);
}
