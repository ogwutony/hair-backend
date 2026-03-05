const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');
require('dotenv').config();

// Initializing Stripe with the Secret Key from your Render Environment variables
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const app = express();

app.use(express.json());
app.use(cors());

// --- DATABASE CONNECTION ---
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ SUCCESS: Connected to MongoDB Atlas"))
  .catch(err => console.error("❌ ERROR:", err.message));

// --- SCHEMAS ---
const User = mongoose.model('User', new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true }
}));

const Order = mongoose.model('Order', new mongoose.Schema({
  userEmail: { type: String, required: true },
  items: { type: Object, required: true },
  totalPrice: { type: Number, required: true },
  status: { type: String, default: 'Pending' },
  stripePaymentIntentId: String,
  createdAt: { type: Date, default: Date.now }
}));

// --- ROUTES ---

// Health Check
app.get('/', (req, res) => res.send('The Majority Backend is Live!'));

// SIGNUP ROUTE: Creates a new user and hashes the password
app.post('/api/signup', async (req, res) => {
  try {
    const { email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    await User.create({ email, password: hashedPassword });
    res.status(201).json({ message: "User created" });
  } catch (err) {
    res.status(400).json({ error: "Signup failed: Account may already exist" });
  }
});

// LOGIN ROUTE: Verifies credentials
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    res.json({ success: true, email: user.email });
  } catch (err) {
    res.status(500).json({ error: "Server error during login" });
  }
});

// STRIPE ROUTE: Creates the payment intent
app.post('/api/create-payment-intent', async (req, res) => {
  try {
    const { amount } = req.body;
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount),
      currency: 'usd',
      automatic_payment_methods: { enabled: true }
    });
    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- SERVER INITIALIZATION ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}...`));
