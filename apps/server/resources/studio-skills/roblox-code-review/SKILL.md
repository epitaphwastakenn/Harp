---
name: roblox-code-review
description: "Use when reviewing or auditing Roblox Luau code: a diff, a script, a feature or a whole place, and deciding what to fix first."
when_to_use: "Also when asked to review, audit, check or sanity-check code, 'is this safe', 'anything wrong with this', looking for bugs, exploits or leaks, and before publishing or merging a change."
last_reviewed: 2026-11-14
sources:
  - original
---

# Roblox Code Review

## When to Load

Load to review Luau you or the user wrote. This skill routes: it decides scope, which domain skill to load for each finding, and how to report. It does not replace them. To fix a finding, load the domain skill it points to.

## Quick Reference

### Scope first

- Review what changed before what exists: the diff or the scripts the user names, then their direct callers and the remotes, modules and DataStore keys they touch.
- Sort scripts by where they run (Server, Client, shared module). The client/server boundary is where the worst bugs live; read every `OnServerEvent`, `OnServerInvoke`, `ProcessReceipt`, `PlayerAdded`/`PlayerRemoving` and `BindToClose` first.
- Read the scripts. Do not review from memory or from names. In Studio use `script_read`, `script_grep` and `search_game_tree`; in a project use the files.
- A whole-place audit: list scripts by size and by remote count, review the riskiest ten, say which you skipped.

### Checks that matter most

1. **Trusting the client:** the server takes price, damage, reward, target, position, time or owner from a remote argument or a client-set value.
2. **Remotes:** no type, range, NaN, ownership, state or distance check; no per-player rate limit; a `RemoteFunction` the server yields on for the client.
3. **Saves:** `GetAsync`/`SetAsync` without `pcall`, retry or `UpdateAsync`; no session lock; saving on leave only, not on `BindToClose`; a save that overwrites after a failed load.
4. **Purchases:** `ProcessReceipt` that grants before saving, is not idempotent, or returns `PurchaseGranted` on failure; prompts that grant.
5. **Leaks:** connections never disconnected, per-player tables never cleared on `PlayerRemoving`, handlers added on every respawn, `Instance`s never `Destroy`ed, tweens and loops with no owner.
6. **Hot paths:** yields, `FindFirstChild` scans, `GetDescendants`, string building or instance creation inside `Heartbeat`, `RenderStepped` or `Touched`.
7. **Deprecated and wrong APIs:** `wait`/`spawn`/`delay`, `Instance.new(name, parent)`, `LoadAnimation` on the `Humanoid`, the `BodyVelocity` family, `:connect`, global `_G` state.
8. **Luau traps:** `nil` in arrays, `#` on holes, `pairs` order assumptions, string vs number keys, method call with `.`, `or` defaults that swallow `false`.

### Route what you find

| Finding                                                   | Load                       |
| --------------------------------------------------------- | -------------------------- |
| Client authority, exploits, economy dupes, admin commands | `roblox-security`          |
| Remote arguments, rate limits, payloads, hit validation   | `roblox-networking`        |
| Saves, DataStore, ProfileStore, migrations, lifecycle     | `roblox-data`              |
| Leaderboards, MessagingService, MemoryStore               | `roblox-server-data`       |
| Products, passes, receipts, offers, policy                | `roblox-monetization`      |
| Leaks, signals, task scheduling, pcall, cleanup           | `roblox-luau-patterns`     |
| Syntax, nil, tables, strings, deprecated APIs             | `roblox-luau-core`         |
| Type errors, strict mode, module types                    | `roblox-luau-types`        |
| FPS, memory, hot loops, network load                      | `roblox-performance`       |
| Where code lives, require cycles, ownership               | `roblox-architecture`      |
| Open Cloud keys, webhooks, HttpService                    | `roblox-cloud`             |
| Ready to ship                                             | `roblox-publish-checklist` |

Load only the skills the findings need, and the matching section (`references/full.md#<n>` of that skill), not whole files. Section-by-section routing: `references/full.md#2`.

### Report

Group by severity (Critical, High, Medium, Low). Each finding: `path:line`, the problem in one sentence, the concrete fix. End with a Verified/Unverified note. Exact format and severity rules: `references/full.md#3`.

> Details: [references/full.md](references/full.md)
