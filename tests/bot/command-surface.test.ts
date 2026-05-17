import { expect, test } from "bun:test";
import { PUBLIC_COMMANDS } from "../../src/bot/bot";

test("public bot commands are start, menu, and help", () => {
  expect(PUBLIC_COMMANDS).toEqual(["start", "menu", "help"]);
});
