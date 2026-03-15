import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: vi.fn() }));
vi.mock('@/providers/posthogProvider', () => ({ usePosthogContext: vi.fn() }));
describe('useFeatureFlagPageGuard', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  describe('when feature flag is false', () => {
    it('should redirect to home when feature flag is explicitly false', () => {
      expect(mockReplace).toHaveBeenCalledWith('/home');
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(homeUrl).toHaveBeenCalled();
    });
  });
  describe('when feature flag is true', () => {
    it('should not redirect when feature flag is true', () => {
      expect(mockReplace).not.toHaveBeenCalled();
    });
    it('should not redirect when feature flag is undefined', () => {
      expect(mockReplace).not.toHaveBeenCalled();
    });
    it('should not redirect when feature flag is null', () => {
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });
  describe('feature flag changes', () => {
    it('should trigger redirect when flag changes from true to false', () => {
      expect(mockReplace).toHaveBeenCalledWith('/home');
      expect(mockReplace).toHaveBeenCalledTimes(1);
    });
  });
  describe('different feature flag keys', () => {
    it('should handle string-based feature flags', () => {
      expect(mockReplace).toHaveBeenCalledWith('/home');
    });
  });
  describe('edge cases', () => {
    it('should handle empty featureFlags object', () => {
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });
});