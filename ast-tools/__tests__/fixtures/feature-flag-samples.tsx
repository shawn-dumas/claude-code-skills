/* eslint-disable */
// Fixture file for ast-feature-flags tests. Contains intentional feature flag usage patterns.

// --- FLAG_HOOK_CALL: useFeatureFlags ---
function DashboardContainer() {
  const { featureFlags } = usePosthogContext();

  // --- FLAG_READ: property access on featureFlags ---
  const isInsightsEnabled = featureFlags.insights_chat_enabled;

  // --- PAGE_GUARD: useFeatureFlagPageGuard ---
  useFeatureFlagPageGuard('enable_realtime_insights');

  // --- CONDITIONAL_RENDER: ternary on flag ---
  return (
    <div>
      {featureFlags.systems_insights_enabled ? <SystemsPanel /> : <Placeholder />}
      {featureFlags.enable_details && <DetailsPanel />}
    </div>
  );
}

// --- FLAG_HOOK_CALL: useFeatureFlags direct ---
function SettingsContainer() {
  const featureFlags = useFeatureFlags();

  // --- FLAG_READ: another property access ---
  const showSystems = featureFlags.systems_insights_enabled;

  return <div>{showSystems && <SystemsPanel2 />}</div>;
}

// --- NAV_TAB_GATE: object literal with featureFlag property ---
const navigationTabs = [
  {
    label: 'Systems',
    path: '/insights/systems',
    featureFlag: 'systems_insights_enabled',
  },
  {
    label: 'Relay Usage',
    path: '/insights/relay-usage',
    featureFlag: 'relay_usage_insights_enabled',
  },
  {
    label: 'Settings',
    path: '/settings',
  },
];

// --- FLAG_OVERRIDE: dev helpers ---
function DevToolsPanel() {
  const handleSetFlags = () => {
    __setFeatureFlags({ insights_chat_enabled: true });
  };
  const handleClearFlags = () => {
    __clearFeatureFlags();
  };
  return <button onClick={handleSetFlags}>Set Flags</button>;
}
