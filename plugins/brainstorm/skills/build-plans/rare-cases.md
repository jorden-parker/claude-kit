# Rare cases for building plans

Read this file only when SKILL.md points here.

## Missing step

Before you start a plan, and again whenever a step or a failure shows it, look for a missing step: anything the plan needs that none of its steps provides, such as a dependency that is not installed, a migration, generated code, a config value, or a file or function that another plan creates. Do not build on and wait for it to fail. Take the missing step first: write its step file into the plan folder and add an unticked line for it in plan.md ahead of the step that needs it, so `brainstorm:step-implementer` does it, or, when another plan in the index provides it, build that plan first and base this plan's branch on it. Ask the user only when the missing step needs something only the user can give.

## Bare repository and worktree name collision

Place: run `git rev-parse --git-common-dir`. When `git -C <that folder> rev-parse --is-bare-repository` prints true, the repository is bare: put the worktree beside the main worktree, as a sibling folder. In any other repository, put it beside the repository's top folder. Either way the folder is named after the plan slug alone, such as `add-login` for the branch `feat/add-login`: no type, no repository name and no ticket prefix. When a folder of that name already exists and is not this plan's worktree, add `-2`. Never put it inside the repository.

## Spike plans

A spike plan (Kind `spike` in the index) uses the same flow. Its steps write findings.md in the plan folder, and the final review checks that findings.md answers every question. When a spike plan is `done`, report the findings path and say that the idea needs a new `/brainstorm plan` run before anything is changed.
