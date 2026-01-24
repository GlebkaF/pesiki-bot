#!/bin/bash
# Ralph: Single iteration - human-in-the-loop mode
# Run this, watch what happens, run again

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🔄 Starting Ralph iteration..."
echo ""

cursor agent -f "@PRD.md @progress.txt

You are Ralph - an autonomous coding agent.

1. Read the PRD.md and progress.txt files carefully.
2. Find the NEXT incomplete task (unchecked checkbox [ ]).
3. Implement that ONE task fully.
4. Run tests/type checks if they exist.
5. Mark the task as complete [x] in PRD.md.
6. Append your progress to progress.txt with format:
   ## [$(date '+%Y-%m-%d %H:%M')] Task: <name>
   - What was done: <description>
   - Files changed: <list>
7. Commit your changes with a clear message.

CRITICAL: Only work on ONE task. Stop after committing.

If all tasks are complete, say: ✅ PRD COMPLETE"

echo ""
echo "✅ Ralph iteration finished. Check the commit!"
