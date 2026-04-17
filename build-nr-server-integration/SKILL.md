---
name: build-nr-server-integration
description: "[DEPRECATED] Server-side NR observability is implemented via OTel SDK (PR #1377). See src/server/lib/otelTracer.ts for the reference implementation."
context: fork
allowed-tools: Read, Grep, Glob, Bash
argument-hint: (deprecated -- no arguments)
tier: open
---

## DEPRECATED

**This skill is deprecated as of PR #1377.** The server-side NR
observability integration has been fully implemented using the
OpenTelemetry SDK. The proprietary `newrelic` Node agent has been removed.

**Do NOT use this skill.** It described a build-from-scratch workflow
(install newrelic, create config, wire middleware) that is no longer
applicable.

### What replaced it

NR is still the observability platform. Data flows via OTLP:

| Old (removed) | New (active) | File |
|---|---|---|
| `import newrelic from 'newrelic'` | `import { withSpan, recordError, setSpanAttributes } from '@/server/lib/otelTracer'` | `src/server/lib/otelTracer.ts` |
| `newrelic.startSegment(name, group, fn)` | `withSpan(name, fn, attributes?)` | `src/server/lib/otelTracer.ts` |
| `newrelic.noticeError(err)` | `recordError(err, attributes?)` | `src/server/lib/otelTracer.ts` |
| `newrelic.addCustomAttributes({...})` | `setSpanAttributes({...})` | `src/server/lib/otelTracer.ts` |
| `newrelic.startSegment('clickhouse:...', ...)` | `withChSegment(queryName, fn)` | `src/server/lib/withChSegment.ts` |
| `newrelic.js` config | `src/otel-instrumentation.js` + env vars | SDK bootstrap via OTLP |
| `NODE_OPTIONS='--require newrelic'` | `src/instrumentation.ts` (Next.js hook) | OTel SDK early load |

### For new observability work

- To audit gaps: `/audit-nr-observability`
- To add `recordError` to catch blocks: `/refactor-error-handler`
- Reference implementation: `src/server/lib/otelTracer.ts`
