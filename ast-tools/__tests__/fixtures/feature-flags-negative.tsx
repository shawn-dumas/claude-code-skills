/* eslint-disable */
// Negative fixture file for ast-feature-flags tests.
// Documents edge cases and false-positive scenarios.

// 1. Variable named 'featureFlags' that is not from PostHog
// Should NOT be FLAG_READ (no flag hook binding source)
const featureFlags = { darkMode: true, experimentalFeature: false };
if (featureFlags.darkMode) {
  // Not from a flag hook, so should not be detected as FLAG_READ
}
const isDarkMode = featureFlags.darkMode;

// 2. useFeatureFlags from a different library
// SHOULD be FLAG_HOOK_CALL (observation reports it; the skill
// can check the import source to determine if it's the real one)
import { useFeatureFlags } from 'some-other-lib';
function OtherLibComponent() {
  const flags = useFeatureFlags();
  // The tool cannot distinguish library sources from hook name alone
  // Observations report what they see; interpretation is separate
  return <div>{flags.someFlag && <span>Feature</span>}</div>;
}

// 3. Property named 'featureFlag' in a non-tab context
// The tool detects based on property name pattern only
// It cannot determine if this is a tab definition vs other config
const config = { featureFlag: 'someFlag', otherProp: true };
const menuItem = { label: 'Test', featureFlag: 'test_feature' };

// 4. usePosthogContext without destructuring featureFlags
// Should NOT be FLAG_HOOK_CALL
function ComponentWithoutFeatureFlags() {
  const { analytics, track } = usePosthogContext();
  // featureFlags not destructured, so no FLAG_HOOK_CALL
  return null;
}

// 5. usePosthogContext result stored without destructuring
// Should NOT be FLAG_HOOK_CALL
function ComponentWithStoredContext() {
  const posthogContext = usePosthogContext();
  // Direct assignment, not destructuring featureFlags
  return null;
}

// 6. featureFlag as a regular variable name
// Should NOT be NAV_TAB_GATE (not a property assignment)
const featureFlag = 'some_flag_name';
function getFeatureFlag() {
  return featureFlag;
}

// 7. __setFeatureFlags as a user-defined function (not the dev helper)
// SHOULD be FLAG_OVERRIDE (observation reports call site)
function __setFeatureFlags(flags: Record<string, boolean>) {
  // User-defined function with same name
  console.log('Setting flags:', flags);
}

// 8. Conditional render not on featureFlags binding
// Should NOT be CONDITIONAL_RENDER
function ComponentWithOtherCondition() {
  const isEnabled = true;
  return <div>{isEnabled && <span>Enabled</span>}</div>;
}
