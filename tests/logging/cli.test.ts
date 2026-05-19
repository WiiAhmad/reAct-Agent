import { expect, test } from "bun:test";
import { parseRuntimeCliArgs } from "../../src/logging/cli";

test("parseRuntimeCliArgs defaults logLevel off and migrateOnly false", () => {
  expect(parseRuntimeCliArgs([])).toEqual({ migrateOnly: false });
});

test("parseRuntimeCliArgs preserves --migrate-only parsing", () => {
  expect(parseRuntimeCliArgs(["--migrate-only"])).toEqual({ migrateOnly: true });
});

test("parseRuntimeCliArgs accepts spaced --log syntax", () => {
  expect(parseRuntimeCliArgs(["--log", "1"])).toEqual({ logLevel: 1, migrateOnly: false });
  expect(parseRuntimeCliArgs(["--log", "2"])).toEqual({ logLevel: 2, migrateOnly: false });
  expect(parseRuntimeCliArgs(["--log", "3"])).toEqual({ logLevel: 3, migrateOnly: false });
});

test("parseRuntimeCliArgs accepts equals --log syntax", () => {
  expect(parseRuntimeCliArgs(["--log=1"])).toEqual({ logLevel: 1, migrateOnly: false });
  expect(parseRuntimeCliArgs(["--log=2"])).toEqual({ logLevel: 2, migrateOnly: false });
  expect(parseRuntimeCliArgs(["--log=3"])).toEqual({ logLevel: 3, migrateOnly: false });
});

test("parseRuntimeCliArgs rejects invalid --log values", () => {
  expect(() => parseRuntimeCliArgs(["--log", "4"])).toThrow('Invalid --log value "4". Use 1, 2, or 3.');
  expect(() => parseRuntimeCliArgs(["--log=debug"])).toThrow('Invalid --log value "debug". Use 1, 2, or 3.');
});

test("parseRuntimeCliArgs rejects missing bare --log value", () => {
  expect(() => parseRuntimeCliArgs(["--log"])).toThrow('Missing value after "--log". Use 1, 2, or 3.');
});

test("parseRuntimeCliArgs rejects duplicate --log", () => {
  expect(() => parseRuntimeCliArgs(["--log", "1", "--log=2"])).toThrow("Use --log only once.");
});
