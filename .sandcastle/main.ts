// Parallel Planner — three-phase orchestration loop
//
// This template drives a multi-phase workflow:
//   Phase 1 (Plan):    Agent analyzes open issues, builds a dependency
//                      graph, and outputs a <plan> JSON listing unblocked issues
//                      with their target branch names.
//   Phase 2 (Execute): N agents run in parallel via Promise.allSettled,
//                      each working a single issue on its own branch.
//   Phase 3 (Merge):   An agent merges all branches that produced commits.
//
// The outer loop repeats up to MAX_ITERATIONS times so that newly unblocked
// issues are picked up after each round of merges.
//
// Usage:
//   npx tsx .sandcastle/main.ts
// Or add to package.json:
//   "scripts": { "sandcastle": "npx tsx .sandcastle/main.ts" }

import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { z } from "zod";

const planSchema = z.object({
  issues: z.array(
    z.object({ id: z.string(), title: z.string(), branch: z.string() }),
  ),
});

const MAX_ITERATIONS = 10;

const hooks = {
  sandbox: { onSandboxReady: [
    { command: "mkdir -p /home/agent/.local/state" },
    { command: "npm install" },
  ] },
};

const copyToWorktree = ["node_modules"];

const sandboxConfig = docker({
  mounts: [
    { hostPath: "~/.config/opencode", sandboxPath: "/home/agent/.config/opencode", readonly: true },
    { hostPath: "~/.opencode", sandboxPath: "/home/agent/.opencode", readonly: true },
    { hostPath: "~/.local/share/opencode", sandboxPath: "/home/agent/.local/share/opencode", readonly: false },
  ],
});

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
  console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} ===\n`);

  // Phase 1: Plan
  const plan = await sandcastle.run({
    hooks,
    sandbox: sandboxConfig,
    name: "planner",
    maxIterations: 1,
    agent: sandcastle.opencode("opencode-go/deepseek-v4-pro"),
    promptFile: "./.sandcastle/plan-prompt.md",
    output: sandcastle.Output.object({ tag: "plan", schema: planSchema }),
  });

  const issues = plan.output.issues;

  if (issues.length === 0) {
    console.log("No unblocked issues to work on. Exiting.");
    break;
  }

  console.log(
    `Planning complete. ${issues.length} issue(s) to work in parallel:`,
  );
  for (const issue of issues) {
    console.log(`  ${issue.id}: ${issue.title} → ${issue.branch}`);
  }

  // Phase 2: Execute (parallel agents in Docker containers)
  const settled = await Promise.allSettled(
    issues.map((issue) =>
      sandcastle.run({
        hooks,
        copyToWorktree,
        sandbox: sandboxConfig,
        branchStrategy: { type: "branch", branch: issue.branch },
        name: "implementer",
        maxIterations: 100,
        agent: sandcastle.opencode("opencode-go/deepseek-v4-pro"),
        promptFile: "./.sandcastle/implement-prompt.md",
        promptArgs: {
          TASK_ID: issue.id,
          ISSUE_TITLE: issue.title,
          BRANCH: issue.branch,
        },
      }),
    ),
  );

  for (const [i, outcome] of settled.entries()) {
    if (outcome.status === "rejected") {
      console.error(
        `  ✗ ${issues[i]!.id} (${issues[i]!.branch}) failed: ${outcome.reason}`,
      );
    }
  }

  const completedIssues = settled
    .map((outcome, i) => ({ outcome, issue: issues[i]! }))
    .filter(
      (
        entry,
      ): entry is {
        outcome: PromiseFulfilledResult<
          Awaited<ReturnType<typeof sandcastle.run>>
        >;
        issue: (typeof issues)[number];
      } =>
        entry.outcome.status === "fulfilled" &&
        entry.outcome.value.commits.length > 0,
    )
    .map((entry) => entry.issue);

  const completedBranches = completedIssues.map((i) => i.branch);

  console.log(
    `\nExecution complete. ${completedBranches.length} branch(es) with commits:`,
  );
  for (const branch of completedBranches) {
    console.log(`  ${branch}`);
  }

  if (completedBranches.length === 0) {
    console.log("No commits produced. Nothing to merge.");
    continue;
  }

  // Phase 3: Merge
  await sandcastle.run({
    hooks,
    sandbox: sandboxConfig,
    name: "merger",
    maxIterations: 1,
    agent: sandcastle.opencode("opencode-go/deepseek-v4-pro"),
    promptFile: "./.sandcastle/merge-prompt.md",
    promptArgs: {
      BRANCHES: completedBranches.map((b) => `- ${b}`).join("\n"),
      ISSUES: completedIssues.map((i) => `- ${i.id}: ${i.title}`).join("\n"),
    },
  });

  console.log("\nBranches merged.");
}

console.log("\nAll done.");
