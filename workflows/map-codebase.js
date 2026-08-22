/**
 * map-codebase — a REPO-AGNOSTIC "understand" graph. Copy into any repo (or run
 * from this plugin) to get a structured map of an unfamiliar codebase fast:
 *
 *   discover subsystems (git/fs)  →  read each in parallel  →  synthesize a map
 *
 * A lone agent reads a big repo one file at a time until its context fills and it
 * forgets the first half. This fans a reader out per subsystem — each carries its
 * own context, only the structured summary comes back — then one node stitches the
 * summaries into a single map. Read-only; safe anywhere.
 *
 *   Workflow({ name: "map-codebase" })
 *   Workflow({ name: "map-codebase", args: { focus: "the auth and billing paths" } })
 */

export const meta = {
  name: 'map-codebase',
  description: 'Map an unfamiliar codebase: discover its subsystems, read each in parallel, and synthesize one structured overview. Repo-agnostic.',
  whenToUse: 'Landing in a new/large repo and needing a fast, accurate mental model before changing anything.',
  phases: [
    { title: 'Discover', detail: 'find the top-level subsystems' },
    { title: 'Read', detail: 'one reader per subsystem, in parallel' },
    { title: 'Synthesize', detail: 'stitch summaries into one map' },
  ],
}

const focus = (args && args.focus) || null

const SUBSYSTEMS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    subsystems: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          paths: { type: 'array', items: { type: 'string' } },
          why: { type: 'string' },
        },
        required: ['name', 'paths'],
      },
    },
  },
  required: ['subsystems'],
}

const SUMMARY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    purpose: { type: 'string' },
    keyFiles: { type: 'array', items: { type: 'string' } },
    entryPoints: { type: 'array', items: { type: 'string' } },
    dependsOn: { type: 'array', items: { type: 'string' } },
    invariants: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['name', 'purpose', 'keyFiles'],
}

// --- Discover: one agent partitions the repo into subsystems to read. ---------
phase('Discover')
const disc = await agent(
  `Partition this repository into its top-level subsystems so each can be read independently.
Use git and the filesystem: look at the directory layout, the build/package manifests, and any README or docs.
${focus ? `Bias the partition toward: ${focus}. ` : ''}Return 4-10 subsystems, each with a name, the paths that
belong to it, and one line on why it is a unit. Skip vendored deps, build output, and lockfiles.`,
  { label: 'discover', phase: 'Discover', schema: SUBSYSTEMS },
)
const subs = (disc?.subsystems ?? []).slice(0, 10)
if (!subs.length) return { note: 'no subsystems discovered' }
log(`Reading ${subs.length} subsystems: ${subs.map((s) => s.name).join(', ')}`)

// --- Read: fan out, one reader per subsystem. Barrier here is correct: the
// synthesis genuinely needs every summary at once to describe the whole. -------
phase('Read')
const summaries = (
  await parallel(
    subs.map((s) => () =>
      agent(
        `Read and summarise the "${s.name}" subsystem of this repo. Paths: ${s.paths.join(', ')}.
Report its purpose, the key files, entry points, what other subsystems it depends on, any invariants it relies on
(things that must stay true), and the riskiest/most fragile parts. Read the actual files; do not guess.`,
        { label: `read:${s.name}`, phase: 'Read', schema: SUMMARY },
      ),
    ),
  )
).filter(Boolean)

// --- Synthesize: one node turns the summaries into a single readable map. ------
phase('Synthesize')
const map = await agent(
  `Turn these per-subsystem summaries into one coherent map of the whole codebase: how the pieces fit, the main
data/control flow across subsystem boundaries, the cross-cutting invariants, and where a newcomer should start.
${focus ? `Foreground: ${focus}. ` : ''}Be concrete and cite real paths.
SUMMARIES:\n${JSON.stringify(summaries, null, 2)}`,
  { label: 'synthesize', phase: 'Synthesize' },
)

return { subsystems: summaries, map }
