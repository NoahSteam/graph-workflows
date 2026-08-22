---
name: graph-workflows
description: >-
  Author a Claude Code dynamic workflow — a plain-JS graph that fans a fleet of
  subagents out and converges them — for the repo at hand. Use when a task is
  wide (many independent files/sites/sources to cover at once), needs
  verification (findings a lone pass would get wrong), or is too big for one
  context (audits, migrations, broad reviews, research). Explains the four
  primitives, the diamond+verify pattern, pipeline-vs-barrier, worktree
  isolation, and model tiering, then writes a graph tailored to THIS repo.
  Also ships a ready, repo-agnostic `review-diff` workflow as a worked example.
---

# Building work as a graph

Most multi-step agent work is written as a straight line — step 1, step 2, step
3, each waiting for the last. Half those steps never needed to wait. A **graph**
keeps only the waits that carry data, and runs the rest at once. In Claude Code
that graph is a **dynamic workflow**: a plain-JavaScript script you pass to the
`Workflow` tool. The script is *code*, so the coordination costs zero model
tokens — the agents think, the script decides what runs before what.

Use this skill to write the right graph for the repository you're in. Do not
force a graph onto sequential work; see "When NOT to" below.

## The model: nodes and edges

- A **node** is one `agent()` call — one bounded job, one input, one output.
- An **edge** is data flowing from one node into another.

The trap is treating "and then" as an edge. It's only an edge if the next node
*consumes* the previous one's output. If no variable crosses between two boxes,
they're independent — and independence is what you parallelize.

**The edge is plain JavaScript, not an agent.** Flatten, dedupe, filter, sort,
rank — that's `results.flat().filter(Boolean)`, deterministic and free. Spending
a model call to "combine the results" is paying rent on your own wiring. Reserve
agents for judgment; use code for plumbing.

## The four primitives

| Primitive | Meaning |
|---|---|
| `agent(prompt, opts)` | One node. `opts.schema` (JSON Schema) forces validated structured output — no parsing, the model retries on mismatch. `opts.isolation:'worktree'` gives it its own checkout. `opts.model` / `opts.effort` tier it. `opts.phase` groups it in the progress UI. Returns the string, or the validated object with `schema`, or `null` if it died. |
| `parallel([thunks])` | Fan out and **wait for all** — a barrier. A thunk that throws becomes `null`; always `.filter(Boolean)`. Concurrency is capped (~CPU count); pass many, they queue. |
| `pipeline(items, s1, s2, …)` | Fan out with **no barrier**: item A can be in stage 3 while B is still in stage 1. Each later stage gets `(prevResult, originalItem, index)`. **This is the default.** |
| `phase(title)` / `log(msg)` | Progress grouping and a narrator line. |

Plus globals: `args` (the value passed to `Workflow({args})`), `budget`
(token target), and `workflow(name, args)` to call another saved workflow inline.

## The shapes worth knowing

- **Diamond** — split → work in parallel → merge. The workhorse. A market scan,
  a dependency audit, a code review, a research report are all diamonds; swap the
  prompts.
- **Verifier on the edge** — before a finding is allowed downstream, spawn a
  skeptic prompted to *refute* it (default `confirmed:false` unless the evidence
  plainly holds). This is what makes a graph's output trustworthy where a lone
  pass would surface plausible-but-wrong findings. Use N skeptics and majority
  vote, or diverse lenses (correctness / security / does-it-reproduce), for
  higher stakes.
- **Judge panel** — generate N attempts from different angles, score each with
  parallel judges, synthesize from the winner while grafting the best of the
  runners-up. For wide solution spaces (design, tuning).
- **Loop-until-dry** — for unknown-size discovery: keep spawning finders until K
  consecutive rounds surface nothing new. **Dedupe against everything *seen*, not
  just confirmed**, or rejected findings reappear and it never converges.

## pipeline vs. parallel (the cost lever)

Default to `pipeline`. Reach for a `parallel` barrier only when a stage genuinely
needs *every* prior result at once — a cross-set dedupe, an early-exit on the
total, a prompt that compares against "the other findings." "It's cleaner code"
and "the stages feel separate" are not reasons; barrier latency is real wasted
wall-clock. Smell test: if you wrote `parallel → transform → parallel` and the
middle transform has no cross-item dependency, it should have been a `pipeline`.

## worktree isolation and model tiering

- `isolation:'worktree'` is the seatbelt for exactly one topology: agents that
  **write files in parallel** and would otherwise collide. It costs setup time
  and disk — never a default. Read-only fan-outs don't want it.
- Tier models: run bounded, repetitive nodes (extract, classify) on a cheaper
  model via `opts.model`; keep the expensive tier for the judgment nodes
  (synthesize, adjudicate). By default every subagent inherits the session model.

## Skeleton (copy, then adapt to the repo)

```javascript
export const meta = {
  name: 'my-workflow',                       // pure literal — no variables
  description: 'One line shown in the permission dialog',
  phases: [{ title: 'Find' }, { title: 'Verify' }],
}

const FINDING = { type: 'object', additionalProperties: false,
  properties: { file: {type:'string'}, severity: {enum:['high','medium','low']},
                claim: {type:'string'}, evidence: {type:'string'} },
  required: ['file','severity','claim','evidence'] }
const VERDICT = { type: 'object', additionalProperties: false,
  properties: { confirmed: {type:'boolean'}, reason: {type:'string'} },
  required: ['confirmed','reason'] }

const DIMENSIONS = [ /* one bounded lens each, pointed at real paths */ ]

const reviewed = await pipeline(
  DIMENSIONS,
  (d) => agent(d.prompt, { label: `review:${d.key}`, phase: 'Find', schema: FINDING }),
  (finding) => agent(`Adversarially verify and try to refute: ${finding.claim}`,
                     { phase: 'Verify', schema: VERDICT })
                .then((v) => ({ ...finding, verdict: v })),
)
const confirmed = reviewed.filter(Boolean).filter((f) => f.verdict?.confirmed)
return { confirmed }
```

## Authoring rules (that bite if ignored)

- `meta` must be a **pure literal** — no variables, calls, or interpolation.
  Its `name` is how the workflow is invoked; keep `phases` titles matching the
  `phase()` calls.
- Scripts are **plain JavaScript, not TypeScript** — no type annotations,
  interfaces, or generics.
- `Date.now()`, `Math.random()`, and argless `new Date()` **throw** (they'd break
  resume). Vary agents by index; pass timestamps via `args`; stamp after the run.
- Point every agent prompt at **real paths in this repo** and give it a `schema`
  whenever the next node consumes its output.
- Keep read-only workflows free of worktrees.

## When NOT to build a graph

A straight line is correct when steps are genuinely sequential and cheap: a
single-file edit, a one-function fix, anything where step N needs step N-1's exact
output and there's only one of it. The parallelism is wasted and the orchestration
is pure overhead. Reach for a graph when the work is **wide**, **needs
verification**, or **won't fit one context** — not otherwise.

## Worked example shipped with this skill

`review-diff` (in this plugin's `workflows/`) is a complete, repo-agnostic
diamond: it discovers the branch diff and stack at runtime, reviews across
dimensions, adversarially verifies each finding, and reports. Read it as a
template, or run it directly: `/graph-workflows:review-diff`.
