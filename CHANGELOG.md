# What's new in SealCode

<!--
SealCode shows this file in its What's New screen, and the release workflow publishes
each version's section as that release's notes. Newest version first:

## <version> · <YYYY-MM-DD>
> One-sentence headline
### New | Improved | Fixed
- **Title** — description   (under New, titled items show as cards)
-->

## 2.21.0 · 2026-11-20

> Harp's guidance no longer rides inside your messages, and agents treat an established game like one.

### Improved

- **Your messages stay yours** — With Claude, Codex and OpenCode, your rules and Harp's Studio instructions now reach the agent on their own, instead of being pasted above what you type, and they survive when a long conversation is compacted. Antigravity, Cursor and Grok still get them in the message for now.
- **Live games first** — In a Roblox thread the agent first checks whether the game is established or new. In an established game it follows the game's own systems, keeps old saves loading and never adds a second data layer. DataService (typed) is now the default only for a new game.
- **Shorter Studio instructions** — The Studio guidance every conversation starts with is less than half its old size, and the agent decides which Roblox skills a request actually needs.

## 2.20.4 · 2026-11-16

> Antigravity no longer drops every other message when its model is slow to answer.

### Fixed

- **Antigravity slow starts** — A turn that takes more than 30 seconds to start answering is no longer stopped and restarted. Harp now shows a note that Antigravity is still waiting on its model and keeps the turn running. It restarts Antigravity only after 3 minutes with no sign of life.

## 2.20.3 · 2026-11-16

> Antigravity's model list is short again: one entry per model, with its level on the reasoning slider.

### Fixed

- **Antigravity models** — Levels such as Low, Medium, High and Extra no longer show up as separate models. Each model has one entry, and the reasoning slider picks the level. Models that come only as a standard and an Extra version get a Standard and Extra High setting.

## 2.20.2 · 2026-11-15

> Antigravity works again, and Blender viewport screenshots show up in the chat.

### Fixed

- **Antigravity** — Turns no longer stop with "INVALID_ARGUMENT … enum cannot be empty" before the agent starts.
- **Blender viewport app** — The viewport screenshot from the Blender MCP app shows in the chat instead of a broken image, and isn't shown twice.

## 2.20.1 · 2026-11-15

> Open any GLB model in the 3D viewer, from the Files panel or by asking the agent.

### New

- **Open any 3D model** — A `.glb` file opens in the 3D viewer from the Files panel, and agents can show any GLB in the chat with `show_model` instead of making a web page for it.

### Improved

- **Models without a preview image** — A 3D model with no rendered image now shows as a 3D card in the chat and the Results tab, and opens straight into the viewer.

## 2.20.0 · 2026-11-14

> Harp catches up with two weeks of T3 Code: Harp in your language, Claude Fable 5.2, replies to a single response, and a faster, steadier app.

### New

- **Harp in your language** — Pick the app language in Settings → General, including Português (Brasil), Español, Deutsch, Français, 日本語, 한국어, Русский and 中文.
- **Claude Fable 5.2** — The new model is in the picker, and the picker checks for new models each time it opens.
- **Ultracode at any effort** — Turn on Ultracode at any reasoning effort, and on Claude Sonnet 5.5 and Haiku 5.5 too.
- **Reply to a response** — Hover an assistant message and reply to it; the reply quotes it so the agent knows what you mean. Quotes in sent messages show as an inset card.
- **Mention a model** — Type @ and a model name to tell the agent which model to use for a task.
- **Fresh session in the same thread** — `/clear` starts a new provider session without leaving the thread, and scheduled tasks can run each time with a fresh session.
- **Pull request comments in the chat** — Add a PR's review comments to your message, and PR composers complete @people and #123 references.
- **Add projects by dropping folders** — Drop a folder on the sidebar to add it as a project.
- **Delete archived threads** — Remove threads for good from the archive.
- **Keep the computer awake** — Harp keeps your computer from sleeping while agents work.
- **Chat without tool calls** — A setting hides tool calls so a thread reads like a conversation.
- **Welcome page** — First run is now a single Welcome page instead of a three-step wizard.

### Improved

- **Send while attachments upload** — You no longer wait for images and files to finish uploading before sending.
- **Faster and lighter** — Many upstream speedups in the server, database and thread loading, plus a button in Settings that reclaims freed database space.
- **Screen readers** — Agent messages and steps are announced during a turn, and the window title leads with the thread's status.
- **Windows background service** — The Harp service now runs on Windows, so a Windows host can update remotely.

### Fixed

- **Ctrl+W** — Ctrl+W closes the current tab and never closes the window, so pressing it once too often no longer quits Harp.
- **Hundreds of upstream fixes** — Agent sessions, queued messages, scheduled tasks, pull requests, previews and providers.

## 2.19.0 · 2026-11-14

> See Blender models in 3D right in the chat, undo a whole turn in Studio, and let agents check their own work before they say they're done.

### New

- **3D model viewer** — Models an agent makes in Blender open in 3D from their preview: orbit, zoom and pan, a marker for the front Roblox will use, size in studs and triangle count. Animated models play with a clip picker and a timeline you can scrub, and each new version of a model steps through with Version 2 of 4.
- **Turn results** — A Results tab in the right panel gathers what a turn produced: Studio captures, Blender models, animation sheets, changed files and the Studio check, with filters. Open it from the turn, the panel menu or the command palette.
- **Undo a turn in Studio** — A finished turn that changed your place can be undone in one step. Harp shows what it will restore first: scripts, properties, created and deleted instances, build and scatter output. Anything you changed since is left alone, and raw Luau runs are listed as not undoable. Agents can do the same with `undo_turn_changes`.
- **Did the agent check its work?** — Turns that changed your place show "Studio verified" or "Studio unverified", with what was missing, such as scripts changed without a playtest or UI changed without a UI check.
- **Protected paths** — In Settings → Roblox Studio, list paths that agents must not touch in each place, such as your data folder. Tools refuse to change them, and a Luau run that touched one is flagged.
- **Image generation** — Turn it on in Settings → Roblox Studio with any OpenAI-compatible image service, including OpenRouter or one running on your own computer. Agents make particle sprites, icons, decals, tiles and UI art, and Harp measures each one: transparency, bleeding edges, tiling seams and sharpness. Off by default, with a limit per turn.
- **Texture preview in Studio** — Agents can show a generated or Blender-made image inside your place before you upload it.
- **Find and replace in scripts** — Agents can change text across many scripts at once, with a preview first, and Rojo-synced scripts are saved to their files.
- **Scatter** — Agents can scatter trees, rocks or props over terrain or a zone by rules: density, slope, spacing, scale and rotation ranges, and areas to avoid. Running it again replaces the last result.
- **Animation checks and contact sheets** — New animations are checked for joints bent past their range, snapping, loops that don't close and drifting roots. Agents can also see a whole animation as one sheet of poses.
- **Code review skill** — A Roblox code review playbook that sends the agent to the right security, networking, data and performance checks and reports findings by severity.

### Improved

- **Blender modeling** — Agents get ready-made helpers for parts between two points, colours that survive export, joining and applying scale. Each model is checked for broken vertices, floating or overlapping parts, hidden objects, sides that don't mirror and which colours will survive import.
- **Rojo** — New, renamed, moved and deleted scripts and folders are saved to your project files, with deleted files kept in `.harp/rojo-trash`. Script edits report whether Rojo has synced them, and playtests wait for Rojo instead of testing old code.
- **Selection in the composer** — When something is selected in Studio, a chip shows that it will be sent. Dismiss it to leave the selection out of that message.
- **Clearer approvals** — Approving a Luau run, a script write or a Blender script shows the code highlighted, what it will change and where, and a warning when it looks like it holds a key or password.
- **Usage warning** — While an agent works, Harp tells you once when a usage limit passes 80% and when it resets.
- **One agent per place** — Only one thread at a time can change a place, so two agents can't overwrite each other's work. Others can still read it.
- **Scene analysis** — Agents can find instances that leak and see memory used by scripts, animations and audio.
- **Long tool results** — Results too long for the agent now drop whole items, keeping the newest log lines, instead of cutting off mid-way.

### Fixed

- **Safer Blender jobs** — Blender no longer inherits keys and tokens from Harp's environment, a stuck job is fully stopped, oversized scripts are refused and old job folders are cleaned up.

## 2.18.1 · 2026-11-09

> Harp opens faster: its window is on screen in about half a second.

### Improved

- **Faster launch** — The window now loads while Harp's server starts instead of after it, showing the Harp logo until everything is ready. In our measurements the window appeared after 0.5 seconds instead of about 2, and the thread list about half a second sooner.
- **Faster command lookups on Windows** — Finding an agent's program on your PATH took up to a third of a second each time. It now takes a few hundredths.
- **Settings open sooner** — The Settings screen is loaded in the background after launch, not on the first click.
- **Roblox Studio status** — The place menu and the Roblox Studio settings page no longer wait for Blender to answer before showing.
- **Quieter start** — The check of your PowerShell profile no longer competes with the launch.

## 2.18.0 · 2026-11-09

> Rojo is built in: Harp finds your places, starts their Rojo servers in one click, and saves script edits to your files.

### New

- **Rojo servers in one click** — Harp finds the Rojo projects in a workspace, whether it holds one place or several, and lists each one in the place menu next to the composer. A switch starts or stops `rojo serve` for it, and Start all runs every place of a multi-place workspace. Ports come from the project file or your editor tasks, and a server you started yourself is left alone.
- **Script edits go to your files** — In a Rojo workspace, an agent's edit to a synced script is written to the file and Rojo updates Studio, so the change shows up in diffs and checkpoints. Agents are told which project belongs to which place and whether its server is running.
- **Roblox Studio in setup** — The welcome wizard and the empty home screen now say whether Studio is connected, and let you start working in the open place right away.

### Improved

- **One tool for each job** — With Roblox's own MCP connected beside Harp's, its tools that repeat Harp's (reading, editing, running code, playtests, screenshots) are left out. Generation, avatar setup and publishing stay. Turn Roblox's MCP off and nothing changes for Harp's tools.
- **Skills that trigger on symptoms** — The skill list agents see now includes each skill's "use this when" phrases, such as lost data or UI cut off on a phone.
- **Large skill files load by section** — The four biggest playbooks answer with their section list, and agents load only the sections a task needs.
- **Roblox docs lookup** — A name typed in the wrong case is corrected, an unknown name answers with the closest matches or the classes that have that member, and pages are kept on disk so lookups work offline.
- **Studio limits are visible** — When the Studio panel has the agent paused, read-only, with Luau off or a tool switched off, the place menu says so.
- **Smaller tool results** — Studio tool results use fewer tokens.
- **Faster script search in big places** — Searching scripts and running Luau no longer walk the whole place each time.

### Fixed

- **Skills after a compaction** — After a context compaction, or in a subagent, loading a skill again answered "already loaded" and gave no text. Skills now reload, and the Studio instructions are sent again after a compaction.
- **Skill link** — The server data skill pointed to a file that lives in another skill.
- **Settings path in the docs** — The guides now point to Settings → Roblox Studio.

## 2.17.22 · 2026-11-09

> Harp now tells you when it couldn't check for updates, and tries again on its own.

### Fixed

- **Update checks that fail** — When GitHub didn't answer, Harp looked as if there was simply no update. It now warns you in the sidebar button and in Settings, and retries up to three times, five minutes apart, instead of waiting four hours for the next check.

## 2.17.21 · 2026-11-09

> Group threads into folders inside a project, and drag threads around without the sidebar falling apart.

### New

- **Thread folders** — Drag a thread onto another thread of the same project to make a folder, then type its name. Drag threads onto a folder to file them, collapse it to tuck them away, and right-click it to rename or ungroup. Ungrouping returns the threads to the project and never deletes them. Move to folder is also in a thread's menu. Folders show on every connected client, and agents can file threads too.

### Fixed

- **Dragging threads** — Reordering threads in a project-grouped sidebar no longer scrambles the list, with rows overlapping project headers and threads landing under the wrong project.

## 2.17.20 · 2026-11-05

> Harp now tells Roblox games from everything else, so other projects stop carrying Studio's tools and rules.

### New

- **Roblox game detection** — Harp works out on its own whether a project is a Roblox game, from its files, game icon, name and the places open in Studio. Other projects skip the Studio tools and rules, and there is nothing to answer.
- **Roblox game setting** — A wrong guess can be fixed on the Project settings page, in either direction.
- **Place menu** — The thread panel and the composer now show which place the agent works in, with the same menu for places and playtests.

### Improved

- **No project chats** — They get the Studio tools only while a place is open in Studio.

### Fixed

- **Studio limits on a thread** — Turning off playtests or a place for a thread now reaches the agent's tools.
- **Integrations and Storage settings** — Both tabs show their settings again instead of an empty page.

## 2.17.19 · 2026-11-03

> Harp catches up with more than 1,300 changes from T3 Code: a faster app, security fixes and a long list of bug fixes.

### Improved

- **Faster sidebar and startup** — The sidebar loads about three times faster, and thread counts at startup come back much sooner.
- **Lighter background work** — An idle Harp runs far fewer background queries, and busy threads stop re-reading subagents that already finished.
- **Smaller thread updates** — Large checkpoints reach the app up to 75 times smaller, and streaming replies no longer redraw the composer, sidebar rows or the git panel.
- **Luau in diffs** — Lua and Luau files get syntax highlighting in diffs.
- **Electron 44.10.0** — The desktop app moves to Electron 44.10.0, which carries a Node.js security fix.
- **Claude default model** — New Claude threads start on Opus 5.5.

### Fixed

- **Stop always stops** — Stop now always ends the turn, and an agent that ignores it can be force-stopped.
- **Questions after a restart** — Questions an agent asked stay answerable after Harp restarts.
- **Claude tools on resume** — A resumed Claude turn retries when its Harp tools fail to register.
- **Codex capacity errors** — Codex retries when the service reports it has no capacity.
- **Large previews** — Very large preview events no longer take down the app.
- **Slow first start** — Harp waits up to three minutes for a large database to open before it shows the recovery screen.
- **Security** — Agents can no longer read Harp's own secrets or databases through file tools, connection tickets stay out of traces, the preview browser is updated, and Antigravity can no longer write outside the workspace.

## 2.17.18 · 2026-11-02

> A new Harp panel inside Roblox Studio: send prompts to your agent and attach any instance, without leaving Studio.

### New

- **Harp panel in Studio** — A Harp button now sits at the bottom left of the Studio viewport. It opens a redesigned panel with Prompt, Studio, Tools and Activity tabs, replacing the old plugin window.
- **Prompt from Studio** — Type a prompt in the panel and send it to a Harp thread. Threads that already worked on this place come first, or start a new one. The agent's status and latest reply show right under the prompt.
- **Attach instances** — Select anything in the Explorer or the viewport and attach it to your prompt, like a screenshot. The agent gets its path, class, key properties, attributes and tags, a script's source, or a summary of what a model contains.

### Improved

- **3D modeling skill** — For props and creatures made in Blender, alone or as a set from one reference, agents now measure the reference, build a style kit, plan the set for variety, and review every model side by side at the same scale.

### Fixed

- **Claude account status** — The Claude provider no longer gets stuck on "Claude Agent CLI failed while checking account status". Usage limits show again, and the model can be changed.

## 2.17.17 · 2026-10-31

> A cleaner model picker with five reasoning slider styles, project icons from your Roblox games, and a seal on the new-chat screen.

### New

- **Reasoning slider styles** — The reasoning slider in the model picker now comes in Liquid, Comet, Aurora, Ripple and Classic. Liquid is the default. Each style plays a short effect when you change the level and stays still otherwise. Pick one in Settings → Appearance → Interface → Reasoning slider, which has a live preview.
- **Project icons from Roblox games** — Right-click a project in the sidebar and choose Change icon… to pick one of the game icons, or paste a Roblox game link to use that game's icon. Harp keeps the icon, so it only fetches it once.
- **Seal on the new-chat screen** — A small voxel seal on an ice floe sits above the new-chat headline, tinted by your theme's colours.

### Improved

- **Model picker** — Cleaner rows with fewer lines, depth from shadows instead of borders, and a filled search box. The reasoning and Ultracode card stays pinned to the bottom of the picker over the model list, which scrolls behind it.
- **Usage ring** — The composer's usage meter is a ring again instead of a timer.
- **Sidebar and thread details** — New thread and Search no longer have an outline, and the thread details card uses the glass look when glass is on.

## 2.17.16 · 2026-10-31

> Harp gets one consistent look everywhere, a screenshot gallery after each turn, per-thread Studio controls, and Ultracode with any effort.

### New

- **Screenshot gallery** — When an agent finishes, every screenshot it took during that turn (Roblox Studio, browser, computer use) is collected in one row after its final reply. Open it to flip through them with the arrows, a swipe or the thumbnail strip.
- **Studio controls per thread** — The new Agent menu next to the composer, and Studio places in the thread details, let you stop an agent from running playtests or deselect a connected place so the agent ignores it, for that thread only. Harp enforces both on the server, and Roblox's own MCP is hidden while a thread has restrictions.
- **Ultracode with any effort** — Ultracode is now its own switch in the model picker, so you can pair it with any reasoning effort, as in Claude Code. A saved Ultracode choice becomes Extra high with Ultracode on.

### Improved

- **One look everywhere** — The old and new designs are merged into one. The sidebar, the Working and Worked for rows, the composer and the new-thread screen, the model picker, Settings, dialogs, menus, toasts and side panels now share the same colours, corners, glass and controls. The Beta page and its "New design" switch are gone.
- **Roblox VFX skill** — Agents building visual effects now prototype several variants side by side for you to pick from, measure animations before timing effects, and follow tested recipes for trails, tracers, projectiles and textures.

## 2.17.15 · 2026-10-28

> See your words while you dictate, take Claude's guess at your next prompt with Tab, and give the sidebar header art a style and color of your own.

### New

- **Live transcription preview** — While a voice note records, the words you say appear dimmed in the composer, like in Claude Code. A Whisper model runs on your GPU inside Harp; it downloads once (about 600 MB) and then loads from disk. The final text still comes from your transcription server, and if that fails, Harp keeps the preview text instead of losing what you said. Turn it off in Settings → General.
- **Next prompt suggestions** — When a Claude turn ends, Claude's guess at your next message appears dimmed in the empty composer. Press Tab to use it, or just type. It runs inside Claude's own session, so it costs almost nothing. Settings → General can turn it off, or turn it on for other providers through your text generation model, which uses extra quota.
- **Header art styles and color** — The sidebar header art now comes in Blueprint, Night sky, Waves, Ice floe, Dots, Pixels and Aurora, and follows your theme or a color you pick. Settings → Appearance → Interface.

### Fixed

- **Antigravity terminal window** — On Windows, Antigravity no longer opens a terminal window, and closing such a window no longer ends its turn with an error. Its tools now run hidden in the background.

## 2.17.14 · 2026-10-28

> SealCode is now Harp, with a new icon and a seal mascot, and Claude Code no longer burns through its 5-hour limit faster in Harp.

### New

- **Harp** — SealCode is now called Harp, after the harp seal. The app, its icon, the installer and the Roblox Studio plugin all say Harp. Your projects, threads and settings stay exactly where they were, and updates keep working.
- **A mascot** — Harp the seal rests above the new-thread prompt, types on a tiny laptop while an agent works, balances its ball while a worktree is set up, and naps when there is nothing to show.
- **Sidebar header art** — The colored grid from the web version now sits behind the sidebar header, tinted by your theme. Turn it off in Settings → Appearance → Interface.

### Fixed

- **Claude Code usage drained faster** — Claude Code counted Harp's sessions as SDK traffic, which uses up the 5-hour limit roughly 1.8 times faster than the CLI. Harp now identifies its own Claude sessions, so the same work costs the usual share of your limit.

## 2.17.13 · 2026-10-27

> SealCode opens faster, uses about a quarter less memory, and changes themes without freezing.

### Improved

- **Lighter while opening** — SealCode no longer starts a full Claude Code session, the CommandCode CLI or MCP servers such as Blender's while it opens. Status comes from quick checks and saved results, and an MCP server starts on its first tool call. In our tests, memory right after opening went from about 980 MB to 730 MB, and idle memory from about 880 MB to 600 MB.
- **The window shows sooner** — The window is prepared while the server starts, the Windows PATH lookup is remembered between launches, and the first screen loads 11% less code.
- **Smooth theme changes** — Changing the theme or applying a preset happens in one step: colors apply at once, only what depends on light or dark repaints, and the backdrop image is not processed again.
- **Threads open faster** — Messages are parsed once and reused, very large code blocks appear right away and get their colors afterwards, and the server no longer reads command output and diffs the thread view doesn't show.
- **Quieter in the background** — Updates are checked every 4 hours instead of every 4 minutes, and the app no longer polls itself every few seconds.
- **SealCode everywhere** — The app, its messages and its docs now say SealCode, with credit to T3 Code's creators in Settings → About. Command hints use SealCode's own `t3` command instead of `npx t3`, which installed T3 Code.

## 2.17.12 · 2026-10-27

> SealCode drops the parts of T3 Code that have nothing to do with making games, and no longer sends usage data to T3.

### Improved

- **No usage data sent to T3** — SealCode inherited anonymous usage reporting to T3's analytics service, on by default. It is gone.
- **Leaner app** — Removed T3 Cloud sign-in and its relay, guest sharing, the phone and emulator device hub, webhook triggers for scheduled tasks, and the Azure DevOps, Bitbucket, Forgejo, GitCafe and GitLab integrations. Scheduled tasks, GitHub, and remote access over SSH, Tailscale and WSL stay. Settings and threads that mention removed features still open; a scheduled task that ran from a webhook is paused, and you can switch it to a schedule.

## 2.17.11 · 2026-10-27

> Antigravity starts on Windows PCs where it used to get stuck, and starts faster everywhere.

### Fixed

- **Antigravity stuck on "starting"** — Google's Antigravity program unpacked about 7,400 files into the temporary folder every time it started, and on some Windows PCs that never finished. SealCode now unpacks it once, in the background, and it starts in about 3 seconds without touching the temporary folder.

## 2.17.10 · 2026-10-27

> Antigravity starts on slow machines and tells you exactly why it cannot connect.

### New

- **Antigravity diagnostics** — A Diagnostics button next to the Antigravity account (and `t3 antigravity diagnose`) builds a report you can copy and send: versions, proxy and VPN, DNS, HTTPS over IPv4 and IPv6, the clock, and a real sign-in test. Tokens, emails and your user folder are left out.

### Fixed

- **Slow first start** — On slower laptops, where Antigravity can take a while to unpack, SealCode no longer restarts it halfway through. It shows that it is still starting, often because of antivirus scanning.
- **Security software and filtered networks** — On Windows, Antigravity trusts the same certificates Windows does, so networks or software that inspect HTTPS no longer block it.
- **Clear sign-in errors** — When sign-in cannot connect, the message names the cause: inspected HTTPS, a wrong clock, DNS, or an unreachable proxy.

## 2.17.9 · 2026-10-27

> Antigravity works on networks with broken IPv6.

### Fixed

- **Antigravity on broken IPv6** — Antigravity now always connects through SealCode, which tries IPv4 first and falls back to IPv6 only when IPv4 fails. Sign-in, sign-out and turns no longer hang on networks where IPv6 half-works. If the agent still goes quiet, SealCode restarts it once on its own before showing an error. A proxy you set yourself is still used.

## 2.17.8 · 2026-10-26

> Much faster: threads open with far less data, and streaming and connecting do less work.

### Improved

- **Faster threads** — Opening a thread loads about 85% less data, and live updates send each message once instead of repeating it.
- **Faster connect** — Connecting skips idle subagent threads and older settled threads, so the first load is much smaller.
- **Lighter streaming** — Replaced streaming text is merged before it is sent, and code highlighting is lighter.
- **Big files and PRs** — Large file previews scroll smoothly, and pull request timelines, code tabs and diffs load faster.
- **Less background work** — Hidden preview tabs slow down instead of running at full speed, and unchanged settings are no longer rewritten.
- **Settings and Usage in a window** — Settings and Usage open in a window over your work, with SealCode's look and panels.

## 2.17.7 · 2026-10-26

> Gemini 4 Argon in Antigravity, every usage limit, and an app that no longer freezes on its database.

### New

- **Gemini 4 Argon** — Antigravity now runs the newer agent, so Gemini 4 Argon is in the model picker.
- **All Antigravity limits** — Usage shows the Gemini and Gemini 4 Argon limits next to the shared Claude & GPT ones.
- **PDF attachments** — PDFs you attach go to Claude and Antigravity as documents.

### Improved

- **Antigravity on tricky networks** — When Antigravity cannot reach Google over IPv6, it switches to IPv4 by itself. If a sign-in or turn still stalls, SealCode says so instead of thinking forever.
- **New threads remember your setup** — A new thread starts with the model and modes you last used in that project.
- **Ctrl+W on Windows** — Closing the last window with Ctrl+W asks before quitting.

### Fixed

- **Freezes** — The app no longer freezes when a slow database read blocks every write, old turn snapshots are compacted, and screenshots saved before 2.17.6 move out of the database.
- **Chat jumping to the bottom** — Scrolling up during a turn keeps your place.
- **Large reasoning blocks** — Opening a thread with long reasoning no longer freezes the window.
- **CommandCode reasoning** — The reasoning slider runs from off up to max, and models no longer default to off.
- **Antigravity usage** — Each call is counted once, and untouched limits no longer show a moving reset countdown.

## 2.17.6 · 2026-10-23

> Antigravity cleans up after itself, and long sessions stay responsive.

### New

- **Building and lighting playbooks** — Roblox agents build scenes and set the lighting from guides researched live in Studio: human scale, kits from the Creator Store, terrain, and eight measured lighting presets with a day-night cycle.

### Fixed

- **Leftover Antigravity processes** — On Windows, Antigravity runtimes left behind when SealCode closed or crashed kept running and used memory. SealCode now stops them when it starts.
- **Freezes in long sessions** — Screenshots from Roblox Studio tools are saved as files instead of inside SealCode's database, so long sessions no longer stall on disk writes.
- **Floating panels while streaming** — With floating panels on, the window no longer re-measures itself on every streamed word.

## 2.17.5 · 2026-10-22

> Caught up with 700 upstream T3 Code changes, a theme brightness slider and tidier settings.

### New

- **Theme brightness** — When you create or edit a theme, a brightness slider makes the whole theme darker or lighter without changing each colour. Back in the middle, the theme is exactly as before.

### Improved

- **Up to date with T3 Code** — About 700 upstream changes: faster performance, provider and model compatibility, server and web fixes. Everything SealCode adds stays as it was.
- **Settings descriptions** — Section descriptions such as Roblox Studio, Computer Use and Global MCP Servers now sit under the section title as a quieter subtitle, instead of as a row of plain text.

## 2.17.4 · 2026-10-22

> A bolder effort slider and a composer that stays tidy at any size.

### Improved

- **Effort slider** — The effort slider is thicker and easier to grab. Its fill warms up from blue to purple to amber as effort rises, and the active level glows softly. Reduced motion turns the transitions off.
- **Claude effort levels** — Claude's effort levels now end at Ultracode. Ultrathink is no longer an effort level: type "ultrathink" in your message when you want it. Threads saved with Ultrathink open at Max.

### Fixed

- **Usage meter overlap** — In a small window, or when the composer collapses, the usage meter no longer covers the other composer controls.

## 2.17.3 · 2026-10-21

> Scrollbars sized the way you like, with room to breathe.

### Improved

- **Scrollbar size slider** — Set the scrollbar width anywhere from 6 to 20 px in Settings → Appearance. Your earlier Thin, Medium or Thick choice carries over.
- **Easier-to-use scrollbars** — The thumb is a rounded pill set in from the window edge, with arrows at both ends.

### Fixed

- **Scrollbars covering content** — Wide scrollbars no longer sit on top of items along the right edge.

## 2.17.2 · 2026-10-21

> Scrollbars you can actually grab on a touchpad.

### Improved

- **Wider scrollbars** — Scrollbars are wider by default and easier to drag on a touchpad. Pick Thin, Medium or Thick in Settings → Appearance; presets save your choice.

### Fixed

- **Computer use in English** — The computer use settings and messages, and a hint in the image viewer, were in Portuguese. They are in English now, like the rest of the app.

## 2.17.1 · 2026-10-20

> See a look before you apply it, and switch looks without a blank background.

### Improved

- **Preset previews** — Each appearance preset shows a small preview of the app with its colours, background image and effects.
- **Instant look switching** — Switching presets keeps the current background until the new image is ready, so the app never goes blank.

### Fixed

- **Corners in fullscreen** — On Windows, maximized and fullscreen windows have square corners, so the desktop no longer shows through.
- **Floating panels on Windows** — No more grey outline around the window or slivers at the panel corners.

## 2.17.0 · 2026-10-20

> A complete UI library of SealCode's own, so agents build shops, wheels and menus that look finished.

### New

- **20 screen layouts** — Shops, inventories, select screens, quests, daily rewards, leaderboards, notifications, dialogs, landing and loading screens, HUDs, side menus, admin panels and settings, each with sizes for PC and phones.
- **Three complete themes** — Cartoon card, classic studs and modern studs, each with its own panels, buttons, cards, tabs and bars.
- **Prize wheel and crate reel** — Ready-made templates for a spinning prize wheel and a vertical case roll, with the result decided by the server.

### Improved

- **Polish and review** — Agents add motion, sounds, shop states (tiers, tags, owned, discounts) and check every screen against its layout before finishing.

> Every Studio tool agents were missing, a UI library built from real references, and agents that ask before they style or publish.

### New

- **Animation tools** — Agents inspect, create, play and stop animations on rigs. They use Roblox's own animations from the toolbox when they fit, and animate by code when nothing fits.
- **Performance and debugging** — Script profiler in playtests, memory by category, a scene analysis of what makes a place heavy, network lag simulation, and logpoints that print values without pausing the game.
- **Import and export models** — Agents save instances to .rbxm files and load .rbxm/.rbxmx files into the place.
- **Roblox docs lookup** — Agents read the official API reference for any class, enum or datatype instead of guessing.
- **AI model generation** — Roblox's own Assistant tools are connected by default, so agents can generate models, meshes and textures with Roblox's AI when you want them.
- **UI library** — 18 UI archetypes (AAA sleek, simulator cartoon, brainrot clickbait, studded, monochrome, fantasy, sci-fi, 3D UI and more), icon matching from the toolbox, and WindUI for sleek windowed interfaces.
- **VFX and animation playbooks** — Learned from real toolbox packs: how good effects are layered and timed, how to adapt packs, and how to build effects from scratch.
- **DataService (typed)** — Agents use Leif's DataService for player data unless you ask otherwise, with its documentation at hand.

### Improved

- **Agents ask about UI style** — With no UI in the game, agents ask which style you want; with existing UI, they ask whether to match it or start fresh, and remember your answer in the place.
- **Publishing** — Agents never upload on their own: they ask whether to publish through the Roblox Assistant or let you publish and name the assets yourself. Open Cloud key uploads are gone.
- **Cleaner game code** — Agents trust what they verified instead of filling scripts with defensive checks, and use WaitForChild only where Roblox really delivers things late.
- **Whole screens in one step** — Builds can refer to children of things made in the same step, so a full UI is one undo.

## 2.15.0 · 2026-10-20

> SealCode now has its own Roblox Studio plugin: agents see their work, use the Creator Store and Blender, and you control every tool from Studio.

### New

- **SealCode's own Studio plugin** — A new plugin and connector built for agents replace the old third-party harness. Choose **SealCode** in Settings → Connections → Roblox Studio; the plugin installs itself, and settings from before switch over automatically.
- **Screenshots in the chat** — When an agent takes a screenshot of Studio, it appears right in the conversation, so you see what the agent sees without opening anything.
- **Camera control** — Agents move Studio's camera and frame what they built from any angle (overview, front, top, eye level) before taking a screenshot, and check their work from more than one side.
- **Studio panel** — A panel in Studio's own look shows the connection and every action the agent takes. Pause the agent, make the place read-only, turn off running Luau, or switch off any single tool, with a search box to find it.
- **Updates without reopening Studio** — The plugin updates itself in place when SealCode updates. When an agent does need to reopen a place, it closes the older window first instead of piling up Studio windows.
- **Creator Store assets** — Agents search free assets, check their details and thumbnails, and insert them. Scripts inside arrive disabled until the agent has read them, and assets load even in places that are not published.
- **Blender to Studio** — Agents model in Blender headless, get a topology report and a four-view preview in the model's colours for every job, and bring the model straight into Studio, no upload needed.
- **Publish to Roblox** — With an Open Cloud key in settings, agents publish Blender models, images and sounds as Roblox assets and insert them, so they stay with the place.
- **UI design skill** — A new skill teaches agents to build screens that look designed: cartoon, simulator, modern, sci-fi and fantasy styles, buttons with depth and readable text, layouts, motion, and a visual review on phones, tablets and PCs.

### Improved

- **More forgiving tools** — Studio tools accept the argument spellings agents commonly use, the device simulator skips settings a device does not support instead of failing, and closed Studio windows disappear from the connection list right away.
- **Agent instructions** — Agents follow a clear work loop: read, load the right skills, build in steps, look at the result, fix, and finish with a final screenshot.

## 2.14.0 · 2026-10-20

> See what changed after every update.

### New

- **What's new** — After an update, SealCode shows what changed since the version you last used. Open it again any time from Settings → General or the command palette.

### Fixed

- **App version in Settings** — Settings → General shows the installed SealCode version instead of 0.1.0.

## 2.13.0 · 2026-10-19

> Roblox agents build cleaner meshes and interfaces that fit every screen.

### Improved

- **Clean Blender topology** — When an agent models in Blender, SealCode now checks the mesh for ngons, loose geometry, flipped normals and other topology problems before exporting to Roblox, and follows clean-topology rules while modeling.
- **Roblox UI that fits every device** — The roblox-gui skill now sizes interfaces with Scale and constraints, keeps text from being cut off or overflowing, keeps touch targets large enough, and checks each screen on phones, tablets, laptops, desktops and TV before calling it done.

## 2.12.0 · 2026-10-19

> Claude threads can use your Windows desktop.

### New

- **Computer use** — Claude threads on the Windows desktop app can take screenshots, move the mouse, click and type to work in other apps, after you allow it.

### Fixed

- **Typing with computer use** — Text typed through computer use now arrives one character at a time, so apps such as Paint no longer drop letters.

## 2.11.0 · 2026-10-19

> Dozens of fixes from upstream T3 Code.

### Fixed

- **Provider settings at startup** — Provider settings saved while the app was still starting are no longer lost.
- **Thread switching** — Switching threads shows only the selected thread's messages.
- **Mermaid while streaming** — Finished Mermaid diagrams render while the reply is still streaming.
- **Settings search** — Search now reaches settings inside collapsed sections.
- **And more** — Around forty other fixes for providers, worktrees, pull requests, SSH hosts and the chat view.

## 2.10.0 · 2026-10-19

> Save your whole look and switch between looks in one click.

### New

- **Appearance presets** — Settings → Appearance → Presets saves the theme, glass, background image and its effects, corners, fonts and motion as a named look. Click a preset to switch to it.

## 2.9.0 · 2026-10-18

> See where your context and usage are going.

### New

- **Thread environment panel** — The thread panel shows the session, the context window and the MCP servers in use.
- **Usage ring** — The composer shows how much of the selected model's usage you have left.

## 2.8.1 · 2026-10-18

> Antigravity installs reliably.

### Fixed

- **Antigravity install** — Installing Antigravity no longer launches its runtime first, and a slow first start no longer makes the install fail.

## 2.8.0 · 2026-10-18

> SealCode now updates itself.

### New

- **Automatic updates** — SealCode checks GitHub for new versions and offers to install them from the update button.
