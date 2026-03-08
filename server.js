const express = require('express');
const app = express();
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Use the URI from your .env file
const MONGODB_URI = process.env.MONGODB_URI;

mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to Majority Hair Solutions MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// User Schema for storing sets
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  savedSets: [{
    items: Array,
    date: { type: Date, default: Date.now }
  }]
});
const User = mongoose.model('User', userSchema);

app.use(cors({ origin: 'http://localhost:3001' }));

// WEBHOOK ENDPOINT (Must handle raw body for signature verification)
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(`Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Logic: When payment is successful, save the formula
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    
    // Retrieve formula details from metadata sent during session creation
    const hairFormula = JSON.parse(session.metadata.hairFormula);
    const userEmail = session.customer_details.email;

    try {
      await User.findOneAndUpdate(
        { email: userEmail },
        { $push: { savedSets: { items: hairFormula } } },
        { upsert: true }
      );
      console.log(`Success: Saved formula for ${userEmail}`);
    } catch (dbError) {
      console.error("Database update failed:", dbError);
    }
  }

  res.json({ received: true });
});

app.use(express.json());

// Create Session with Metadata so the Webhook knows what was bought
app.post('/create-checkout-session', async (req, res) => {
  const { items, email, type } = req.body;
  try {
    const isSubscription = type === 'subscription';
    const priceData = {
      currency: 'usd',
      product_data: { name: 'Custom Hair Solution Set' },
      unit_amount: isSubscription ? 1999 : 2499,
    };
    if (isSubscription) {
      priceData.recurring = { interval: 'month' };
    }
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [{
        price_data: priceData,
        quantity: 1,
      }],
      mode: isSubscription ? 'subscription' : 'payment',
      // We pass the items as metadata so the webhook can read them later
      metadata: { hairFormula: JSON.stringify(items) },
      success_url: 'http://localhost:3001/orders',
      cancel_url: 'http://localhost:3001/cancel',
    });
    res.json({ id: session.id });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

const PORT = process.env.PORT || 4242;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));