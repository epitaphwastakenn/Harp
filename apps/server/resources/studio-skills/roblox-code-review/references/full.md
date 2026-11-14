# Roblox Code Review

## 1. Scope the review

1. Ask or infer the target: a diff, named scripts, a feature, or the whole place. If it is unclear, review the most recent changes and say so.
2. Collect scripts and note where each runs: `Script` with RunContext Server, `LocalScript` or `Script` with RunContext Client, `ModuleScript` (who requires it).
3. Order the reading:
   - Server entry points that accept client input (remote handlers, `ProximityPrompt.Triggered`, `Tool` events, `ClickDetector`).
   - Persistence and money (DataStore, `ProcessReceipt`, `PromptProductPurchase` callers, currency changes).
   - Per-frame and per-player code (`Heartbeat`, `RenderStepped`, `Stepped`, `PlayerAdded`, `CharacterAdded`).
   - Everything else, by size.
4. Follow each remote from its client call site to its server handler and back. A review that only reads one side misses the mismatch.
5. For a diff, also read the unchanged code the change calls or is called by; bugs appear at the join.
6. Run what can be run: a Luau analyzer or linter if the project has one, the existing tests, and in Studio a short playtest with `get_console_output`. Anything not run is unverified.

## 2. Routing details

Open the domain skill's section for each kind of finding instead of reciting rules from memory. Numbers are section ids of that skill's `references/full.md`; words are heading fragments.

- **Trusting the client:** `roblox-security` `#authority` (authority models), `#exploit` (exploit vectors) and `#security audit` (audit checklist). `roblox-networking` `#2` (validate at the boundary) and `#3` (server-owned outcomes).
- **Remote validation and rate limits:** `roblox-networking` `#2`, `#2a` (what survives a remote call), `#4` (throttling), `#5` (RemoteFunction cautions), `#6` (remote semantics).
- **DataStore misuse:** `roblox-data` `#3` (bounded retries), `#4` (session ownership), `#5` (atomic updates), `#7` (save lifecycle), `#9` (safety checklist). Cross-server data: `roblox-server-data`.
- **Purchases:** `roblox-monetization` `#2` (prompt vs grant), `#3` (receipts), `#3a` (receipt failure tests).
- **Leaks and lifecycle:** `roblox-luau-patterns` `#5` (signals and cleanup), `#6` (task scheduling), `#7` (fallible calls), `#9` (review checklist).
- **Language-level bugs and deprecated APIs:** `roblox-luau-core` `#2` (tables), `#4` (iteration and mutation), `#10` (deprecated APIs), `#15` (review checklist).
- **Types:** `roblox-luau-types` `#common mistakes` and `#quality checklist`.
- **Performance:** `roblox-performance` `#common performance` (common issues) and `#what luau` (hot-loop cost model); measure before claiming a cost.
- **Structure:** `roblox-architecture` `#2` (runtime location is a trust decision), `#7` (client/server APIs), `#10` (architecture review).
- **Release readiness:** `roblox-publish-checklist` `#3` (high-consequence gates) and `#9` (final report).

If a section name does not match, ask for the skill's file without `#`; large files come back as an outline.

### Patterns that look fine and are not

- `if player.Character then` as an auth check; use the server's own state.
- `Remote.OnServerEvent:Connect(function(player, amount) data.coins += amount end)`: the amount is the attack.
- A cooldown stored on the client, or checked with a timestamp the client sent.
- `RemoteFunction:InvokeClient` on the server: a client that never answers stalls the thread.
- Validating `typeof(x) == "number"` and stopping there: NaN, infinity, negatives and huge values pass.
- `pcall(function() store:SetAsync(...) end)` with the result ignored: a failure is silent data loss.
- Saving the whole profile after a load that failed and returned a default table: overwrites real data.
- A connection made inside `CharacterAdded` and never disconnected, so handlers stack per respawn.
- `while true do ... task.wait() end` started per player and never stopped on leave.
- `Players.PlayerAdded:Connect` registered after players already joined, so early players are missed.
- `Touched` handlers doing work for every part of every character with no debounce.
- `WaitForChild` with no timeout on something that may never exist, in a server path every player hits.

## 3. Report format

Write the report in this shape. Keep every line short.

```
Review of <target>: <N> findings (Critical a, High b, Medium c, Low d)

Critical
1. server/Shop.server.luau:42 - The purchase price is read from the remote argument, so a client can buy anything for 0.
   Fix: look the price up in the server-owned item table by item id and ignore the argument.

High
...

Verified: <what was actually read, run or tested>
Unverified: <what was not read, not run, or depends on Studio/live behaviour>
Skipped: <scripts or areas not reviewed, with the reason>
```

Severity:

- **Critical:** a player can gain currency, items, admin or other players' data; data can be lost or duplicated; the server can be crashed or stalled by one client.
- **High:** a bug that breaks a main flow for some players, an unthrottled or unvalidated remote with limited impact, or a leak that grows per player or per round.
- **Medium:** wrong under rare timing, a hot path that costs frames on phones, a deprecated API with a working replacement.
- **Low:** style, naming, structure, missing types, small cleanups.

Rules:

- Every finding has a `path:line` (or `path` plus function name if lines are unknown) and a concrete fix, not "consider validating".
- One problem per finding; the same pattern in many places is one finding with the list of locations.
- Order by severity, then by how easy the exploit or failure is to trigger.
- Do not pad. If nothing was found in an area, say what was checked, not that it is fine.
- Say Verified only for what you read in full or ran. Anything inferred from names, a partial read or a guess goes under Unverified.
- The user decides what to fix. Offer to apply the Critical and High fixes; do not rewrite scripts during a review unless asked.
- Before publishing, finish with the `roblox-publish-checklist` verdict (READY, NOT READY or READY WITH ACCEPTED RISK): any Critical finding means NOT READY.
