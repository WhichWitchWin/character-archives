# Character Archives · character-archives

English | [简体中文](README.md)

[![Package plugin](https://github.com/WhichWitchWin/character-archives/actions/workflows/package-plugin.yml/badge.svg)](https://github.com/WhichWitchWin/character-archives/actions/workflows/package-plugin.yml)
[![Release](https://img.shields.io/github/v/release/WhichWitchWin/character-archives?style=flat-square)](https://github.com/WhichWitchWin/character-archives/releases)

> A third-party plugin for DSH Tavern. It gives NPCs a **memory of what they know**, and hands the relevant parts to the model when your story is being written.

---

## What this is

Long-form roleplay has a built-in problem: **the model only sees the last stretch of conversation.**

So you get things like this—

- The innkeeper who watched you commit murder three chapters ago greets you like a stranger
- You mention an old acquaintance in another city, and the model has no idea who that is
- The same character was a cold-blooded killer yesterday and is gentle today, because it forgot who it was

Dumping every note into the context window is the other extreme: **it blows the budget, and it can't tell "who actually knows" from "who merely heard a rumour."**

This plugin takes the middle path: **keep a small dossier for each character, and pull out only the relevant pages when they're needed.**

And it accepts one awkward truth—**for the same event, A believes it, B denies it, C only heard about it. That's not a contradiction; that's normal.** So the archive can hold multiple versions of the same event, and each character's beliefs stay independent.

---

## What it does

| Capability | Description |
|---|---|
| **Automatic profiling** | Characters worth remembering are added to the archive on their own |
| **Per-turn consolidation** | After the prose is written, the plugin reads it and works out who appeared and who learned what |
| **Pre-writing recall** | Before the next generation, relevant memories are handed to the model within a character budget |
| **Browse & edit** | A side panel to read each dossier, rename people, edit contents, adjust relationships |
| **Swap the schema** | 8 default columns; rename them, rewrite their prompts, or replace the whole set |
| **Edit the prompts** | All three prompt templates are editable, with one-click restore to defaults |
| **Export & import** | The whole archive can be exported to a file and imported back |

---

## Installation

### Prerequisites

- **DSH Tavern**, already installed
- You can create and extract zip files

### Option 1: Upload a ZIP (recommended)

**Step 1: get the package** (either way)

- **Easiest**: download the ready-made `character-archives.zip` from [Releases](https://github.com/WhichWitchWin/character-archives/releases) (built by CI, ready to use)
- **Build it yourself**: download this repo → extract → **compress only the `plugin/` folder** into a zip

**Step 2**: in the tavern, open **Settings → Tavern Plugins → Upload ZIP** and pick that zip.

**Step 3**: the host loads it within a few seconds; **refresh the browser** and it appears in the sidebar.

> ⚠️ **Do not zip the whole repository**
> The installer treats the **shallowest `package.json`** as the plugin root. This repo has a `package.json` at the top level (for dev scripts), so a whole-repo zip makes it win over `plugin/package.json`, and the install fails with:
> `package.json 没有写宿主入口（exports "." 或 main），不是 Tavern 插件`
>
> Zip only the `plugin/` level—the resulting archive should contain `plugin/package.json` (or `package.json` directly), not the repo-root `package.json`.

### Option 2: Copy the folder manually

A DSH Tavern plugin **is just a folder**—no build step, no dependencies, no patching the tavern itself.

Copy `plugin/` into the tavern's data directory under `plugins/`, renamed to `character-archives`:

```text
<tavern data dir>/plugins/
└─ character-archives/
   ├─ package.json
   ├─ index.mjs      host side (requires a restart when changed)
   ├─ client.js      browser side (hot-reloads)
   ├─ assets/        default prompts + tokenizer dictionary
   └─ lib/           pure logic modules
```

On Windows the tavern data directory is typically:

```text
C:\Users\<your-name>\.dsh\profile-data\tavern\data\plugins\
```

> The folder name must be `character-archives`—the plugin uses it to recognise that it was installed by the tavern, which is how it puts its data in `<tavern data dir>/plugin-data/character-archives/`. With the wrong name it falls back to storing data inside the plugin folder, where an update can wipe it.

### If you're developing in this repo

```bash
npm run install:dev
```

This copies `plugin/` into the directory above.

> ⚠️ **Two things you need to know**
> 1. **Changing `index.mjs` (host side) requires restarting DSH**; changing `client.js` hot-reloads.
> 2. `install:dev` **copies but never deletes**—files removed from `plugin/` stay behind in the installed copy.

### Verify

Open any game → sidebar "＋" → Plugins → **Character Archives**. If the panel appears, you're set.

> 💡 **Updating an existing install requires a restart**: a fresh install is loaded automatically, but after an in-place upgrade the old module is still in memory—restart DSH to pick up the new code.

---

## Usage

### Four tabs

| Tab | What it's for |
|---|---|
| **Archive** | Browse present / off-screen / dormant characters, search, inspect what someone knows |
| **Settings** | Recall budget, cognition defaults, storage retention |
| **Prompts** | Edit the three prompt templates, or restore defaults |
| **Presets** | Edit column names and extraction prompts; save as global default or per-card override |

### What you can do in the Archive tab

- Expand a character to see their **columns** (who they are) and their **cognitions** (what they know, whether they believe it, who told them)
- Rename (the old name becomes an alias automatically), change status (present / off-screen), mark as ★ important
- Lock someone (the model can't edit them) or hide them from the model
- **Drag the title row** to move someone between groups (present / off-screen / dormant)
- Each claim shows the words the plugin extracted automatically, which explains *why* a character was recalled

### What you don't need to manage

- Who gets profiled, who has left, who learned what—**the plugin decides**. You only step in when it gets something wrong.
- The archive belongs to the current playthrough; when the story rolls back, it rolls back too.

---

## How it works

Three paragraphs; details are in the [design document](docs/DESIGN.md) (Chinese).

**1. Memory has two layers.** One is the *claim*—a sentence somebody stated and somebody believed, not guaranteed true. The other is the *pointer*—each character holds their own, recording whether they believe it and who they heard it from. The same event can have several versions, because belief is per-person.

**2. Recall only when needed.** Before each generation, the plugin picks memories belonging to **present** characters and injects them within a 3000-character budget. Selection uses fixed scoring: about someone present, about the current location, or word overlap with the prose. **Off-screen characters are not injected**—the prose just covered them.

**3. Consolidate after each turn.** Once the prose is written, the plugin reads it and updates the archive. This runs as a separate model call, so it doesn't consume your narrative context.

---

## Repository layout

```text
plugin/            the plugin itself (copy into plugins/ to run)
├─ index.mjs       host entry: apply(ctx), registers all handles
├─ client.js       browser side: the side panel
├─ prompt.js       fallback copy of the three prompts (generated, do not edit)
├─ assets/         default prompts + jieba tokenizer dictionary
└─ lib/            pure logic modules (no tavern API, unit-testable)
docs/              design doc, ADRs, ROADMAP
tests/             unit tests
scripts/           dev scripts (install, prompt sync)
```

---

## Where the data lives

The archive is **not** stored inside the tavern's conversation data. It lives in the plugin's own directory:

```text
<tavern data dir>/plugin-data/character-archives/
```

This keeps it safe across plugin updates—but it also means **reinstalling the plugin (wiping that folder) loses your data**.

> 💡 **Tip**: before switching machines or reinstalling, use **Export** in the panel.

---

## FAQ

**Q: I changed the code and nothing happened.**
Changing `index.mjs` requires a DSH restart; `client.js` hot-reloads. For prompt edits, check that you changed all the places it's stored—the prompts exist in four locations (see the [design document](docs/DESIGN.md)).

**Q: Something was recorded that shouldn't have been.**
Delete that claim in the panel. You can also tighten the recording thresholds in the Prompts tab.

**Q: The model records every trivial detail.**
This is where a lot of design effort went. The system prompt has "four hard rules", two of which exist specifically for this: the action itself isn't recorded, and what the role would naturally do isn't recorded. If it's still too verbose, make those two rules stricter in the Prompts tab.

**Q: Pasting the GitHub URL fails with "no host entry"?**
That's this repository's layout, not your mistake. The installer picks the **shallowest `package.json`** as the plugin root, and the repo root has one for dev scripts, so it wins over `plugin/package.json`. **Use "Upload ZIP" instead**, and zip only the `plugin/` level (see [Installation](#installation)).

**Q: Can I install two copies?**
No. Plugins are identified by name.

**Q: Can other plugins read this archive?**
Not yet.

---

## Documentation

| What you want | Where |
|---|---|
| Current design | [docs/DESIGN.md](docs/DESIGN.md) (single source of truth, Chinese) |
| Why it's built this way | [docs/adr/](docs/adr/) (104 decision records, [index](docs/adr/README.md)) |
| What's planned | [docs/ROADMAP.md](docs/ROADMAP.md) |
| What changed | [CHANGELOG.md](CHANGELOG.md) (external) / [docs/CHANGELOG.md](docs/CHANGELOG.md) (internal timeline) |
| How to contribute | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Project conventions | [AGENTS.md](AGENTS.md) |

> All documentation other than this file is written in Chinese.

---

## Status

**Version `0.1.3`**, released—see [Releases](https://github.com/WhichWitchWin/character-archives/releases) for the install package.

- **Working**: profiling, per-turn consolidation, recall injection, full panel CRUD, column presets, editable prompts, export/import, settings, **manual re-run** (one button to redo the latest turn's write-back when the automatic one missed), **bulk delete** for claims/cognitions (multi-select, select-all, Shift range)
- **Tests**: 867 passing (`npm test`), also run on Linux in CI
- **Zero runtime dependencies**: no `dependencies` in `plugin/`
- **Not implemented**: cross-plugin API, same-name different-person, standalone preset import/export, in-game time for non-MVU cards

Per-version acceptance criteria and remaining work: [docs/ROADMAP.md](docs/ROADMAP.md).

---

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

---

## License

**Code and documentation are licensed separately:**

| Scope | License | What you must do |
|---|---|---|
| **Code** (`plugin/`, `scripts/`, `tests/`) | [GPL-3.0-or-later](LICENSE) | Keep the copyright notice; **if you distribute a modified version, you must release your changes under the GPL too**; state what you changed |
| **Documentation** (`docs/`, README, CONTRIBUTING, AGENTS) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | **Credit WhichWitchWin**, link the license, and indicate whether you made changes |

Full details and **exact attribution wording** are in [NOTICE](NOTICE).

> ⚠️ **One honest caveat**: copyright protects *expression*, not *ideas*.
> If someone reads these design documents, understands the approach, and writes their own implementation from scratch, that is not infringement—no license can prevent it.
> What CC BY 4.0 does enforce is attribution when the **text itself** is copied or adapted.

Third-party: the tokenizer dictionary under `plugin/assets/dict/` comes from jieba (MIT) and is **not** covered by the dual license above; see `LICENSE-jieba.txt` in that folder.
