import { expect, test } from "bun:test";
import {
  buildHelpKeyboard,
  buildJobsKeyboard,
  buildMainMenuKeyboard,
  buildMemorySummaryKeyboard,
  buildSchedulePresetKeyboard,
  buildSkillDraftKeyboard,
  buildStartKeyboard,
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

test("main menu shows Memory, Jobs, and Help entries", () => {
  const keyboard = buildMainMenuKeyboard();
  const screen = renderMainMenuScreen();

  expect(keyboardLabels(keyboard)).toEqual(["Memory", "Jobs", "Help"]);
  expect(screen).toContain("Memory");
  expect(screen).toContain("Jobs");
  expect(screen).toContain("Help");
  expect(screen).toContain("Memory Update");
  expect(screen).toContain("menu");
});

test("help screen documents the reduced command surface", () => {
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
