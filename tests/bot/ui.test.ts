import { expect, test } from "bun:test";
import {
  buildHelpKeyboard,
  buildJobsKeyboard,
  buildMainMenuKeyboard,
  buildMemorySummaryKeyboard,
  buildSchedulePresetKeyboard,
  buildSkillDraftKeyboard,
  buildStartKeyboard,
  uiCallbacks,
} from "../../src/bot/ui/keyboards";
import {
  renderHelpScreen,
  renderJobsScreen,
  renderMainMenuScreen,
  renderMemorySummaryScreen,
  renderStartScreen,
} from "../../src/bot/ui/renderers";

function keyboardLabels(keyboard: { inline_keyboard: Array<Array<{ text: string }>> }) {
  return keyboard.inline_keyboard.flat().map((button) => button.text);
}

type KeyboardButton = ReturnType<typeof buildMainMenuKeyboard>["inline_keyboard"][number][number];

function hasCallbackData(button: KeyboardButton): button is KeyboardButton & { callback_data: string } {
  return "callback_data" in button;
}

function callbackDataValues(keyboard: { inline_keyboard: KeyboardButton[][] }) {
  return keyboard.inline_keyboard.flat().filter(hasCallbackData).map((button) => button.callback_data);
}

test("start screen shows Menu and Help and no removed commands", () => {
  const keyboard = buildStartKeyboard();
  const screen = renderStartScreen();

  expect(keyboardLabels(keyboard)).toEqual(["Menu", "Help"]);
  expect(screen).toContain("Menu");
  expect(screen).toContain("Help");
  expect(screen).toContain("/start, /menu, /help");
  expect(screen).not.toContain("/tools");
  expect(screen).not.toContain("/memory_force");
  expect(screen).not.toContain("/job");
  expect(screen).not.toContain("/jobs");
});

test("main menu keeps private-chat defaults", () => {
  const keyboard = buildMainMenuKeyboard();
  const screen = renderMainMenuScreen();

  expect(keyboardLabels(keyboard)).toEqual(["Memory", "Jobs", "Help"]);
  expect(screen).toContain("Memory membuka ringkasan memory");
  expect(screen).toContain("Jobs");
  expect(screen).toContain("Help");
  expect(screen).toContain("Memory Update");
  expect(screen).toContain("menu");
});

test("main menu shared-chat variant omits memory entrypoints", () => {
  const keyboard = buildMainMenuKeyboard({ isPrivateChat: false });
  const screen = renderMainMenuScreen({ isPrivateChat: false });

  expect(keyboardLabels(keyboard)).toEqual(["Jobs", "Help"]);
  expect(callbackDataValues(keyboard)).not.toContain(uiCallbacks.memory);
  expect(screen).toContain("Jobs membuka pengelolaan autonomous jobs dari menu.");
  expect(screen).toContain("Memory tetap private-only");
  expect(screen).not.toContain("Memory membuka ringkasan memory");
  expect(screen).not.toContain("Memory Update");
  expect(screen).not.toContain("Skill Drafts");
});

test("help screen keeps private-chat defaults", () => {
  const keyboard = buildHelpKeyboard();
  const screen = renderHelpScreen();

  expect(keyboardLabels(keyboard)).toEqual(["Menu"]);
  expect(screen).toContain("/start - buka start screen");
  expect(screen).toContain("/menu - buka menu utama");
  expect(screen).toContain("/help - tampilkan bantuan ini");
  expect(screen).toContain("Memory Update, Skill Drafts, dan Jobs tersedia dari menu");
  expect(screen).not.toContain("/create-skill");
  expect(screen).not.toContain("/tools");
  expect(screen).not.toContain("/memory_force");
  expect(screen).not.toContain("/job");
  expect(screen).not.toContain("/jobs");
});

test("help screen shared-chat variant avoids advertising memory menu entries", () => {
  const keyboard = buildHelpKeyboard({ isPrivateChat: false });
  const screen = renderHelpScreen({ isPrivateChat: false });

  expect(keyboardLabels(keyboard)).toEqual(["Menu"]);
  expect(screen).toContain("/start - buka start screen");
  expect(screen).toContain("/menu - buka menu utama");
  expect(screen).toContain("/help - tampilkan bantuan ini");
  expect(screen).toContain("Jobs tersedia dari menu");
  expect(screen).toContain("Memory tetap private-only");
  expect(screen).not.toContain("Memory Update, Skill Drafts, dan Jobs tersedia dari menu");
  expect(screen).not.toContain("Skill Drafts");
  expect(screen).not.toContain("Memory Update");
});

test("memory summary and jobs screens keep the menu-driven copy", () => {
  expect(buildMemorySummaryKeyboard().inline_keyboard.flat().map((button) => button.text)).toEqual([
    "Memory Update",
    "Skill Drafts",
    "Back",
  ]);
  expect(buildSkillDraftKeyboard().inline_keyboard.flat().map((button) => button.text)).toEqual([
    "Generate Draft Skill",
    "Back",
  ]);
  expect(buildJobsKeyboard().inline_keyboard.flat().map((button) => button.text)).toEqual([
    "Add Job",
    "Refresh Jobs",
    "Back",
  ]);
  expect(buildSchedulePresetKeyboard().inline_keyboard.flat().map((button) => button.text)).toEqual([
    "10m",
    "30m",
    "1h",
    "6h",
    "12h",
    "24h",
    "Custom cron",
    "Cancel",
  ]);

  expect(renderMemorySummaryScreen("Memory summary body")).toContain("Memory Update dikelola dari menu.");
  expect(renderMemorySummaryScreen("Memory summary body")).toContain("Memory summary body");
  expect(renderJobsScreen("Jobs summary body")).toContain("Autonomous jobs dikelola dari menu.");
  expect(renderJobsScreen("Jobs summary body")).toContain("Jobs summary body");
});
