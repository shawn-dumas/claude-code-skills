# Database Schema Migration Plan

> Complexity: D5 S4 Z4 = 4.3
> Duration: F3 C2 = 6h (3-12h)
> Nearest: BFF Audit Fix (3.3)
> Branch: sd/db-schema-migration
> Created: 2026-03-16
> Pre-flight: CERTIFIED 2026-03-16

## Overview

Sequential database schema migration.

| # | Prompt | Mode | Depends On |
|---|--------|------|------------|
| 01 | Add user_preferences table | Auto | -- |
| 02 | Add notification_settings FK | Auto | 01 |
| 03 | Migrate existing preferences data | Auto | 02 |
| 04 | Add API endpoints for preferences | Auto | 03 |

## Verification Checklist

```bash
pnpm tsc --noEmit
pnpm test:integration
```

## Cleanup

Accumulated items go to `db-migration-cleanup.md`.
