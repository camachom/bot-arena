// Normal distribution using Box-Muller transform
export function normalRandom(mean: number, stdDev: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, mean + z * stdDev);
}

export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randomJitter(range: [number, number]): number {
  return randomInt(range[0], range[1]);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Edit distance for query refinement
export function editDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[a.length][b.length];
}

// Generate refined search query (similar to original)
export function refineQuery(original: string, maxEditDistance: number): string {
  const words = original.split(' ');
  const operations = ['add', 'remove', 'modify'];
  const operation = pickRandom(operations);

  switch (operation) {
    case 'add': {
      const additions = ['pro', 'best', 'cheap', 'new', 'premium'];
      return `${pickRandom(additions)} ${original}`;
    }
    case 'remove': {
      if (words.length > 1) {
        words.splice(randomInt(0, words.length - 1), 1);
        return words.join(' ');
      }
      return original;
    }
    case 'modify': {
      if (words.length > 0) {
        const idx = randomInt(0, words.length - 1);
        // Simple modification: add/remove a character
        const word = words[idx];
        if (word.length > 3) {
          words[idx] = word.slice(0, -1);
        } else {
          words[idx] = word + 's';
        }
        return words.join(' ');
      }
      return original;
    }
    default:
      return original;
  }
}

// Sample search queries for bots
export const sampleQueries = [
  'headphones',
  'keyboard',
  'monitor',
  'webcam',
  'chair',
  'desk',
  'wireless',
  'bluetooth',
  'ergonomic',
  'mechanical',
  'usb',
  'power bank',
  'smart watch',
  'earbuds',
  'docking station',
];
