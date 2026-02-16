import type { Product } from '@bot-arena/types';

export const products: Product[] = [
  {
    id: 'prod-001',
    name: 'Wireless Bluetooth Headphones',
    description: 'Premium over-ear headphones with active noise cancellation and 30-hour battery life.',
    price: 149.99,
    category: 'Electronics',
    inStock: true,
  },
  {
    id: 'prod-002',
    name: 'Mechanical Keyboard',
    description: 'RGB backlit mechanical keyboard with Cherry MX switches and programmable macros.',
    price: 129.99,
    category: 'Electronics',
    inStock: true,
  },
  {
    id: 'prod-003',
    name: 'Ergonomic Office Chair',
    description: 'Adjustable lumbar support, breathable mesh back, and 4D armrests.',
    price: 399.99,
    category: 'Furniture',
    inStock: true,
  },
  {
    id: 'prod-004',
    name: 'Smart Watch Pro',
    description: 'Fitness tracking, heart rate monitoring, GPS, and 7-day battery life.',
    price: 299.99,
    category: 'Electronics',
    inStock: false,
  },
  {
    id: 'prod-005',
    name: 'Standing Desk Converter',
    description: 'Height-adjustable desk riser with dual monitor support and cable management.',
    price: 249.99,
    category: 'Furniture',
    inStock: true,
  },
  {
    id: 'prod-006',
    name: 'Portable Power Bank',
    description: '20000mAh capacity with fast charging and USB-C power delivery.',
    price: 49.99,
    category: 'Electronics',
    inStock: true,
  },
  {
    id: 'prod-007',
    name: 'Noise-Canceling Earbuds',
    description: 'True wireless earbuds with ANC, transparency mode, and wireless charging case.',
    price: 179.99,
    category: 'Electronics',
    inStock: true,
  },
  {
    id: 'prod-008',
    name: 'Ultrawide Monitor 34"',
    description: 'Curved 34-inch ultrawide display with 144Hz refresh rate and HDR support.',
    price: 599.99,
    category: 'Electronics',
    inStock: true,
  },
  {
    id: 'prod-009',
    name: 'Webcam HD 1080p',
    description: 'Full HD webcam with autofocus, stereo microphones, and privacy shutter.',
    price: 79.99,
    category: 'Electronics',
    inStock: true,
  },
  {
    id: 'prod-010',
    name: 'USB-C Docking Station',
    description: 'Universal dock with dual 4K display support, 100W power delivery, and 10 ports.',
    price: 199.99,
    category: 'Electronics',
    inStock: false,
  },
];

export function searchProducts(query: string, page = 1, pageSize = 5): {
  products: Product[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
} {
  const lowerQuery = query.toLowerCase();
  const filtered = products.filter(
    (p) =>
      p.name.toLowerCase().includes(lowerQuery) ||
      p.description.toLowerCase().includes(lowerQuery) ||
      p.category.toLowerCase().includes(lowerQuery)
  );

  const total = filtered.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize;
  const paginated = filtered.slice(start, start + pageSize);

  return {
    products: paginated,
    total,
    page,
    pageSize,
    totalPages,
  };
}

export function getProductById(id: string): Product | undefined {
  return products.find((p) => p.id === id);
}

export function listProducts(page = 1, pageSize = 5, category?: string): {
  products: Product[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
} {
  let filtered = products;
  if (category) {
    filtered = products.filter((p) => p.category.toLowerCase() === category.toLowerCase());
  }

  const total = filtered.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize;
  const paginated = filtered.slice(start, start + pageSize);

  return {
    products: paginated,
    total,
    page,
    pageSize,
    totalPages,
  };
}
