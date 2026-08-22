# graph-workflows

A portable "graphing system" for Claude Code — so you can run larger tasks as
**graphs of subagents** (fan out, verify, converge) on *any* repo and in *any*
session, without copying scripts into each project.

It bundles:

- **A skill, `graph-workflows`** — teaches Claude the four workflow primitives,
  the diamond+verify pattern, pipeline-vs-barrier, worktree isolation and model
  tiering, then writes a graph tailored to whatever repo it's in. This is the
  durable part: every session with the plugin can *author* the right graph, not
  just run canned ones.
- **`review-diff`** — a repo-agnostic review graph. Discovers the branch diff and
  stack at runtime, reviews across dimensions, adversarially verifies each
  finding, reports. No per-repo editing.
- **`map-codebase`** — a repo-agnostic "understand" graph. Partitions an
  unfamiliar repo into subsystems, reads each in parallel, synthesizes one map.

Everything here is read-only and repo-agnostic; nothing names a specific project.

## Why a plugin (and not `~/.claude/workflows/`)

Workflow names resolve from the project `.claude/workflows/` and, as a fallback,
the user-level `~/.claude/workflows/`. On **Claude Code on the web / remote cloud
sessions**, each session is an ephemeral container with only the cloned repo
persisted — the user home is not guaranteed to carry over. So to reach *other
repos in other sessions*, the workflows must travel either **in each repo** or
**in an installed plugin**. A plugin enabled from a marketplace is the one path
that reaches every session without per-repo copying.

## Install

This directory is a self-contained plugin *and* a single-plugin marketplace (its
`.claude-plugin/` holds both `plugin.json` and `marketplace.json`). Two ways in:

**A. Publish it as its own repo (recommended for cross-session reuse)**

1. Copy this directory to the **root** of a new git repo and push it to GitHub,
   e.g. `owner/graph-workflows`. (The marketplace `source: "./."` means "plugin
   files at repo root," so keep `.claude-plugin/`, `workflows/`, `skills/` at the
   top level.)
2. In any session:
   ```
   /plugin marketplace add owner/graph-workflows
   /plugin install graph-workflows@graph-workflows-market
   ```
3. For an org/team, host the repo privately and add it to a team marketplace, or
   force-enable it via managed settings, so every session gets it automatically.

**B. Try it locally first (from this checkout)**

```
/plugin marketplace add ./tools/graph-workflows-plugin
/plugin install graph-workflows@graph-workflows-market
```

## Use

Once installed, everything is namespaced by the plugin:

```
/graph-workflows:review-diff                       # verified review of the current diff
/graph-workflows:map-codebase                      # map an unfamiliar repo
```

or from the Workflow tool by name: `Workflow({ name: "graph-workflows:review-diff" })`,
with `args` as documented in each script's header. The **skill** loads on its own
when a task looks like it wants a graph, or invoke it explicitly to have Claude
author a new workflow for the repo you're in.

## Layout

```
graph-workflows-plugin/
├── .claude-plugin/
│   ├── plugin.json          # manifest (name is what namespaces everything)
│   └── marketplace.json     # single-plugin marketplace, source "./."
├── workflows/               # auto-discovered
│   ├── review-diff.js
│   └── map-codebase.js
├── skills/                  # auto-discovered
│   └── graph-workflows/
│       └── SKILL.md
└── README.md
```

Add your own: drop a `<name>.js` in `workflows/` beginning with a pure-literal
`export const meta`, and the skill explains the rest.
