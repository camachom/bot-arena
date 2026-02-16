import { Router, type Router as RouterType } from 'express';
import { products, searchProducts, getProductById, listProducts } from '../data/products.js';

export const productsRouter: RouterType = Router();

// List all products with pagination
productsRouter.get('/', (req, res) => {
  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.pageSize as string) || 5;
  const category = req.query.category as string | undefined;

  const result = listProducts(page, pageSize, category);
  res.json(result);
});

// Search products
productsRouter.get('/search', (req, res) => {
  const query = (req.query.q as string) || '';
  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.pageSize as string) || 5;

  if (!query) {
    res.status(400).json({ error: 'Search query required' });
    return;
  }

  const result = searchProducts(query, page, pageSize);
  res.json(result);
});

// Get single product
productsRouter.get('/:id', (req, res) => {
  const product = getProductById(req.params.id);
  if (!product) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }
  res.json(product);
});

// Categories endpoint
productsRouter.get('/meta/categories', (_req, res) => {
  const categories = [...new Set(products.map((p) => p.category))];
  res.json({ categories });
});
