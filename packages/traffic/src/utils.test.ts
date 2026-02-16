import { describe, it, expect } from 'vitest';
import { normalRandom, randomInt, editDistance, refineQuery } from './utils.js';

describe('utils', () => {
  describe('normalRandom', () => {
    it('should generate numbers around the mean', () => {
      const samples = Array.from({ length: 1000 }, () => normalRandom(100, 10));
      const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
      expect(avg).toBeGreaterThan(90);
      expect(avg).toBeLessThan(110);
    });

    it('should never return negative values', () => {
      const samples = Array.from({ length: 100 }, () => normalRandom(5, 10));
      expect(samples.every((s) => s >= 0)).toBe(true);
    });
  });

  describe('randomInt', () => {
    it('should return values within range', () => {
      for (let i = 0; i < 100; i++) {
        const val = randomInt(5, 10);
        expect(val).toBeGreaterThanOrEqual(5);
        expect(val).toBeLessThanOrEqual(10);
      }
    });
  });

  describe('editDistance', () => {
    it('should return 0 for identical strings', () => {
      expect(editDistance('hello', 'hello')).toBe(0);
    });

    it('should calculate single character changes', () => {
      expect(editDistance('hello', 'hallo')).toBe(1);
      expect(editDistance('cat', 'hat')).toBe(1);
    });

    it('should calculate insertions and deletions', () => {
      expect(editDistance('hello', 'helloo')).toBe(1);
      expect(editDistance('hello', 'hell')).toBe(1);
    });

    it('should calculate complex differences', () => {
      expect(editDistance('kitten', 'sitting')).toBe(3);
    });
  });

  describe('refineQuery', () => {
    it('should return a modified query', () => {
      // Run multiple times since it's random
      let modified = false;
      for (let i = 0; i < 10; i++) {
        const original = 'wireless headphones';
        const refined = refineQuery(original, 2);
        if (refined !== original) {
          modified = true;
          break;
        }
      }
      expect(modified).toBe(true);
    });
  });
});
