import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: vi.fn() }));
vi.mock('@/providers/posthogProvider', () => ({ usePosthogContext: vi.fn() }));

describe('useFeatureFlagPageGuard', () => {
  beforeEach(() => { vi.mocked(stableRouter.replace).mockClear(); });
  describe('when feature flag is false', () => {
    it('should redirect to home when feature flag is explicitly false', () => {
      expect(stableRouter.replace).toHaveBeenCalledWith('/home');
      expect(stableRouter.replace).toHaveBeenCalledTimes(1);
    });
  });
  describe('when feature flag is true', () => {
    it('should not redirect when feature flag is true', () => {
      expect(stableRouter.replace).not.toHaveBeenCalled();
    });
    it('should not redirect when feature flag is undefined', () => {
      expect(stableRouter.replace).not.toHaveBeenCalled();
    });
  });
  describe('feature flag changes', () => {
    it('should trigger redirect when feature flag changes from true to false', () => {
      expect(stableRouter.replace).toHaveBeenCalledWith('/home');
      expect(stableRouter.replace).toHaveBeenCalledTimes(1);
    });
  });
  describe('different feature flag keys', () => {
    it('should only redirect for the specific feature flag being guarded', () => {
      expect(stableRouter.replace).not.toHaveBeenCalled();
    });
  });
  describe('edge cases', () => {
    it('should handle empty featureFlags object', () => {
      expect(stableRouter.replace).not.toHaveBeenCalled();
    });
  });
});