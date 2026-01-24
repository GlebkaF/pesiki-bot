#!/bin/bash
# Ralph - autonomous AI coding agent
# Always runs in Docker sandbox with Claude Opus 4.5
#
# Usage:
#   ./ralph.sh           # One iteration (interactive)
#   ./ralph.sh 5         # 5 iterations (AFK mode)
#   ./ralph.sh 10 -p     # 10 iterations (print mode, non-interactive)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ITERATIONS=${1:-1}
MODE=${2:-""}
MODEL="opus-4.5"

echo "🐳 Ralph (Docker Sandbox + $MODEL)"
echo "📁 Workspace: $SCRIPT_DIR"
echo "🔄 Iterations: $ITERATIONS"
echo ""

PROMPT="@PRD.md @progress.txt

You are Ralph - an autonomous coding agent.

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

  if [[ "$MODE" == "-p" ]] || [[ "$ITERATIONS" -gt 1 ]]; then
    # Print mode for AFK / multiple iterations
    result=$(docker sandbox run cursor agent -p -f --model "$MODEL" "$PROMPT")
    echo "$result"
  else
    # Interactive mode for single iteration
    docker sandbox run cursor agent -f --model "$MODEL" "$PROMPT"
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
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
