---
name: synth-role-inheritance
description: Tests depth-based role inheritance and override behavior.
context: fork
allowed-tools: Read, Bash
---

Inheritance test fixture.

<!-- role: detect -->

## Top-level detect

### Sub-detect (inherits detect)

Content.

#### Deep-detect (inherits detect)

Content.

<!-- role: emit -->

### Override to emit (overrides inherited detect)

```typescript
const code = true;
```

<!-- role: workflow -->

## Top-level workflow

### Sub-workflow (inherits workflow)

Content.

<!-- role: reference -->

### Override sub to reference

Reference data.
