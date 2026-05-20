# Telegram flow

This document explains the Telegram-facing control surface of the runtime.

Use `docs/architecture.md` for the system map. This file owns the command, menu, callback, and conversation boundaries.

## Public command surface

The public Telegram commands are:

- `/start`
- `/menu`
- `/help`

Everything else should be treated as menu/callback/conversation behavior rather than part of a larger public slash-command API.

## Commands vs menus vs conversations

- commands open entry points
- menus provide navigation and screen selection
- callbacks trigger actions or route into deeper flows
- conversations handle multi-step input safely

This keeps the Telegram surface small while still supporting richer flows such as schedule changes, confirmations, and draft generation.

## Main menu journeys

The main menu itself currently exposes:

- Memory
- Jobs
- Help

From the Memory summary, users can continue into:

- Memory Update
- Skill Drafts

That means Skill Drafts is part of the menu-driven UX, but it is nested under the Memory path rather than being a top-level public command.

## Callback and conversation routing

Callbacks are used to move between screens and trigger actions such as opening Memory Update, opening Jobs, refreshing screens, or entering a detail flow.

Conversations are used for flows that need multiple steps, including:

- Memory Update schedule changes
- asynchronous Memory Update run-now handling
- job creation
- job detail editing
- skill draft generation

## Service handoff boundary

The Telegram layer should stay focused on transport, rendering, and routing.

Persistent logic belongs in service and memory layers, not in Telegram UI handlers.

In practice, that means bot handlers should present screens, enter conversations, or call into service-backed actions instead of owning job persistence, schedule semantics, or memory-maintenance logic directly.

## Background-triggered UX updates

Some Telegram actions do not finish in a single synchronous screen change.

The clearest current example is Memory Update run-now: the callback can trigger background work, and follow-up progress or result messages can arrive later.

This is why the Telegram flow should be understood as both screen navigation and event-triggered messaging.

## UI principles for contributors

- keep the public command surface small
- prefer menus and callbacks over new public commands
- use conversations for multi-step or confirmation-heavy flows
- keep Telegram handlers thin and delegate persistent behavior to services
- return users to the relevant parent view after completing or canceling a nested flow

## Relevant code

- `src/bot/bot.ts`
- `src/bot/ui/keyboards.ts`
- `src/bot/ui/renderers.ts`
- `src/bot/conversations/memory-update.ts`
- `src/bot/conversations/memory-update-runner.ts`
- `src/bot/conversations/job-create.ts`
- `src/bot/conversations/job-detail.ts`
- `src/bot/conversations/skill-draft.ts`

## Related docs

- `docs/architecture.md`
- `docs/autonomous-jobs.md`
- `docs/memory.md`
