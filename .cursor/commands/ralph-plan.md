---
description: Ralph Plan - create or refine the PRD
---

# Ralph: Planning Mode

Help me create or refine the Product Requirements Document (PRD).

## Current PRD

@PRD.md

## Instructions

1. **If PRD is empty/template**: Ask me what I want to build, then create a detailed PRD with:
   - Clear overview and goals
   - Tech stack decisions
   - Broken down features as checkbox items
   - Logical phases (MVP first, then enhancements)
   - Each task should be small enough to complete in one iteration

2. **If PRD exists**: Review it and suggest improvements:
   - Are tasks too big? Break them down
   - Are dependencies clear? Reorder if needed
   - Missing edge cases? Add them
   - Technical gaps? Fill them in

## Good Task Examples

```markdown
- [ ] Set up project with package.json and TypeScript config
- [ ] Create Express server with health check endpoint
- [ ] Add user model with basic CRUD operations
- [ ] Implement JWT authentication middleware
```

## Bad Task Examples (too vague)

```markdown
- [ ] Build the backend
- [ ] Add all features
- [ ] Make it work
```

## Output

Update PRD.md with the refined plan, keeping checkbox format for all actionable items.
