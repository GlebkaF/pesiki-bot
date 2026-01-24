---
description: Ralph - one iteration of autonomous task execution
---

# Ralph: Single Task Iteration

You are operating in Ralph mode - an autonomous coding loop.

## Context Files

Read these files first:
- @PRD.md - Product Requirements Document with all tasks
- @progress.txt - Log of completed work

## Your Mission

1. **Analyze** - Read the PRD and progress file carefully
2. **Select** - Find the NEXT unchecked task (highest priority incomplete item)
3. **Implement** - Complete that ONE task fully
4. **Test** - Run tests/lints to verify your changes work
5. **Commit** - Make a git commit with a clear message describing what you did
6. **Update** - Append to progress.txt what you completed and when

## Critical Rules

- **ONE TASK ONLY** - Do not work on multiple tasks. Pick one, finish it, stop.
- **Small commits** - Each Ralph iteration = one focused commit
- **Update progress** - Always append to progress.txt before finishing
- **Check the box** - Mark the completed task as [x] in PRD.md

## Progress Entry Format

```
## [YYYY-MM-DD HH:MM] Task: <task name>
- What was done: <brief description>
- Files changed: <list of files>
- Commit: <commit hash or "pending">
```

## When PRD is Complete

If all tasks in PRD.md are checked [x], respond with:

```
✅ PRD COMPLETE - All tasks finished!
```

And do NOT make any changes.
