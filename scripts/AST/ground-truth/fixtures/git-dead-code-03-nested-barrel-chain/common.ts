/**
 * Stripped from src/shared/types/common.ts
 * Environment is consumed externally. RuleOption is consumed only in one file.
 * InternalConfig is genuinely dead -- not consumed by anything.
 */
export const Environment = {
  MOCKED: 'mocked',
  LOCAL: 'local',
  DEVELOPMENT: 'development',
  STAGING: 'staging',
  PRODUCTION: 'production',
} as const;

export type Environment = (typeof Environment)[keyof typeof Environment];

export interface RuleOption<T> {
  value: T;
  name: string;
}

/** Dead type -- not consumed anywhere in the fixture graph */
export interface InternalConfig {
  retryCount: number;
  timeoutMs: number;
}
