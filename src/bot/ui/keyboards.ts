import { InlineKeyboard } from "grammy";

export const uiCallbacks = {
  menu: "ui:menu",
  help: "ui:help",
  back: "ui:back",
  memory: "ui:memory",
  jobs: "ui:jobs",
  memoryUpdate: "ui:memory:update",
  skillDrafts: "ui:memory:skill-drafts",
  generateSkillDraft: "ui:memory:skill-drafts:generate",
  addJob: "ui:jobs:add",
  refreshJobs: "ui:jobs:refresh",
  schedulePreset10m: "ui:schedule:10m",
  schedulePreset30m: "ui:schedule:30m",
  schedulePreset1h: "ui:schedule:1h",
  schedulePreset6h: "ui:schedule:6h",
  schedulePreset12h: "ui:schedule:12h",
  schedulePreset24h: "ui:schedule:24h",
  customCron: "ui:schedule:custom-cron",
  cancel: "ui:cancel",
} as const;

export function buildStartKeyboard() {
  return new InlineKeyboard().text("Menu", uiCallbacks.menu).text("Help", uiCallbacks.help);
}

export function buildMainMenuKeyboard() {
  return new InlineKeyboard()
    .text("Memory", uiCallbacks.memory)
    .text("Jobs", uiCallbacks.jobs)
    .row()
    .text("Help", uiCallbacks.help);
}

export function buildMemorySummaryKeyboard() {
  return new InlineKeyboard().text("Memory Update", uiCallbacks.memoryUpdate).text("Skill Drafts", uiCallbacks.skillDrafts).row().text("Back", uiCallbacks.back);
}

export function buildSkillDraftKeyboard() {
  return new InlineKeyboard().text("Generate Draft Skill", uiCallbacks.generateSkillDraft).row().text("Back", uiCallbacks.memory);
}

export function buildJobsKeyboard() {
  return new InlineKeyboard()
    .text("Add Job", uiCallbacks.addJob)
    .text("Refresh Jobs", uiCallbacks.refreshJobs)
    .row()
    .text("Back", uiCallbacks.back);
}

export function buildHelpKeyboard() {
  return new InlineKeyboard().text("Menu", uiCallbacks.menu);
}

export function buildSchedulePresetKeyboard() {
  return new InlineKeyboard()
    .text("10m", uiCallbacks.schedulePreset10m)
    .text("30m", uiCallbacks.schedulePreset30m)
    .row()
    .text("1h", uiCallbacks.schedulePreset1h)
    .text("6h", uiCallbacks.schedulePreset6h)
    .row()
    .text("12h", uiCallbacks.schedulePreset12h)
    .text("24h", uiCallbacks.schedulePreset24h)
    .row()
    .text("Custom cron", uiCallbacks.customCron)
    .text("Cancel", uiCallbacks.cancel);
}
