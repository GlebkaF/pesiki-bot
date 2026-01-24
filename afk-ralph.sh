#!/bin/bash
# Ralph: AFK mode - autonomous loop
# Usage: ./afk-ralph.sh <iterations>

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ -z "$1" ]; then
  echo "Usage: $0 <iterations>"
  echo "Example: $0 10"
  exit 1
fi

ITERATIONS=$1

echo "🚀 Starting Ralph AFK mode: $ITERATIONS iterations"
echo "📁 Working directory: $SCRIPT_DIR"
echo ""

for ((i=1; i<=$ITERATIONS; i++)); do
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🔄 Ralph iteration $i of $ITERATIONS"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  result=$(cursor agent -p -f --workspace "$SCRIPT_DIR" "@PRD.md @progress.txt

You are Ralph - an autonomous coding agent.

1. Read the PRD.md and progress.txt files.
2. Find the NEXT incomplete task (unchecked checkbox [ ]).
3. Implement that ONE task fully.
4. Run tests/type checks if available.
5. Mark the task as complete [x] in PRD.md.
6. Append progress to progress.txt with timestamp.
7. Commit changes with a clear message.

ONLY DO ONE TASK. If all tasks are complete, output exactly: <RALPH_COMPLETE>")

  echo "$result"
  echo ""

  if [[ "$result" == *"<RALPH_COMPLETE>"* ]] || [[ "$result" == *"PRD COMPLETE"* ]]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "✅ PRD complete after $i iterations!"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 0
  fi

  # Small delay between iterations
  sleep 2
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⏸️  Completed $ITERATIONS iterations. Run again to continue."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
