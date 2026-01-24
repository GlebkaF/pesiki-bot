#!/bin/bash
# Ralph in Docker Sandbox
# Runs cursor agent in isolated container
# Usage: ./ralph-sandbox.sh [iterations]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ITERATIONS=${1:-1}

echo "🐳 Ralph Sandbox Mode"
echo "📁 Workspace: $SCRIPT_DIR"
echo "🔄 Iterations: $ITERATIONS"
echo ""

for ((i=1; i<=$ITERATIONS; i++)); do
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🔄 Ralph iteration $i of $ITERATIONS"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  result=$(docker sandbox run cursor agent -p -f --workspace /workspace \
    "@PRD.md @progress.txt

You are Ralph - an autonomous coding agent running in a Docker sandbox.

1. Read PRD.md and progress.txt carefully
2. Find the NEXT incomplete task (unchecked checkbox [ ])
3. Implement that ONE task fully
4. Run tests/type checks if they exist
5. Mark the task as complete [x] in PRD.md
6. Append to progress.txt:
   ## [$(date '+%Y-%m-%d %H:%M')] Task: <name>
   - What was done: <description>
   - Files changed: <list>
7. Commit your changes with a clear message

CRITICAL: Only work on ONE task. Stop after committing.

If all tasks are complete, output exactly: <RALPH_COMPLETE>")

  echo "$result"
  echo ""

  if [[ "$result" == *"<RALPH_COMPLETE>"* ]] || [[ "$result" == *"PRD COMPLETE"* ]]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "✅ PRD complete after $i iterations!"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 0
  fi

  sleep 2
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⏸️  Completed $ITERATIONS iterations"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
