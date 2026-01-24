#!/bin/bash
# Ralph - autonomous AI coding agent with Claude Opus 4.5
#
# Usage:
#   ./ralph.sh           # One iteration (interactive)
#   ./ralph.sh 5         # 5 iterations (AFK mode)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ITERATIONS=${1:-1}
MODEL="opus-4.5"

echo "🤖 Ralph ($MODEL)"
echo "📁 Workspace: $SCRIPT_DIR"
echo "🔄 Iterations: $ITERATIONS"
echo ""

# Safety: create backup branch before AFK mode
if [[ "$ITERATIONS" -gt 1 ]]; then
  BACKUP_BRANCH="ralph-backup-$(date +%Y%m%d-%H%M%S)"
  git branch "$BACKUP_BRANCH" 2>/dev/null || true
  echo "🛡️  Safety backup: $BACKUP_BRANCH"
  echo ""
fi

PROMPT="@PRD.md @progress.txt

You are Ralph - an autonomous coding agent.

## SAFETY RULES (NEVER VIOLATE)
- ONLY work inside this workspace directory: $SCRIPT_DIR
- NEVER run: rm -rf /, sudo, chmod 777, curl | bash, or any destructive system commands
- NEVER modify files outside the workspace
- NEVER install global packages (no npm -g, pip install without venv)
- NEVER access or modify ~/.bashrc, ~/.zshrc, /etc, /usr, /var, ~/ or any system files
- If unsure about a command's safety, DON'T run it

## YOUR TASK
1. Read PRD.md and progress.txt carefully
2. Find the NEXT incomplete task (unchecked checkbox [ ])
3. Implement that ONE task fully
4. Run tests/type checks if they exist (npm test, npx tsc, etc)
5. Mark the task as complete [x] in PRD.md
6. Append to progress.txt with format:
   ## [YYYY-MM-DD HH:MM] Task: <name>
   - What was done: <description>
   - Files changed: <list>
7. Commit your changes with a clear message

CRITICAL: Only work on ONE task. Stop after committing.

If all tasks are complete, output exactly: <RALPH_COMPLETE>"

for ((i=1; i<=$ITERATIONS; i++)); do
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🔄 Iteration $i of $ITERATIONS"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  if [[ "$ITERATIONS" -gt 1 ]]; then
    # Print mode for AFK / multiple iterations
    result=$(cursor agent -p -f --model "$MODEL" --workspace "$SCRIPT_DIR" "$PROMPT" 2>&1) || true
    echo "$result"
  else
    # Interactive mode for single iteration
    cursor agent -f --model "$MODEL" --workspace "$SCRIPT_DIR" "$PROMPT"
    result=""
  fi

  echo ""

  if [[ "$result" == *"<RALPH_COMPLETE>"* ]] || [[ "$result" == *"PRD COMPLETE"* ]]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "✅ PRD complete after $i iterations!"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 0
  fi

  [[ "$ITERATIONS" -gt 1 ]] && sleep 2
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⏸️  Completed $ITERATIONS iteration(s)"
[[ -n "$BACKUP_BRANCH" ]] && echo "🛡️  To restore: git checkout $BACKUP_BRANCH"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
