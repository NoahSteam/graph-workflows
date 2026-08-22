/**
 * review-diff — a REPO-AGNOSTIC review graph. Copy this file into any repo's
 * .claude/workflows/ (or ship it in a plugin) and it works with zero edits,
 * because it discovers everything it needs at runtime instead of naming files:
 *
 *   discover changed files (git)  →  review across dimensions (parallel)
 *                                 →  verify each finding (adversarial)  →  report
 *
 * Nothing here is DreamOrbs-specific. The agents read `git diff` and the repo's
 * own conventions, so the same script reviews a Rust crate, a web app, or a data
 * pipeline. This is the unit that ports; the render-review / tune-visuals scripts
 * next to it are examples that only make sense in this app.
 *
 * Read-only: agents only read/grep/run git, never write. Safe to run anywhere.
 *
 *   Workflow({ name: "review-diff" })                          // vs merge-base with origin default branch
 *   Workflow({ name: "review-diff", args: { base: "main" } })  // vs a specific base
 *   Workflow({ name: "review-diff", args: { dimensions: ["correctness","tests"] } })
 */

export const meta = {
  name: 'review-diff',
  description: 'Review the current branch\'s changes across dimensions, each finding adversarially verified. Repo-agnostic: discovers the diff and stack at runtime.',
  whenToUse: 'On any repo, after making changes, to get a verified review of just the diff. Portable — no per-repo editing.',
  phases: [
    { title: 'Scope', detail: 'find changed files vs the base' },
    { title: 'Review', detail: 'one reviewer per dimension' },
    { title: 'Verify', detail: 'a skeptic tries to refute each finding' },
  ],
}

const FINDING = {
  type: 'object',
  additionalProperties: false,
  properties: {
    file: { type: 'string' },
    line: { type: 'integer' },
    severity: { type: 'string', enum: ['high', 'medium', 'low'] },
    claim: { type: 'string' },
    evidence: { type: 'string' },
    suggestion: { type: 'string' },
  },
  required: ['file', 'severity', 'claim', 'evidence'],
}
const DIM_RESULT = {
  type: 'object',
  additionalProperties: false,
  properties: { dimension: { type: 'string' }, findings: { type: 'array', items: FINDING } },
  required: ['dimension', 'findings'],
}
const VERDICT = {
  type: 'object',
  additionalProperties: false,
  properties: { confirmed: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['confirmed', 'reason'],
}

// Generic review lenses. Each agent is told to first discover the stack (read a
// couple of changed files, the repo's test/lint setup) so the lens adapts to the
// language on its own. Override with args.dimensions to run a subset.
const ALL = {
  correctness: `logic errors, off-by-one, null/undefined, unhandled async rejections, race conditions, resource leaks, wrong edge-case behaviour introduced by THIS diff`,
  'error-handling': `swallowed errors, missing validation of inputs/return values, failures that surface as silent wrong output rather than a clear error, missing cleanup on the error path`,
  tests: `behaviour changed by the diff that has no test, tests that assert too little (would pass even if the feature broke), missing coverage of the new edge cases`,
  simplification: `duplicated logic that could reuse something already in the repo, dead code, needless complexity, a standard-library or existing-helper equivalent for hand-rolled code`,
  security: `injection, unsafe deserialization, secrets in code, missing authz checks, unsafe handling of untrusted input introduced by the diff`,
}

const base = (args && args.base) || null
const chosen = (args && Array.isArray(args.dimensions) && args.dimensions.length)
  ? args.dimensions.filter((d) => ALL[d])
  : ['correctness', 'error-handling', 'tests', 'simplification']

// --- Scope: one agent discovers the diff. Kept as a node (not raw exec) because
// finding the right base ref differs per repo and benefits from judgment. -------
phase('Scope')
const SCOPE = {
  type: 'object',
  additionalProperties: false,
  properties: {
    base: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['base', 'files', 'summary'],
}
const scope = await agent(
  `Determine what changed on the current git branch so it can be reviewed.
${base ? `Use base ref "${base}".` : `Pick the right base: try the merge-base against the remote default branch (origin/HEAD -> origin/main or origin/master); fall back to comparing against the previous commit if this is a fresh repo.`}
Run git to get the list of changed files (added/modified, skip pure deletions and lockfiles/generated files). Return the base you used, the changed file paths, and a one-line summary of the change.`,
  { label: 'scope', phase: 'Scope', schema: SCOPE },
)
if (!scope || !scope.files.length) return { note: 'no changed files to review', scope }
log(`Reviewing ${scope.files.length} changed file(s) vs ${scope.base}: ${scope.summary}`)

// --- Review → Verify as a pipeline: each dimension's findings start verifying
// the moment that dimension lands, while the others are still reviewing. --------
const fileList = scope.files.join('\n')
const reviewed = await pipeline(
  chosen,
  (dim) =>
    agent(
      `Review ONLY the changes on this branch (base ${scope.base}) through the "${dim}" lens: ${ALL[dim]}.
First discover the stack: read a few of the changed files and note the language/framework and how the repo runs
its tests/lint. Then review the diff of these changed files:\n${fileList}\n
Use \`git diff ${scope.base}\` to see exactly what changed. Report only real issues introduced or exposed by THIS
diff, not pre-existing style. Cite file:line, quote the evidence line, and give a concrete suggestion.`,
      { label: `review:${dim}`, phase: 'Review', schema: DIM_RESULT },
    ),
  (review, dim) =>
    parallel(
      (review?.findings ?? []).map((f) => () =>
        agent(
          `Adversarially verify this "${dim}" review finding against base ${scope.base}. Read the cited code and the
diff yourself and try to REFUTE it. Default to confirmed:false unless the evidence plainly holds and the issue is
really caused by this diff.
File: ${f.file}${f.line ? ':' + f.line : ''}
Claim: ${f.claim}
Evidence: ${f.evidence}`,
          { label: `verify:${f.file}`, phase: 'Verify', schema: VERDICT },
        ).then((v) => ({ ...f, dimension: dim, verdict: v })),
      ),
    ),
)

const rank = { high: 0, medium: 1, low: 2 }
const all = reviewed.flat().filter(Boolean)
const confirmed = all
  .filter((f) => f.verdict && f.verdict.confirmed)
  .sort((a, b) => rank[a.severity] - rank[b.severity])

log(`${confirmed.length} confirmed of ${all.length} raw findings across ${chosen.length} dimensions`)
return { base: scope.base, summary: scope.summary, confirmed, rawCount: all.length, dimensions: chosen }
