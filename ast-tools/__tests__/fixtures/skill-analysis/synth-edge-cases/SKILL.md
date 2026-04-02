---
name: synth-edge-cases
description: Fixture for edge-case path alias and command patterns.
allowed-tools: Read, Bash
---

# synth-edge-cases

Covers path aliases and command edge cases not in other fixtures.

## Step 1: Path aliases

Use `@/pages/index.tsx` for the page component.

Use `@/root/tsconfig.json` for the project configuration.

## Step 2: Commands with tree output

```bash
pnpm build
├── .next/
│   └── server/
└── public/
```

## Step 3: Creation in table

| File                   | Status |
| ---------------------- | ------ |
| src/server/new-file.ts | new    |

## Step 4: Content

Plain content section.
