# Roblox Studio

Harp connects agents to Roblox Studio through its own Studio plugin. Agents can read and build in
your open place, write scripts, playtest, move the camera, take screenshots, use Creator Store assets
and model in Blender, while you watch and control everything from a panel inside Studio.

Turn it on in **Settings → Roblox Studio**.

## Start

1. Choose **Harp** under **Connection**. On Windows, Harp turns this on by itself the
   first time it starts on a machine with Roblox Studio installed.
2. Open your place in Studio. Harp installs its plugin automatically; a Studio that was already
   open loads it the next time a place opens.
3. Ask an agent in a Roblox project for something.

The plugin updates itself in place when Harp updates, so you do not need to reopen Studio after
an update. The status in Settings shows the connected places and whether the plugin is current.

## The Studio panel

Click the **Harp** button at the bottom left of the Studio viewport (or the **Harp** button on the
Plugins tab). The panel has Prompt, Studio, Tools and Activity tabs:

- **Prompt:** send a prompt to a Harp thread without leaving Studio. Pick the thread under **Send
  to**: threads whose agent already worked on this place come first, and **New thread** starts one
  with the same project and model as the latest thread. The agent's status and latest reply show
  under the prompt; the full conversation is in Harp.
- **Attach instances (Prompt tab):** select anything in the Explorer or viewport and click **Attach selection**,
  or turn on **Pick** and click it. Each attached instance goes with the prompt as a file the agent
  reads: its path, class, key properties, attributes and tags, the source of a script, or a summary
  of what a model contains.
- **Studio:** the connection, the place and its playtest peers, and the safety switches: pause the
  agent, make the place read-only, or turn off running Luau.
- **Tools:** every tool the agent can use, with its own switch. Search to find one quickly. A tool
  you switch off is refused, whatever the agent asks.
- **Activity:** each action the agent takes in this Studio, with its result and duration.

These switches are enforced in Studio and in Harp. While one of them holds the agent back (paused,
read-only, Luau off or a tool switched off), the place menu next to the composer says so, so a
refused action is never a mystery.

## Which threads get it

Only threads in a Roblox project get the Studio tools, rules and controls, so other projects pay
nothing for them and Harp never has to ask. A project counts as Roblox when any of these is true:

- The folder or one directly under it has a Rojo `*.project.json`, a place or model file, Roblox
  tooling such as `wally.toml` or `rokit.toml`, or an empty `.harp-roblox` file (`.sealcode-roblox` still works).
- The project has a Roblox game icon, or "Roblox" in its name.
- A place open in Studio has the project's name, or the folder is nearly empty while Studio is
  connected. Harp remembers this, so the project stays a Roblox project after Studio closes.

**No project** threads get them only while a place is open in Studio. Loose files in your home,
Documents, Desktop or Downloads folder don't count. If Harp guessed wrong, change **Roblox game** on
the Project settings page, in either direction. **All projects** in Roblox Studio settings gives the
tools to every thread, except projects set to **Not a Roblox game**.

## What agents can do

- Read the place: the tree, properties, scripts and the user's selection.
- Build and edit: atomic builds that are one undo step, properties, instances, and scripts with
  revision checks and automatic read-back.
- Rename and refactor across scripts: find and replace previews its changes first (nothing is
  written until the agent turns the dry run off) and writes through the same checks as a single
  edit, including Rojo files.
- Scatter props: a build step places trees, rocks or other templates onto the ground inside a zone
  from a seed. Running it again with the same group name replaces the previous result in one undo.
- Hunt memory: scene analysis can list leaked instances, and the scripts, animations, audio and
  triangles using the most memory.
- Playtest: solo and multiplayer tests, code inside the running game, output logs.
- See: move the camera, frame what they built, and take screenshots. **Screenshots appear in the
  chat** under the action that took them while the agent works. When the turn finishes they are
  collected in one **Screenshots** row after the final reply. Click one to open the viewer, then flip
  through them with the arrow keys, the thumbnail strip or a swipe.
- Check UI: inspect and audit screens, click and type in them, and compare phones, tablets and PCs
  with the device simulator.
- Use the Creator Store: search free assets, check their details and thumbnail, and insert them.
  Scripts inside inserted assets arrive disabled until the agent has reviewed them.
- Model in Blender: run Blender jobs headless, with a topology report and a preview render, and
  bring the model into Studio.
- Manage Studio windows: open a place, and close older windows of it so they do not pile up.

Every tool call follows the thread's usual approval rules. Agents load Harp's Roblox skills
(design, building, scripting, networking, data and more) when a task needs them.

## Rojo

In a workspace with Rojo project files, your files are the scripts' source of truth and Harp works
that way too:

- **One place or several.** Harp finds every place project in the workspace (up to three folders
  deep, such as `places/lobby/default.project.json`), names each by its folder, and keeps the ports
  your project file or editor tasks already use.
- **One click per server.** The place menu next to the composer, and the same row in the thread
  details panel, list each project with a switch that starts or stops `rojo serve` for it. **Start
  all** runs every place of a multi-place workspace. A server you started yourself shows as serving
  and is left alone. Connect the Rojo plugin in each Studio window to its port as usual.
- **Edits go to files.** When an agent edits a script that Rojo syncs, Harp writes the file and
  lets Rojo update Studio (or updates Studio too when Rojo is not serving), so the change appears
  in the thread's diff and checkpoints. Scripts that are not in files are still edited in Studio.
- **Sync status.** Every script write says whether Studio is synced with the file, pending or
  diverged. Before a playtest, Harp checks the scripts the agent wrote: it waits briefly for
  pending ones and refuses to start when Studio still differs (the agent can pass `force` to run
  anyway). If you typed unsaved changes into a synced script in Studio, Harp refuses to overwrite
  the file until they are merged or forced.
- **New, renamed and deleted scripts.** In a synced folder, new scripts and folders become files
  (`.server.luau`, `.client.luau`, `.luau`, or an `init` file when a script has children) and
  Rojo creates them in Studio. Renaming or moving a script renames or moves its file. Deleting one
  moves its files to `.harp/rojo-trash/<time>/` in the workspace, so nothing is lost. Other
  instances (parts, UI) stay in Studio only, and the result says so.

Harp looks for `rojo` on your PATH and in the Rokit, Aftman, Foreman and Cargo tool folders.

## Limit what the agent does in a thread

The place menu next to the composer and the same row in the thread details panel show which place
the agent works in, and set two limits for one thread:

- **Playtests:** switch them off and the agent cannot start a solo or
  multiplayer test. Stopping or ending a test that is already running still works, so a stuck test
  can be cleaned up. Running Luau that starts a playtest is refused too, but that check is a guard,
  not a sandbox: to rule it out completely, turn off running Luau in the Studio panel.
- **Places:** untick a place and the agent no longer sees it. It is left out of the
  list of connected places, and a call that names it is refused with a message that says why.
  A place you turn off stays listed, dimmed, when it is not connected, so you can turn it back on.

New threads start with every place on and playtests allowed. Forks and threads the agent delegates
to keep the limits of the thread they came from. The limits belong to the thread: they do not change
the Studio panel's own switches, which stay the outer limit, and they are separate from the
**Automatic playtests** setting, which only tells the agent when it may test on its own. A thread
with any limit does not get Roblox's own Studio MCP, which would bypass them.

## Protect parts of a place

In **Settings → Roblox Studio → Protected paths**, add instance paths per place, such as
`game.ServerStorage.Data` or `game.ReplicatedStorage.Packages`. Agents can still read them, but
their tools refuse to change those instances or anything under them (including moving, renaming or
deleting a parent that holds one), and find and replace skips the scripts there. The agent is told
which paths are protected. A path matches whole instances: `game.Workspace.Map` does not protect
`game.Workspace.Map2`. Remove a path from the same list to lift the protection.

Running Luau cannot be limited that way. When a run changes the structure or scripts of a protected
subtree, the result carries a warning naming it, so the agent tells you and you can undo with
Ctrl+Z. Property changes inside a protected subtree are not detected, and very large subtrees are
only checked in part.

## Checking the agent's work

When a turn changed something in Studio, a badge under its last message says whether the work was
checked: **Studio verified**, or **Studio unverified** with the reasons on hover (scripts changed
but no playtest ran, a script write was not read back, UI changed without a UI audit, tool calls
failed). Turns that only read from Studio show no badge.

**Results** next to the badge (also in the right panel's tab list and the command palette) opens a
tab that collects one turn's evidence: the verdict, the changed files, and every image the agent
made, tagged Studio, Blender, Animation sheet or Other, newest first. Repeated captures of one
view, contact sheets of one animation and versions of one Blender model group into a single tile.
Use the arrows to move between turns that produced images.

Only one thread at a time changes a given place. The first thread to change it holds it until its
turn ends (or ten idle minutes pass); another thread's changes are refused with a message naming
the holder, while reads keep working.

## Undo a turn's changes

Next to the badge, **Undo Studio changes** reverts what that turn did in Studio: script writes,
property changes, builds, removed instances and inserted assets, as one undo step in Studio
(Ctrl+Z steps it back). The dialog lists what will be reverted first, and afterwards what was
skipped because it changed since, such as a property you edited by hand. Rojo-backed scripts are
restored in their files. Luau runs and other calls Harp cannot reverse are named, not undone. The
agent can do the same for its thread's last turn with `undo_turn_changes`, when you ask it to.

Harp keeps the record in memory: after the server restarts, or once a thread has more than twenty
newer turns, the button stays disabled. It is also disabled while Studio is not connected.

## Selection and code approvals

When you select parts or open a script in Studio, a chip above the prompt (for example
"Selected: Door, +2 more") shows what Harp adds to your next message so "this part" means
something. Click its X to leave the selection out of that message. The sent message keeps the
chip.

When approval is needed for code the agent runs or writes in Studio (Luau runs, script edits, the
Blender script), the approval shows the code highlighted, what it will affect, and a warning
when it looks like it contains a key or token. Harp also appends that warning to the tool result
so the agent can take the secret out.

## Blender

Harp finds Blender in its usual install folders and Steam libraries; otherwise set **Blender
executable**. Each Blender job runs a Python script with your permissions, so approve it as you
would any script. Models brought in from Blender live in the current Studio session: publish them as
assets before a saved or published place relies on them. Jobs run without credential-looking
environment variables, and job folders older than a week (beyond the newest 40) are deleted.

A Blender result with a preview shows a **3D** badge in the turn's screenshots. Open it to orbit,
zoom and pan the model (sizes are shown in studs at 0.28 m each; the orange arrow marks Roblox's
front, -Z), play its animations, or switch to the still image. When the agent reworks a model in
several jobs, only the latest version has a tile and **Version 2 of 4** steps through the rest.
The 3D file is kept with the job folder, so older models show the still once it is cleaned up.

Any `.glb` file opens in the same 3D viewer from the Files panel (up to 30 MB). Ask an agent to show
you a model and it opens the GLB in the conversation as a **3D model** card, wherever the file came
from.

**Blender MCP** connects a separate MCP server that drives your open Blender, such as MCP for
Blender.

## Image generation

Off by default. Turn it on in **Settings, Roblox Studio, Image generation** and pick OpenAI,
OpenRouter or any server with an OpenAI-compatible images API (a local one costs nothing); enter its
base URL, model and API key. The key stays on the Harp server and is never sent to the app. A paid
service charges your account, so the section also sets how many images an agent may make per turn
(6 by default) and whether each one needs your approval.

Agents then get **generate_image**. Harp saves the PNGs in a job folder with the prompt and model,
measures them (transparent background, glow touching the edge, tiling seams, brightness, saturation,
crisp or soft) and shows them to the agent: particles on a dark ground, tiles repeated 2x2.

To try an image before uploading it, the agent uses **stage_texture_preview**. It copies a PNG from
a generation or Blender job, or from the thread's workspace, into Studio's content folder and
gets an `rbxasset://harp/...` path for a Decal, Texture, ParticleEmitter or ImageLabel. This only
works when Studio runs on the same computer as the Harp server, and only on that computer. Harp does
not upload: before publishing, upload the image yourself through Asset Manager and use that asset.
A Studio update clears staged previews.

## Roblox's own MCP

**Roblox's own Studio MCP** as the Studio connection uses only the MCP server Roblox Studio ships.

## Publishing assets

Agents never publish on their own. When something needs publishing, such as a model from Blender, an
image or an animation, the agent asks whether to publish it through the Roblox Assistant (it then
shows on your profile as published by the Assistant) or whether you prefer to publish it yourself and
name it your way.

## AI model generation

**Also connect Roblox's own MCP** (on by default) gives agents the Roblox Assistant's tools that Harp
has no equivalent for: AI model, mesh, texture and material generation, avatar setup and publishing.
Its tools for reading, editing, running code, playtests and screenshots are left out while Harp's
own are connected, so agents see one tool for each job. Turn the switch off and nothing of Roblox's
is loaded; choose **Roblox's own Studio MCP** as the connection and all of its tools are. Agents prefer Blender jobs and good Creator
Store assets, and use AI generation when you ask for it or nothing better fits.
