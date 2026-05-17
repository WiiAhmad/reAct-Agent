# Telegram flow

This bot is designed around Telegram menus, inline buttons, and conversations from `@grammyjs/conversations`.

## Public commands

- `/start` - onboarding entry point
- `/menu` - open the main menu
- `/help` - explain the runtime and navigation

## Main user journeys

### Start flow

`/start` welcomes the user and points them toward the menu and help.

### Menu flow

`/menu` opens the main navigation hub.

Typical sections:

- Memory
- Jobs
- Help

The menu is the preferred way to reach the rest of the runtime.

### Help flow

`/help` explains the simplified public command surface and how to use the button-driven UI.

## Conversations

`@grammyjs/conversations` is used for any flow that needs multiple steps.

That includes:

- creating a job
- editing a job schedule
- entering a custom cron expression
- configuring Memory Update
- confirming destructive actions like delete or disable

Conversations keep these flows structured and replay-safe.

## UI principles

- prefer buttons over free-form commands
- keep summaries short and actionable
- reuse the same labels in the menu and the detail views
- send the user back to the relevant parent menu after a completed action

## Callback routing

Inline buttons act as navigation and action triggers.

The bot should route buttons into the appropriate conversation or service-backed action instead of exposing a larger public command set.

## What changed from the old UX

The old command-heavy surface is gone.

Users should no longer rely on `/tools`, `/memory_force`, `/job <prompt>`, or `/jobs` as the primary interaction model. Those behaviors now live behind menus and conversations.