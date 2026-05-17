# Memory

This project uses a project-owned memory backend with a protected layered model.

## Protected model boundary

The memory model is unchanged and must remain as-is:

- L0 conversations
- L1 atoms
- L2 scenarios
- L3 persona
- offload refs
- Mermaid canvas

These layers keep their existing meanings and responsibilities.

## What Memory Update means

Memory Update is the Telegram-managed workflow for durable memory maintenance.

It is not a public slash command.

It is accessed from the Telegram menu and can:

- run memory maintenance now
- enable or disable automatic updates
- choose a preset cadence
- accept a custom cron schedule when needed
- show status, last run, last result, and last error

## Per-user scheduling

Memory Update scheduling is stored per user.

The default behavior for a new user is:

- enabled
- every 24 hours

That makes memory maintenance a Telegram-managed setting rather than a `.env`-driven user-facing behavior.

## Offload refs and canvas

When the agent offloads heavy tool output, the raw result is stored in an offload ref file.

The Mermaid canvas provides a compact navigational summary of the active memory context. The agent can read the offloaded reference later if it needs the raw details.

## Why this matters

The memory runtime can evolve around the edges, but the semantics of the underlying layers must not change. This documentation exists to keep that boundary explicit for future work.