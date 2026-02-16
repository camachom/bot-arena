import { describe, it, expect } from 'vitest';
import type { Policy, RequestLog, SessionFeatures } from '@bot-arena/types';
import { extractFeatures, calculateScore, determineAction } from './detector.js';

describe('detector', () => {
  const defaultPolicy: Policy = {
    features: {
      reqs_per_min: { weight: 1.5, threshold: 20 },
      unique_queries_per_hour: { weight: 2.0, threshold: 30 },
      pagination_ratio: { weight: 1.2, threshold: 0.6 },
      session_depth: { weight: 1.0, threshold: 5 },
      dwell_time_avg: { weight: 1.8, threshold: 2000 },
      timing_variance: { weight: 3.0, threshold: 0.4 },
      asset_warmup_missing: { weight: 3.0 },
      mouse_movement_entropy: { weight: 4.0, threshold: 2.0 },
      dwell_vs_content_length: { weight: 3.5, threshold: 0.3 },
    },
    actions: {
      allow: { max_score: 3 },
      throttle: { max_score: 5 },
      challenge: { max_score: 8 },
      block: { max_score: 999 },
    },
    constraints: {
      max_false_positive_rate: 0.01,
    },
  };

  describe('extractFeatures', () => {
    it('should return zero features for empty logs', () => {
      const features = extractFeatures('session-1', []);
      expect(features.reqs_per_min).toBe(0);
      expect(features.unique_queries_per_hour).toBe(0);
      expect(features.pagination_ratio).toBe(0);
      expect(features.session_depth).toBe(0);
      expect(features.dwell_time_avg).toBe(0);
      expect(features.asset_warmup_missing).toBe(false);
    });

    it('should calculate requests per minute', () => {
      const now = Date.now();
      const logs: RequestLog[] = [
        { sessionId: 's1', timestamp: now - 30000, path: '/api/products', method: 'GET', query: {}, userAgent: '', isAssetRequest: false },
        { sessionId: 's1', timestamp: now - 20000, path: '/api/products', method: 'GET', query: {}, userAgent: '', isAssetRequest: false },
        { sessionId: 's1', timestamp: now - 10000, path: '/api/products', method: 'GET', query: {}, userAgent: '', isAssetRequest: false },
      ];
      const features = extractFeatures('s1', logs);
      expect(features.reqs_per_min).toBe(3);
    });

    it('should calculate unique queries per hour', () => {
      const now = Date.now();
      const logs: RequestLog[] = [
        { sessionId: 's1', timestamp: now - 1000, path: '/api/search', method: 'GET', query: { q: 'headphones' }, userAgent: '', isAssetRequest: false },
        { sessionId: 's1', timestamp: now - 2000, path: '/api/search', method: 'GET', query: { q: 'keyboard' }, userAgent: '', isAssetRequest: false },
        { sessionId: 's1', timestamp: now - 3000, path: '/api/search', method: 'GET', query: { q: 'headphones' }, userAgent: '', isAssetRequest: false },
      ];
      const features = extractFeatures('s1', logs);
      expect(features.unique_queries_per_hour).toBe(2);
    });

    it('should detect missing asset warmup', () => {
      const now = Date.now();
      const logs: RequestLog[] = [
        { sessionId: 's1', timestamp: now - 1000, path: '/api/products', method: 'GET', query: {}, userAgent: '', isAssetRequest: false },
        { sessionId: 's1', timestamp: now - 2000, path: '/api/products/1', method: 'GET', query: {}, userAgent: '', isAssetRequest: false },
        { sessionId: 's1', timestamp: now - 3000, path: '/api/search', method: 'GET', query: { q: 'test' }, userAgent: '', isAssetRequest: false },
      ];
      const features = extractFeatures('s1', logs);
      expect(features.asset_warmup_missing).toBe(true);
    });

    it('should not flag asset warmup missing if assets loaded', () => {
      const now = Date.now();
      const logs: RequestLog[] = [
        { sessionId: 's1', timestamp: now - 1000, path: '/api/products', method: 'GET', query: {}, userAgent: '', isAssetRequest: false },
        { sessionId: 's1', timestamp: now - 2000, path: '/assets/style.css', method: 'GET', query: {}, userAgent: '', isAssetRequest: true },
        { sessionId: 's1', timestamp: now - 3000, path: '/api/search', method: 'GET', query: { q: 'test' }, userAgent: '', isAssetRequest: false },
      ];
      const features = extractFeatures('s1', logs);
      expect(features.asset_warmup_missing).toBe(false);
    });
  });

  describe('calculateScore', () => {
    it('should return 0 for normal human-like features', () => {
      const features: SessionFeatures = {
        sessionId: 's1',
        reqs_per_min: 5,
        unique_queries_per_hour: 3,
        pagination_ratio: 0.3,
        session_depth: 2,
        dwell_time_avg: 5000,
        timing_variance: 0.6,  // human-like variance
        asset_warmup_missing: false,
        mouse_movement_entropy: 3.0,  // human-like high entropy
        dwell_vs_content_length: 0.7,  // human-like high correlation
      };
      const { score, triggered } = calculateScore(features, defaultPolicy);
      expect(score).toBe(0);
      expect(triggered).toHaveLength(0);
    });

    it('should flag high request rate', () => {
      const features: SessionFeatures = {
        sessionId: 's1',
        reqs_per_min: 50,
        unique_queries_per_hour: 3,
        pagination_ratio: 0.3,
        session_depth: 2,
        dwell_time_avg: 5000,
        timing_variance: 0.6,  // human-like variance
        asset_warmup_missing: false,
        mouse_movement_entropy: 3.0,
        dwell_vs_content_length: 0.7,
      };
      const { score, triggered } = calculateScore(features, defaultPolicy);
      expect(score).toBe(1.5);
      expect(triggered).toContain('reqs_per_min');
    });

    it('should flag missing assets with high weight', () => {
      const features: SessionFeatures = {
        sessionId: 's1',
        reqs_per_min: 5,
        unique_queries_per_hour: 3,
        pagination_ratio: 0.3,
        session_depth: 2,
        dwell_time_avg: 5000,
        timing_variance: 0.6,  // human-like variance
        asset_warmup_missing: true,
        mouse_movement_entropy: 3.0,
        dwell_vs_content_length: 0.7,
      };
      const { score, triggered } = calculateScore(features, defaultPolicy);
      expect(score).toBe(3.0);
      expect(triggered).toContain('asset_warmup_missing');
    });

    it('should accumulate multiple signals', () => {
      const features: SessionFeatures = {
        sessionId: 's1',
        reqs_per_min: 50,
        unique_queries_per_hour: 50,
        pagination_ratio: 0.8,
        session_depth: 10,
        dwell_time_avg: 500,
        timing_variance: 0.2,  // bot-like low variance
        asset_warmup_missing: true,
        mouse_movement_entropy: 0.5,  // bot-like low entropy
        dwell_vs_content_length: 0.1,  // bot-like low correlation
      };
      const { score, triggered } = calculateScore(features, defaultPolicy);
      // 1.5 + 2.0 + 1.2 + 1.0 + 1.8 + 3.0 + 3.0 + 4.0 + 3.5 = 21.0
      expect(score).toBe(21);
      expect(triggered).toHaveLength(9);
    });
  });

  describe('determineAction', () => {
    it('should allow low scores', () => {
      expect(determineAction(0, defaultPolicy)).toBe('allow');
      expect(determineAction(2.9, defaultPolicy)).toBe('allow');
    });

    it('should throttle medium scores', () => {
      expect(determineAction(3.1, defaultPolicy)).toBe('throttle');
      expect(determineAction(4.9, defaultPolicy)).toBe('throttle');
    });

    it('should challenge high scores', () => {
      expect(determineAction(5.1, defaultPolicy)).toBe('challenge');
      expect(determineAction(7.9, defaultPolicy)).toBe('challenge');
    });

    it('should block very high scores', () => {
      expect(determineAction(8.1, defaultPolicy)).toBe('block');
      expect(determineAction(100, defaultPolicy)).toBe('block');
    });
  });
});
