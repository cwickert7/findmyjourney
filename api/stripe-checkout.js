// FILE: api/stripe-checkout.js
// Creates a Stripe Checkout session for individual Explorer credit purchase

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { priceId, email } = req.body;
  if (!priceId) return res.status(400).json({ error: 'Missing priceId' });

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Stripe not configured' });

  const SITE_URL = process.env.SITE_URL || 'https://findmyjourney.com.au';

  // Valid price IDs — set these after creating products in Stripe dashboard
  const VALID_PRICES = [
    process.env.STRIPE_PRICE_3_CREDITS,  // $15 for 3 credits
    process.env.STRIPE_PRICE_1_CREDIT    // $7 for 1 credit
  ].filter(Boolean);

  if (VALID_PRICES.length > 0 && !VALID_PRICES.includes(priceId)) {
    return res.status(400).json({ error: 'Invalid price' });
  }

  try {
    const body = new URLSearchParams({
      'mode': 'payment',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      'success_url': `${SITE_URL}/assessment?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      'cancel_url': `${SITE_URL}/assessment?payment=cancelled`,
      'billing_address_collection': 'auto',
      'invoice_creation[enabled]': 'true',
      'payment_intent_data[description]': 'Find My Journey — Explorer Credits',
      'metadata[site]': 'findmyjourney'
    });

    // Pre-fill email if provided
    if (email && email.includes('@')) {
      body.append('customer_email', email);
    }

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    });

    const session = await response.json();

    if (!response.ok) {
      console.error('Stripe checkout error:', session.error);
      return res.status(500).json({ error: session.error?.message || 'Failed to create checkout session' });
    }

    return res.status(200).json({ url: session.url, sessionId: session.id });

  } catch(e) {
    console.error('stripe-checkout error:', e.message);
    return res.status(500).json({ error: 'Payment setup failed. Please try again.' });
  }
}
