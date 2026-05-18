// FILE: api/stripe-config.js
// Returns public Stripe configuration (price IDs) to the frontend
// Secret key is never exposed — only price IDs which are non-sensitive

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  return res.status(200).json({
    price3: process.env.STRIPE_PRICE_3_CREDITS || null,
    price1: process.env.STRIPE_PRICE_1_CREDIT || null
  });
}
