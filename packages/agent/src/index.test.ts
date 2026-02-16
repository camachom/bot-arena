import { describe, it, expect } from 'vitest';

describe('agent', () => {
  it('should export getRedProposal', async () => {
    const { getRedProposal } = await import('./index.js');
    expect(typeof getRedProposal).toBe('function');
  });

  it('should export getBlueProposal', async () => {
    const { getBlueProposal } = await import('./index.js');
    expect(typeof getBlueProposal).toBe('function');
  });
});
