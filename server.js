const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const axios = require('axios');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');
const cookieParser = require('cookie-parser');
require('dotenv').config();

// Cloudinary Configurationh
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Upload a buffer to Cloudinary using a stream
const uploadToCloudinary = (buffer) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'user_media', resource_type: 'auto' },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    Readable.from(buffer).pipe(stream);
  });
};

// Validate critical environment variables
if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("⚠️ WARNING: STRIPE_SECRET_KEY is not defined in .env");
}

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const app = express();

// --- SUBSCRIPTION CONSTANTS ---
const SUBSCRIPTION_PLAN_3_MONTH   = '3-month-sub';
const SUBSCRIPTION_STATUS_ACTIVE  = 'active_3_month';
const REQUIRED_FORMULA_PRODUCTS   = 6;
const INITIAL_SHIPMENT_COUNT      = 1;

// --- STRIPE WEBHOOK ---
// Must be registered BEFORE express.json() so that the raw body is available for
// signature verification. express.raw() captures the body as a Buffer.
app.post('/api/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('⚠️ STRIPE_WEBHOOK_SECRET is not configured');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('⚠️ Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    try {
      const customerDetails = session.customer_details || {};
      const shippingDetails = session.shipping_details || {};

      const email = typeof customerDetails.email === 'string'
        ? customerDetails.email.toLowerCase()
        : null;

      if (!email) {
        console.warn('⚠️ checkout.session.completed received without customer email');
        return res.status(200).json({ received: true });
      }

      // Build the address object from the Stripe shipping payload
      const addr = shippingDetails.address || {};
      const shippingAddress = {
        name:        shippingDetails.name        || customerDetails.name  || null,
        phone:       customerDetails.phone                                 || null,
        line1:       addr.line1        || null,
        line2:       addr.line2        || null,
        city:        addr.city         || null,
        state:       addr.state        || null,
        postal_code: addr.postal_code  || null,
        country:     addr.country      || null,
      };

      await User.findOneAndUpdate(
        { email },
        {
          shippingAddress,
          subscriptionPlan:   SUBSCRIPTION_PLAN_3_MONTH,
          subscriptionStatus: SUBSCRIPTION_STATUS_ACTIVE,
        }
      );

      console.log(`✅ Webhook: subscription updated for ${email}`);
    } catch (dbErr) {
      console.error('❌ Webhook DB update failed:', dbErr.message);
      // Return 200 so Stripe does not retry — the error is logged for investigation
      return res.status(200).json({ received: true, warning: 'db_update_failed' });
    }
  }

  res.status(200).json({ received: true });
});

// --- SHOPIFY WEBHOOK ---
// Must be registered BEFORE express.json() so that the raw body is available for
// HMAC signature verification. express.raw() captures the body as a Buffer.
app.post('/api/webhooks/shopify/orders-create', express.raw({ type: 'application/json' }), async (req, res) => {
  const shopifySecret = process.env.SHOPIFY_WEBHOOK_SECRET;

  if (!shopifySecret) {
    console.error('⚠️ SHOPIFY_WEBHOOK_SECRET is not configured');
    return res.status(500).json({ error: 'Shopify webhook secret not configured' });
  }

  // Verify Shopify HMAC signature
  const hmacHeader = req.headers['x-shopify-hmac-sha256'];
  if (!hmacHeader) {
    return res.status(401).json({ error: 'Missing Shopify HMAC header' });
  }

  const generatedHmac = crypto
    .createHmac('sha256', shopifySecret)
    .update(req.body)
    .digest('base64');

  if (generatedHmac !== hmacHeader) {
    console.error('⚠️ Shopify webhook HMAC verification failed');
    return res.status(401).json({ error: 'Shopify webhook HMAC verification failed' });
  }

  let order;
  try {
    order = JSON.parse(req.body.toString('utf8'));
  } catch (parseErr) {
    console.error('⚠️ Failed to parse Shopify order payload:', parseErr.message);
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  // Only award points for fully paid orders
  if (order.financial_status !== 'paid') {
    return res.status(200).json({ received: true, skipped: 'order_not_paid' });
  }

  const email = typeof order.email === 'string' ? order.email.toLowerCase() : null;
  if (!email) {
    console.warn('⚠️ Shopify orders/create received without customer email');
    return res.status(200).json({ received: true, skipped: 'no_customer_email' });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      // Not a registered user — acknowledge and move on
      return res.status(200).json({ received: true, skipped: 'user_not_found' });
    }

    // Validate total_price before processing
    const parsedPrice = parseFloat(order.total_price);
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      console.warn(`⚠️ Shopify webhook: invalid total_price "${order.total_price}" for order ${order.id}`);
      return res.status(200).json({ received: true, warning: 'invalid_total_price' });
    }

    // Use integer arithmetic on cents to avoid floating-point precision errors
    const totalCents = Math.round(parsedPrice * 100);
    const pointsPerDollar = parseInt(process.env.SHOPIFY_POINTS_PER_DOLLAR, 10) || 100;
    const pointsToAward = Math.floor(totalCents * pointsPerDollar / 100);

    if (pointsToAward > 0) {
      await updateRankScore(user._id, pointsToAward);
      // Record the processed order for idempotency — the unique index on orderId prevents
      // duplicate awards even under concurrent webhook deliveries (duplicate key error = already processed)
      try {
        await ShopifyWebhookEvent.create({ orderId: String(order.id), email, pointsAwarded: pointsToAward });
      } catch (dupErr) {
        if (dupErr.code === 11000) {
          // Another concurrent delivery already processed this order; points were already awarded above.
          // This is safe because updateRankScore applies an additive delta; log and move on.
          console.warn(`⚠️ Shopify webhook: duplicate delivery detected for order ${order.id}, ignoring`);
        } else {
          throw dupErr;
        }
      }
      console.log(`✅ Shopify webhook: awarded ${pointsToAward} points to ${email} for order ${order.id} ($${order.total_price})`);
    }
  } catch (dbErr) {
    console.error('❌ Shopify webhook DB update failed:', dbErr.message);
    // Return 200 so Shopify does not retry — the error is logged for investigation
    return res.status(200).json({ received: true, warning: 'db_update_failed' });
  }

  res.status(200).json({ received: true });
});

// Middleware
app.use(express.json());
app.use(cookieParser());

// CORS Configuration - Allows multiple origins
const allowedOrigins = [
    'https://themajorities.com',
    'https://www.themajorities.com',
    'https://majorityhairsolutions.com',
    'https://www.majorityhairsolutions.com',
    'https://themajority.com',
    'https://www.themajority.com',
    'https://themajoritysolutions.com',
    'https://themajorityfacesolution.com',
    'https://www.themajorityfacesolution.com',
    'https://themajoritiessolution.com',
    'https://www.themajoritiessolution.com',
    'https://hair-frontend-2.vercel.app',
    /^https:\/\/majority-hair-frontend-[a-z0-9-]+\.vercel\.app$/, // Regex for Vercel preview URLs
    'http://localhost:3000' // For local development
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    const isAllowed = allowedOrigins.some((pattern) => {
      return pattern instanceof RegExp ? pattern.test(origin) : pattern === origin;
    });

    if (isAllowed) {
      return callback(null, true);
    } else {
      return callback(new Error('Not allowed by CORS'), false);
    }
  },
  credentials: true, // Required if you are sending cookies or Authorization headers
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
}));

// File upload configuration
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 52428800 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// Avatar-specific upload: JPG/PNG only, 5MB max
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5242880 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG and PNG images are allowed for profile pictures'));
    }
  }
});

// --- DATABASE ---
const MONGODB_URI = process.env.MONGODB_URI;
if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI)
    .then(() => console.log("✅ Connected to MongoDB Atlas"))
    .catch(err => console.error("❌ DB Error:", err.message));
} else {
  console.error("❌ Error: MONGODB_URI is missing from environment variables.");
}

// --- RANK TIER SYSTEM (10-Million Scale) ---
const RANK_TIERS = [
  { title: "General Secretary",           min: 8500001, max: 10000000 },
  { title: "Premier",                     min: 7000001, max: 8500000  },
  { title: "Head of State",               min: 5500001, max: 7000000  },
  { title: "Politburo",                   min: 4000001, max: 5500000  },
  { title: "Party National",              min: 2500001, max: 4000000  },
  { title: "Central committee",           min: 1000001, max: 2500000  },
  { title: "Councils of ministers",       min: 500001,  max: 1000000  },
  { title: "Supreme soviets",             min: 250000,  max: 500000   },
  { title: "Republican Party committeemen", min: 160000, max: 249999  },
  { title: "Regional party head",         min: 80000,   max: 159999   },
  { title: "City Party Head",             min: 40000,   max: 79999    },
  { title: "District Party head",         min: 20000,   max: 39999    },
  { title: "District Soviet",             min: 10000,   max: 19999    },
  { title: "Executive",                   min: 5000,    max: 9999     },
  { title: "Department head",             min: 2500,    max: 4999     },
  { title: "enterprises",                 min: 2000,    max: 2499     },
  { title: "Executive",                   min: 1500,    max: 1999     },
  { title: "Department head",             min: 1250,    max: 1499     },
  { title: "enterprises",                 min: 1000,    max: 1249     },
  { title: "Partymember",                 min: 800,     max: 999      },
  { title: "bold carp",                   min: 500,     max: 799      },
  { title: "crucian carp",                min: 250,     max: 499      },
  { title: "elephants",                   min: 160,     max: 249      },
  { title: "Small elephants",             min: 80,      max: 159      },
  { title: "godok",                       min: 40,      max: 79       },
  { title: "podgodok",                    min: 20,      max: 39       },
  { title: "one-and-a-half",              min: 10,      max: 19       },
  { title: "bolshevik",                   min: 1,       max: 9        },
];

const POLITBURO_MIN = 4000001; // Politburo rank minimum score

const getRankTitle = (score) => {
  for (const tier of RANK_TIERS) {
    if (score >= tier.min) return tier.title;
  }
  return "bolshevik";
};

const getRankRange = (title) => {
  const tier = RANK_TIERS.find(t => t.title === title);
  if (!tier) return "1 - 9";
  return `${tier.min.toLocaleString()} - ${tier.max.toLocaleString()}`;
};

const isPolitburoOrHigher = (score) => score >= POLITBURO_MIN;

// Premium Partner threshold — users must reach 10,000,000 points to access partner features
const PARTNER_PREMIUM_MIN = 10000000;

// Middleware: requires the authenticated user to hold Partner Premium rank (≥ 10,000,000 points)
const requirePartnerPremium = async (req, res, next) => {
  // Depends on authMiddleware having run first to populate req.user
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const score = req.user.rank_score || 0;
  if (score < PARTNER_PREMIUM_MIN) {
    return res.status(403).json({
      error: 'Access denied. Partner Premium features require 10,000,000 points.',
      current_score: score,
      required_score: PARTNER_PREMIUM_MIN
    });
  }
  next();
};

// --- MongoDB Models API Integration ---
const MONGODB_MODELS_API_KEY = process.env.MONGODB_MODELS_API_KEY;
const MONGODB_MODELS_BASE_URL = 'https://api.mongodb.com/app/data/v1';

if (MONGODB_MODELS_API_KEY) {
  console.log("✅ MongoDB Models API Key configured");
} else {
  console.warn("⚠️ WARNING: MONGODB_MODELS_API_KEY is not defined in environment variables");
}

// Initialize MongoDB Models API client
const mongoDBModelsClient = {
  async callModel(modelId, inputs) {
    if (!MONGODB_MODELS_API_KEY) {
      throw new Error('MongoDB Models API Key not configured');
    }
    try {
      const response = await axios.post(`${MONGODB_MODELS_BASE_URL}/models/${modelId}/infer`, 
        { inputs },
        {
          headers: {
            'Authorization': `Bearer ${MONGODB_MODELS_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      return response.data;
    } catch (error) {
      console.error('MongoDB Models API Error:', error.response?.data || error.message);
      throw new Error('Failed to call MongoDB Model: ' + error.message);
    }
  },

  // Helper: Generate hair care recommendation based on user profile
  async generateRecommendation(userProfile) {
    try {
      // This endpoint uses a model that analyzes hair type, needs, preferences
      const response = await axios.post(
        `${MONGODB_MODELS_BASE_URL}/models/hair-recommendation/infer`,
        {
          inputs: {
            hairType: userProfile.hairType || 'unspecified',
            concerns: userProfile.concerns || [],
            preferredIngredients: userProfile.preferredIngredients || [],
            budget: userProfile.budget || 'moderate'
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${MONGODB_MODELS_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      return response.data;
    } catch (error) {
      console.error('Recommendation API Error:', error.message);
      throw error;
    }
  }
};

// --- SCHEMAS ---
const userSchema = new mongoose.Schema({
  email:            { type: String, required: true, unique: true },
  password:         { type: String },
  googleId:         { type: String },
  resetToken:       { type: String },
  resetTokenExpiry: { type: Date },
  rank_score:       { type: Number, default: 1 },   // BigInt-scale (up to 10,000,000)
  rank_title:       { type: String, default: 'bolshevik' },
  rank_rewards_sent: { type: [String], default: [] }, // Track which ranks already rewarded
  avatarUrl: { type: String, default: null }, // Profile avatar image URL
  profilePictureUrl: { type: String, default: null }, // Profile picture URL (canonical)
  
  // Profile perspectives (4-box layout)
  perspective: {
    box1: { content: String, mediaUrls: [String], videoUrl: String, updatedAt: Date },
    box2: { content: String, mediaUrls: [String], videoUrl: String, updatedAt: Date },
    box3: { content: String, mediaUrls: [String], videoUrl: String, updatedAt: Date },
    box4: { content: String, mediaUrls: [String], videoUrl: String, updatedAt: Date },
  },
  
  // Social media links
  socialLinks: {
    instagram: String,
    tiktok: String,
    facebook: String,
    updatedAt: Date
  },

  // Subscription / 90-day formula tracking
  currentFormula:     { type: [String], default: [] },
  subscriptionStatus: { type: String, default: null },
  subscriptionPlan:   { type: String, default: null },
  shipmentCount:      { type: Number, default: INITIAL_SHIPMENT_COUNT },
  shippingAddress: {
    name:        String,
    phone:       String,
    line1:       String,
    line2:       String,
    city:        String,
    state:       String,
    postal_code: String,
    country:     String,
  },


  // OAuth tokens for social publishing (Share to Socials feature)
  socialTokens: {
    instagram: {
      accessToken: String,
      expiresAt: Date,
      instagramBusinessAccountId: String
    },
    tiktok: {
      accessToken: String,
      refreshToken: String,
      expiresAt: Date,
      openId: String
    },
    facebook: {
      accessToken: String,
      expiresAt: Date,
      pageOrUserId: String
    }
  }
});
const User = mongoose.model('User', userSchema);

const Order = mongoose.model('Order', new mongoose.Schema({
  userEmail:             { type: String, required: true },
  items:                 { type: Object, required: true },
  totalPrice:            { type: Number, required: true },
  status:                { type: String, default: 'Pending' },
  stripePaymentIntentId: String,
  createdAt:             { type: Date, default: Date.now }
}));

// Duma (formerly Legislature) submissions
const dumaSchema = new mongoose.Schema({
  type:       { type: String, required: true, enum: ['Culture', 'Product Recommendation', 'Partner'] },
  section:    String,
  category:   String,
  company:    String,
  product:    String,
  name:       String,
  brand:      String,   // Product Recommendation: brand name
  webLink:    String,   // Product Recommendation: product URL
  reason:     String,
  desc:       String,
  ein:        String,   // Partner: Employer Identification Number
  inventory:  { type: mongoose.Schema.Types.Mixed }, // Partner: structured inventory parameters
  contractConfirmed: { type: Boolean, default: false }, // Partner: digital contract confirmation
  prompt:     String,
  response:   String,
  videoUrl:   String, // Culture video URL
  perspective: String, // Culture video description/perspective
  submittedBy: String,
  submitterRank: String,
  submitterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Reference to submitting user
  submitterProfilePictureUrl: String, // Denormalized for fast Culture feed lookups
  submitterSocialLinks: {              // Denormalized for fast Culture feed lookups
    instagram: String,
    tiktok: String,
    facebook: String
  },
  submitterAvatar: String, // Cloudinary URL captured from the request at submission time
  votes:      { yay: { type: Number, default: 0 }, nay: { type: Number, default: 0 } },
  createdAt:  { type: Date, default: Date.now }
});

dumaSchema.index({ section: 1, type: 1 });

const DumaItem = mongoose.model('DumaItem', dumaSchema);

// Media uploads
const Media = mongoose.model('Media', new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  filename:    String,
  originalName: String,
  mimetype:    String,
  size:        Number,
  storageUrl:  String,
  s3Key:       String,
  type:        { type: String, enum: ['image', 'video'] },
  duration:    Number,
  uploadedAt:  { type: Date, default: Date.now },
  expiresAt:   Date
}));

// Vote tracking — prevents double-voting
const voteSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, ref: 'DumaItem', required: true },
  voteType: { type: String, enum: ['yay', 'nay'], required: true },
  createdAt: { type: Date, default: Date.now },
});
voteSchema.index({ userId: 1, targetId: 1 }, { unique: true });
const Vote = mongoose.model('Vote', voteSchema);

// Shopify webhook event log — prevents double point awards on redelivered webhooks
const shopifyWebhookEventSchema = new mongoose.Schema({
  orderId:      { type: String, required: true, unique: true }, // Shopify order ID (string for safety)
  email:        { type: String, required: true, index: true },
  pointsAwarded: { type: Number, required: true },
  processedAt:  { type: Date, default: Date.now }
});
const ShopifyWebhookEvent = mongoose.model('ShopifyWebhookEvent', shopifyWebhookEventSchema);

// --- HELPERS ---
const JWT_SECRET = process.env.JWT_SECRET || 'majority-hair-default-secret-change-me';

const generateToken = (userId, rememberMe = false) => {
  return jwt.sign({ userId }, JWT_SECRET, {
    expiresIn: rememberMe ? '30d' : '24h'
  });
};

const authMiddleware = async (req, res, next) => {
  // 1. Prefer token pre-validated by route-level middleware, if present
  let token = req.bearerToken;

  // 2. Try HttpOnly cookie next (secure path)
  if (!token) {
    token = req.cookies?.token;
  }

  // 3. Fall back to Authorization header (legacy path)
  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }
  }

  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

const requireBearerAuthorizationHeader = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const bearerMatch = (authHeader || '').match(/^Bearer\s+(\S+)$/);
  if (!bearerMatch) {
    return res.status(401).json({ error: 'Authorization header with Bearer token is required' });
  }

  req.bearerToken = bearerMatch[1];
  next();
};

const sendEmail = async (to, subject, html) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.error("❌ Email credentials missing.");
    return;
  }
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
  await transporter.sendMail({
    from: `"Majority Hair Solutions" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html
  });
};

// Send rank-up reward email (once per rank)
const sendRankUpEmail = async (user, newRankTitle) => {
  if (user.rank_rewards_sent.includes(newRankTitle)) return; // Prevent double-dip

  const range = getRankRange(newRankTitle);
  const shopUrl = process.env.FRONTEND_URL || 'https://themajorities.com';

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px;">
      <h1 style="color: #222;">Congratulations on your promotion to <strong>${newRankTitle}</strong>! 🎊</h1>
      <p>You've reached a new level of influence at Majority Hair Solutions!</p>
      <p>Your dedication has officially earned you the rank of <strong>${newRankTitle}</strong>. 
         You are now part of the elite group within the <strong>${range}</strong> point bracket.</p>
      <p>As a reward for your contribution to the total solution, please enjoy <strong>25% OFF</strong> your next one-time order.</p>
      <p style="font-size: 18px;"><strong>Your Unique Reward Code: <span style="color: #c00;">MAJORITY25</span></strong></p>
      <a href="${shopUrl}" style="display:inline-block; background:#222; color:#fff; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:bold; margin-top:10px;">Redeem My 25% Discount</a>
      <p style="margin-top:30px; color:#666;">Keep climbing — the path to <strong>General Secretary</strong> is waiting for you.</p>
    </div>
  `;

  await sendEmail(user.email, `Congratulations on your promotion to ${newRankTitle}! 🎊`, html);

  // Mark this rank as rewarded so it only triggers once
  await User.findByIdAndUpdate(user._id, {
    $addToSet: { rank_rewards_sent: newRankTitle }
  });
};

// Update a user's rank score and check for rank-up
const updateRankScore = async (userId, pointsToAdd) => {
  const user = await User.findById(userId);
  if (!user) return;

  const oldTitle = user.rank_title;
  const newScore = Math.min((user.rank_score || 1) + pointsToAdd, 10000000);
  const newTitle = getRankTitle(newScore);

  await User.findByIdAndUpdate(userId, {
    rank_score: newScore,
    rank_title: newTitle
  });

  // Send rank-up reward email if rank changed
  if (newTitle !== oldTitle) {
    const updatedUser = await User.findById(userId);
    await sendRankUpEmail(updatedUser, newTitle);
  }
};

// --- ROUTES ---

// Allowed Duma item types for safe query filtering
const ALLOWED_DUMA_TYPES = new Set(['Product Recommendation', 'Partner', 'Culture']);

// Helper: resolve the canonical profile picture URL for a user document
const resolveProfilePictureUrl = (user) => user.profilePictureUrl || user.avatarUrl || null;

// Default social links object
const DEFAULT_SOCIAL_LINKS = { instagram: '', tiktok: '', facebook: '' };

// Health check
app.get('/', (req, res) => res.send('The Majority Backend is Live!'));

// API Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Backend is running' });
});

// --- MongoDB Models API Endpoints ---

// Health check for MongoDB Models API
app.get('/api/models/health', async (req, res) => {
  try {
    const hasKey = !!MONGODB_MODELS_API_KEY;
    res.json({
      status: hasKey ? 'configured' : 'not-configured',
      message: hasKey ? 'MongoDB Models API is ready' : 'MongoDB Models API key not configured',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate personalized hair care recommendation
app.post('/api/models/recommend', authMiddleware, async (req, res) => {
  try {
    const { hairType, concerns, preferredIngredients, budget } = req.body;

    // Validate input
    if (!hairType) {
      return res.status(400).json({ error: 'Hair type is required' });
    }

    // Call MongoDB Models API
    const recommendation = await mongoDBModelsClient.generateRecommendation({
      hairType,
      concerns: concerns || [],
      preferredIngredients: preferredIngredients || [],
      budget: budget || 'moderate'
    });

    // Save recommendation to user profile (optional)
    const user = await User.findOne({ email: req.user.email });
    if (user) {
      user.lastRecommendation = {
        input: { hairType, concerns, preferredIngredients, budget },
        result: recommendation,
        timestamp: new Date()
      };
      await user.save();
    }

    res.json({
      success: true,
      recommendation: recommendation,
      userEmail: req.user.email
    });
  } catch (error) {
    console.error('Recommendation endpoint error:', error);
    res.status(500).json({ 
      error: 'Failed to generate recommendation',
      details: error.message 
    });
  }
});

// Generic MongoDB Models API call endpoint (authenticated)
app.post('/api/models/call', authMiddleware, async (req, res) => {
  try {
    const { modelId, inputs } = req.body;

    if (!modelId) {
      return res.status(400).json({ error: 'Model ID is required' });
    }

    if (!inputs) {
      return res.status(400).json({ error: 'Inputs are required' });
    }

    const result = await mongoDBModelsClient.callModel(modelId, inputs);

    res.json({
      success: true,
      modelId,
      result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Model call error:', error);
    res.status(500).json({
      error: 'Failed to call model',
      details: error.message
    });
  }
});

// Auth: verify token and return user info including rank
app.get('/api/auth/me', authMiddleware, async (req, res) => {
  const user = req.user;
  res.json({
    email: user.email,
    rank_score: user.rank_score,
    rank_title: user.rank_title || getRankTitle(user.rank_score || 1),
    isPolitburoOrHigher: isPolitburoOrHigher(user.rank_score || 1)
  });
});

// POST /api/auth/google - Google OAuth Authentication
app.post('/api/auth/google', async (req, res) => {
  try {
    const { accessToken } = req.body;
    
    if (!accessToken) {
      return res.status(400).json({ error: 'Access token required' });
    }
    
    // Verify token with Google
    const googleResponse = await axios.get(
      `https://www.googleapis.com/oauth2/v1/userinfo?access_token=${accessToken}`
    );
    
    if (!googleResponse.data.email) {
      return res.status(400).json({ error: 'Invalid Google token' });
    }
    
    const email = googleResponse.data.email.toLowerCase();
    let user = await User.findOne({ email });
    
    if (!user) {
      // Create new user from Google OAuth
      const randomPassword = await bcrypt.hash(Math.random().toString(36), 12);
      user = await User.create({
        email,
        password: randomPassword,
        googleId: googleResponse.data.id,
        rank_title: 'bolshevik',
        rank_score: 1
      });
    } else {
      // Update existing user's Google ID
      if (!user.googleId) {
        user.googleId = googleResponse.data.id;
        await user.save();
      }
    }
    
    // Generate JWT
    const token = generateToken(user._id, true);

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: 30 * 24 * 3600000, // 30 days
    };
    res.cookie('token', token, cookieOptions);

    res.json({
      email: user.email,
      token,
      rank_title: user.rank_title || getRankTitle(user.rank_score || 1),
      rank_score: user.rank_score || 1,
      _id: user._id
    });
  } catch (err) {
    res.status(500).json({ error: 'Google authentication failed: ' + err.message });
  }
});

// SIGN UP
app.post('/api/signup', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be 8+ chars' });

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(400).json({ error: 'Account already exists' });

    const hashed = await bcrypt.hash(password, 12);
    const user = await User.create({
      email: email.toLowerCase(),
      password: hashed,
      rank_score: 1,
      rank_title: 'bolshevik'
    });
    const token = generateToken(user._id, false);

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: 3600000, // 1 hour
    };
    res.cookie('token', token, cookieOptions);

    res.status(201).json({ message: 'Account created', token, email: user.email, rank_title: user.rank_title });
  } catch (err) {
    res.status(500).json({ error: 'Signup failed' });
  }
});

// LOG IN
app.post('/api/login', async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body;
    const user = await User.findOne({ email: email?.toLowerCase() });

    if (!user || !user.password) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const token = generateToken(user._id, !!rememberMe);
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: rememberMe ? 30 * 24 * 3600000 : 3600000,
    };
    res.cookie('token', token, cookieOptions);
    res.json({
      success: true,
      token,
      email: user.email,
      rank_title: user.rank_title || getRankTitle(user.rank_score || 1),
      rank_score: user.rank_score || 1
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// LOGOUT
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'Strict' });
  res.json({ success: true });
});

// FORGOT PASSWORD
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email?.toLowerCase() });
    const SAFE_MSG = "If that email is registered, a reset link has been sent.";

    if (!user) return res.json({ message: SAFE_MSG });

    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    user.resetToken = hashedToken;
    user.resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour
    await user.save();

    const frontendUrl = process.env.FRONTEND_URL || 'https://themajorities.com';
    const resetUrl = `${frontendUrl}/reset-password/${rawToken}`;

    await sendEmail(user.email, 'Reset Your Password', `<p>Click <a href="${resetUrl}">here</a> to reset your password.</p>`);
    res.json({ message: SAFE_MSG });
  } catch (err) {
    res.status(500).json({ error: 'Email failed' });
  }
});

// RESET PASSWORD
app.post('/api/auth/reset-password/:token', async (req, res) => {
  try {
    const { password } = req.body;
    const { token } = req.params;

    if (!password || password.length < 8) return res.status(400).json({ error: 'Password too short' });

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      resetToken: hashedToken,
      resetTokenExpiry: { $gt: new Date() }
    });

    if (!user) return res.status(400).json({ error: 'Invalid or expired token' });

    user.password = await bcrypt.hash(password, 12);
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    await user.save();

    res.json({ message: 'Password updated' });
  } catch (err) {
    res.status(500).json({ error: 'Reset failed' });
  }
});

// STRIPE
app.post('/api/create-payment-intent', async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount) return res.status(400).json({ error: "Amount required" });

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

// --- DUMA (LEGISLATURE) ROUTES ---

// 1. Fetch all submissions
app.get('/api/duma', async (req, res) => {
  try {
    const { type, deduplicate } = req.query;

    // Whitelist the type value to prevent NoSQL injection
    const query = (type && ALLOWED_DUMA_TYPES.has(type)) ? { type } : {};
    const items = await DumaItem.find(query).sort({ createdAt: -1 });

    // Enrich items with up-to-date submitter profile data
    const submitterEmails = [...new Set(items.map(i => i.submittedBy).filter(Boolean))];
    const submitters = await User.find(
      { email: { $in: submitterEmails } },
      'email profilePictureUrl avatarUrl socialLinks'
    );
    const submitterMap = {};
    for (const u of submitters) {
      submitterMap[u.email] = {
        profilePictureUrl: resolveProfilePictureUrl(u),
        socialLinks: u.socialLinks || DEFAULT_SOCIAL_LINKS
      };
    }

    const enriched = items.map(item => {
      const profile = submitterMap[item.submittedBy] || {};
      return {
        ...item.toObject(),
        submitterProfilePictureUrl: profile.profilePictureUrl || item.submitterProfilePictureUrl || null,
        submitterSocialLinks: profile.socialLinks || item.submitterSocialLinks || DEFAULT_SOCIAL_LINKS
      };
    });

    // De-duplicate by submittedBy email — keep only the most recent item per user
    if (deduplicate === 'true') {
      const seen = new Set();
      const deduped = [];
      for (const item of enriched) {
        const key = item.submittedBy || null;
        if (key && !seen.has(key)) {
          seen.add(key);
          deduped.push(item);
        }
        // Items without a submitter are excluded from the deduplicated community grid
      }
      return res.json(deduped);
    }

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Voting Logic - Accept both "voteType" and "vote" parameters
app.post('/api/duma/:id/vote', authMiddleware, async (req, res) => {
  try {
    const voteType = req.body.voteType || req.body.vote; // Support both parameter names
    if (!['yay', 'nay'].includes(voteType)) {
      return res.status(400).json({ error: 'Vote must be "yay" or "nay"' });
    }

    // Prevent double-voting via unique index; throws code 11000 on duplicate
    try {
      await Vote.create({
        userId: req.user._id,
        targetId: req.params.id,
        voteType,
      });
    } catch (dupErr) {
      if (dupErr.code === 11000) {
        return res.status(409).json({ error: 'You have already voted on this item' });
      }
      throw dupErr;
    }

    const update = voteType === 'yay' ? 
      { $inc: { 'votes.yay': 1 } } : 
      { $inc: { 'votes.nay': 1 } };

    const item = await DumaItem.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!item) return res.status(404).json({ error: 'Item not found' });

    // Award points for voting
    await updateRankScore(req.user._id, 2);

    res.json({ success: true, votes: item.votes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Submit recommendation to Duma
app.post('/api/duma/recommend', requireBearerAuthorizationHeader, authMiddleware, async (req, res) => {
  try {
    const { name, brand, webLink, reason, submitterAvatar } = req.body;
    if (!name || !brand || !webLink || !reason) {
      return res.status(400).json({ error: 'All fields required: name, brand, webLink, reason' });
    }

    const rankTitle = req.user.rank_title || getRankTitle(req.user.rank_score || 1);
    const item = await DumaItem.create({
      type: 'Product Recommendation',
      name,
      brand,
      webLink,
      reason,
      submittedBy: req.user.email,
      submitterRank: rankTitle,
      submitterId: req.user._id,
      submitterProfilePictureUrl: resolveProfilePictureUrl(req.user),
      submitterSocialLinks: req.user.socialLinks || DEFAULT_SOCIAL_LINKS,
      submitterAvatar: submitterAvatar || resolveProfilePictureUrl(req.user)
    });

    await updateRankScore(req.user._id, 5);
    res.status(201).json({ message: "Your recommendation has been sent to The Majority's Duma for voting", item });
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit recommendation' });
  }
});

// 4. Submit partner application to Duma
// Standard applications are available to all authenticated users.
// Premium tier requires the requirePartnerPremium middleware (≥ 10,000,000 points).
app.post('/api/duma/partner', requireBearerAuthorizationHeader, authMiddleware, async (req, res) => {
  try {
    const { company, ein, product, desc, inventory, contractConfirmed, tier } = req.body;
    if (!company || !ein || !product || !desc) {
      return res.status(400).json({ error: 'All fields required: company, ein, product, desc' });
    }
    if (contractConfirmed !== true) {
      return res.status(400).json({ error: 'Digital contract confirmation is required' });
    }

    const rankScore = req.user.rank_score || 1;
    const rankTitle = req.user.rank_title || getRankTitle(rankScore);

    if (tier === 'Premium' && rankScore < PARTNER_PREMIUM_MIN) {
      return res.status(403).json({
        error: 'Premium Partner status requires 10,000,000 points.',
        current_score: rankScore,
        required_score: PARTNER_PREMIUM_MIN
      });
    }

    const item = await DumaItem.create({
      type: 'Partner',
      company,
      ein,
      product,
      desc,
      inventory: inventory || null,
      contractConfirmed: true,
      submittedBy: req.user.email,
      submitterRank: rankTitle,
      submitterId: req.user._id,
      submitterProfilePictureUrl: resolveProfilePictureUrl(req.user),
      submitterSocialLinks: req.user.socialLinks || DEFAULT_SOCIAL_LINKS
    });

    await updateRankScore(req.user._id, 10);
    res.status(201).json({ message: "Your partner application has been submitted to The Majority's Duma", item });
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit partner application' });
  }
});

// 5. Submit culture video/perspective to Duma
app.post('/api/duma/culture', authMiddleware, async (req, res) => {
  try {
    const { prompt, response, videoUrl, perspective, category, submitterAvatar } = req.body;
    const rankTitle = req.user.rank_title || getRankTitle(req.user.rank_score || 1);
    const isVideoSubmission = Boolean(videoUrl);

    const item = await DumaItem.create({
      type: 'Culture',
      category: category || 'Culture',
      prompt,
      response,
      videoUrl: videoUrl || null,
      perspective: perspective || response,
      submittedBy: req.user.email,
      submitterRank: rankTitle,
      submitterId: req.user._id,
      submitterProfilePictureUrl: resolveProfilePictureUrl(req.user),
      submitterSocialLinks: req.user.socialLinks || DEFAULT_SOCIAL_LINKS,
      submitterAvatar: submitterAvatar || resolveProfilePictureUrl(req.user)
    });

    // Award +100 pts for video submissions, +1 pt for text-only
    const pointsToAward = isVideoSubmission ? 100 : 1;
    await updateRankScore(req.user._id, pointsToAward);

    res.status(201).json({
      message: isVideoSubmission
        ? "Culture video published to the Duma! +100 points awarded."
        : "Perspective shared to the Duma! +1 point awarded.",
      item,
      pointsAwarded: pointsToAward
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET user rank info
app.get('/api/rank', authMiddleware, async (req, res) => {
  const user = req.user;
  res.json({
    rank_score: user.rank_score || 1,
    rank_title: user.rank_title || getRankTitle(user.rank_score || 1),
    isPolitburoOrHigher: isPolitburoOrHigher(user.rank_score || 1)
  });
});

// ========== PROFILE ENDPOINTS ==========

// GET /api/profile - Fetch user profile with perspectives and social links
app.get('/api/profile', authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    res.json({
      email: user.email,
      rank_title: user.rank_title || getRankTitle(user.rank_score || 1),
      rank_score: user.rank_score || 1,
      perspective: user.perspective || {
        box1: { content: "", mediaUrls: [], videoUrl: null },
        box2: { content: "", mediaUrls: [], videoUrl: null },
        box3: { content: "", mediaUrls: [], videoUrl: null },
        box4: { content: "", mediaUrls: [], videoUrl: null }
      },
      socialLinks: user.socialLinks || DEFAULT_SOCIAL_LINKS,
      avatarUrl: user.avatarUrl || null,
      profilePictureUrl: resolveProfilePictureUrl(user),
      _id: user._id,
      currentFormula:     user.currentFormula     || [],
      subscriptionStatus: user.subscriptionStatus || null,
      subscriptionPlan:   user.subscriptionPlan   || null,
      shipmentCount:      user.shipmentCount       ?? INITIAL_SHIPMENT_COUNT,
      shippingAddress:    user.shippingAddress     || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/profile - Update user profile perspectives
app.put('/api/profile', authMiddleware, async (req, res) => {
  try {
    const { perspective, socialLinks, avatarUrl } = req.body;
    
    const updateData = {};
    
    // Update perspective if provided
    if (perspective) {
      updateData.perspective = {
        box1: { ...perspective.box1, updatedAt: new Date() },
        box2: { ...perspective.box2, updatedAt: new Date() },
        box3: { ...perspective.box3, updatedAt: new Date() },
        box4: { ...perspective.box4, updatedAt: new Date() }
      };
    }
    
    // Update social links if provided (atomic $set per field)
    if (socialLinks) {
      if (socialLinks.instagram !== undefined) updateData['socialLinks.instagram'] = socialLinks.instagram;
      if (socialLinks.tiktok !== undefined) updateData['socialLinks.tiktok'] = socialLinks.tiktok;
      if (socialLinks.facebook !== undefined) updateData['socialLinks.facebook'] = socialLinks.facebook;
    }

    // Accept avatarUrl directly in profile update
    if (avatarUrl && typeof avatarUrl === 'string') {
      try {
        const parsed = new URL(avatarUrl);
        if (['http:', 'https:'].includes(parsed.protocol)) {
          updateData.avatarUrl = avatarUrl;
          updateData.profilePictureUrl = avatarUrl;
        }
      } catch (_) { /* ignore invalid URLs */ }
    }
    
    const user = await User.findByIdAndUpdate(req.user._id, { $set: updateData }, { new: true });
    res.json({ success: true, message: 'Profile updated successfully', profile: {
      perspective: user.perspective,
      socialLinks: user.socialLinks,
      avatarUrl: user.avatarUrl,
      profilePictureUrl: user.profilePictureUrl,
    }});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/profile/social-links - Update only social media links
app.put('/api/profile/social-links', authMiddleware, async (req, res) => {
  try {
    const { socialLinks } = req.body;
    
    const updatePayload = {};
    if (socialLinks.instagram !== undefined) updatePayload['socialLinks.instagram'] = socialLinks.instagram;
    if (socialLinks.tiktok !== undefined) updatePayload['socialLinks.tiktok'] = socialLinks.tiktok;
    if (socialLinks.facebook !== undefined) updatePayload['socialLinks.facebook'] = socialLinks.facebook;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updatePayload },
      { new: true }
    );
    
    res.json({ success: true, message: 'Social links updated', socialLinks: user.socialLinks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/profile/avatar - Set avatar URL after a successful media upload
app.put('/api/profile/avatar', authMiddleware, async (req, res) => {
  try {
    const { avatarUrl } = req.body;
    if (!avatarUrl || typeof avatarUrl !== 'string') return res.status(400).json({ error: 'avatarUrl is required' });
    // Basic URL validation to prevent storing arbitrary values
    let parsedUrl;
    try { parsedUrl = new URL(avatarUrl); } catch (urlErr) { return res.status(400).json({ error: 'avatarUrl must be a valid URL' }); }
    if (!['https:', 'http:'].includes(parsedUrl.protocol)) return res.status(400).json({ error: 'avatarUrl must use http or https' });
    await User.findByIdAndUpdate(req.user._id, { avatarUrl, profilePictureUrl: avatarUrl });
    res.json({ success: true, avatarUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/upload-avatar - Upload profile picture (JPG/PNG only, 5MB max)
app.post('/api/users/upload-avatar', authMiddleware, (req, res, next) => {
  avatarUpload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Image must be under 5MB' });
    }
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const cloudinaryResult = await uploadToCloudinary(req.file.buffer);
    const profilePictureUrl = cloudinaryResult.secure_url;

    await User.findByIdAndUpdate(req.user._id, { profilePictureUrl, avatarUrl: profilePictureUrl });

    res.json({ success: true, profilePictureUrl });
  } catch (err) {
    console.error('Avatar upload error:', err);
    res.status(500).json({ error: 'Avatar upload failed' });
  }
});

// POST /api/profile/add-points - Add points to user rank score (requires valid Stripe session)
app.post('/api/profile/add-points', authMiddleware, async (req, res) => {
  try {
    const { points, stripeSessionId } = req.body;
    if (!points || typeof points !== 'number') return res.status(400).json({ error: 'points must be a number' });

    // Validate against Stripe to prevent manual score manipulation
    if (!stripeSessionId) {
      return res.status(400).json({ error: 'stripeSessionId is required to add points' });
    }

    try {
      const session = await stripe.checkout.sessions.retrieve(stripeSessionId);
      if (session.payment_status !== 'paid') {
        return res.status(400).json({ error: 'Stripe session has not been paid' });
      }
      // Ensure the session belongs to the authenticated user
      const sessionEmail = session.customer_details?.email?.toLowerCase();
      if (sessionEmail && sessionEmail !== req.user.email.toLowerCase()) {
        return res.status(403).json({ error: 'Stripe session does not match the authenticated user' });
      }
    } catch (stripeErr) {
      console.error('Stripe session validation error:', stripeErr.message);
      return res.status(400).json({ error: 'Invalid or unverifiable Stripe session ID' });
    }

    await updateRankScore(req.user._id, points);
    const user = await User.findById(req.user._id);
    res.json({ success: true, rank_score: user.rank_score, rank_title: user.rank_title });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/profile/save-formula - Save selected product formula to user profile
app.post('/api/profile/save-formula', authMiddleware, async (req, res) => {
  try {
    const { selectedItems } = req.body;

    if (!Array.isArray(selectedItems) || selectedItems.length === 0) {
      return res.status(400).json({ error: 'selectedItems must be a non-empty array' });
    }

    // Expect exactly REQUIRED_FORMULA_PRODUCTS product IDs/names
    if (selectedItems.length !== REQUIRED_FORMULA_PRODUCTS) {
      return res.status(400).json({ error: `selectedItems must contain exactly ${REQUIRED_FORMULA_PRODUCTS} products` });
    }

    // Ensure every item is a plain string (prevents NoSQL injection via array elements)
    if (!selectedItems.every(item => typeof item === 'string' && item.trim().length > 0)) {
      return res.status(400).json({ error: 'Each item in selectedItems must be a non-empty string' });
    }

    const sanitizedItems = selectedItems.map(item => item.trim());

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { currentFormula: sanitizedItems },
      { new: true }
    );

    res.json({ success: true, currentFormula: user.currentFormula });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== MEDIA UPLOAD ENDPOINTS ==========

// POST /api/media/upload - Upload media file (photo or video)
app.post('/api/media/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }
    
    const { file } = req;
    const isImage = file.mimetype.startsWith('image');
    const isVideo = file.mimetype.startsWith('video');
    
    if (!isImage && !isVideo) {
      return res.status(400).json({ error: 'Only images and videos allowed' });
    }
    
    // File size validation
    if (isImage && file.size > 5242880) { // 5MB
      return res.status(400).json({ error: 'Image must be under 5MB' });
    }
    if (isVideo && file.size > 52428800) { // 50MB
      return res.status(400).json({ error: 'Video must be under 50MB' });
    }

    const cloudinaryResult = await uploadToCloudinary(file.buffer);
    const storageUrl = cloudinaryResult.secure_url;

    const media = await Media.create({
      userId: req.user._id,
      filename: file.originalname,
      originalName: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      type: isImage ? 'image' : 'video',
      storageUrl,
      uploadedAt: new Date()
    });
    
    // Award points for uploading
    await updateRankScore(req.user._id, 5);
    
    res.json({
      success: true,
      url: media.storageUrl,
      _id: media._id,
      filename: media.filename,
      storageUrl: media.storageUrl,
      type: media.type,
      size: media.size,
      uploadedAt: media.uploadedAt
    });
  } catch (err) {
    console.error("Upload Error:", err);
    res.status(500).json({ error: 'Cloudinary upload failed' });
  }
});

// GET /api/media/presigned-url — generate a Cloudinary signed upload token for direct client upload
app.get('/api/media/presigned-url', authMiddleware, (req, res) => {
  const { fileType, contentLength } = req.query;

  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'];
  if (!fileType || !ALLOWED_TYPES.includes(fileType)) {
    return res.status(400).json({ error: 'Invalid or missing fileType' });
  }

  const maxSize = fileType.startsWith('video') ? 52428800 : 5242880;
  if (contentLength && parseInt(contentLength) > maxSize) {
    return res.status(400).json({ error: 'File too large' });
  }

  const timestamp = Math.round(Date.now() / 1000);
  const publicId = `user_media/${req.user._id}/${crypto.randomUUID()}`;
  const resourceType = fileType.startsWith('video') ? 'video' : 'image';

  const paramsToSign = `public_id=${publicId}&timestamp=${timestamp}`;
  const signature = crypto
    .createHash('sha1')
    .update(paramsToSign + process.env.CLOUDINARY_API_SECRET)
    .digest('hex');

  res.json({
    uploadUrl: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`,
    fields: {
      api_key: process.env.CLOUDINARY_API_KEY,
      timestamp,
      public_id: publicId,
      signature,
    },
    publicId,
  });
});

// POST /api/media/confirm — client calls this after a direct Cloudinary upload succeeds
app.post('/api/media/confirm', authMiddleware, async (req, res) => {
  try {
    const { publicId, storageUrl, fileType, size } = req.body;
    if (!publicId || !storageUrl) {
      return res.status(400).json({ error: 'publicId and storageUrl are required' });
    }

    // Verify the asset actually exists on Cloudinary before trusting it
    const resourceType = fileType?.startsWith('video') ? 'video' : 'image';
    let cloudinaryAsset;
    try {
      cloudinaryAsset = await cloudinary.api.resource(publicId, { resource_type: resourceType });
    } catch (e) {
      return res.status(400).json({ error: 'Could not verify asset on Cloudinary' });
    }

    const media = await Media.create({
      userId: req.user._id,
      filename: publicId.split('/').pop(),
      originalName: publicId.split('/').pop(),
      mimetype: fileType,
      size: cloudinaryAsset.bytes || size,
      type: resourceType,
      storageUrl: cloudinaryAsset.secure_url,
      uploadedAt: new Date(),
    });

    await updateRankScore(req.user._id, 5);
    res.json({ success: true, media });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/media/{mediaId} - Delete media file
app.delete('/api/media/:mediaId', authMiddleware, async (req, res) => {
  try {
    const media = await Media.findById(req.params.mediaId);
    if (!media) {
      return res.status(404).json({ error: 'Media not found' });
    }
    
    // Verify user owns the media
    if (media.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    // TODO: Delete from S3/Cloudinary
    await Media.deleteOne({ _id: req.params.mediaId });
    
    res.json({ success: true, message: 'Media deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== PREMIUM PARTNER ENDPOINTS ==========
// All routes below require authentication AND ≥ 10,000,000 rank points.

// GET /api/partner/premium/status — check whether the authenticated user has Partner Premium access
app.get('/api/partner/premium/status', requireBearerAuthorizationHeader, authMiddleware, requirePartnerPremium, (req, res) => {
  res.json({
    access: true,
    rank_score: req.user.rank_score,
    rank_title: req.user.rank_title,
    message: 'You have Partner Premium access.'
  });
});

// ========== LEADERBOARD ==========
app.get('/api/leaderboard', async (req, res) => {
  try {
    const users = await User.find({}, 'email rank_score rank_title')
      .sort({ rank_score: -1 })
      .limit(50);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});


// ========== SOCIAL SHARE ROUTES ==========

// --- FACEBOOK / INSTAGRAM OAUTH ---

// GET /api/auth/facebook — redirect user to Facebook OAuth consent screen
app.get('/api/auth/facebook', (req, res) => {
  const { META_APP_ID, FRONTEND_URL } = process.env;
  const redirectUri = encodeURIComponent((process.env.BACKEND_URL || 'https://hair-backend-orpin.vercel.app') + '/api/auth/facebook/callback');
  const scopes = 'email,public_profile,pages_show_list,pages_manage_posts,instagram_content_publish';
  const fbUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${redirectUri}&scope=${scopes}&response_type=code`;
  res.redirect(fbUrl);
});

// GET /api/auth/facebook/callback — exchange code for long-lived token & save
app.get('/api/auth/facebook/callback', authMiddleware, async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: 'No code returned from Facebook' });

    const { META_APP_ID, META_APP_SECRET, FRONTEND_URL } = process.env;
    const redirectUri = (process.env.BACKEND_URL || 'https://hair-backend-orpin.vercel.app') + '/api/auth/facebook/callback';

    // Exchange code for short-lived token
    const tokenRes = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
      params: { client_id: META_APP_ID, client_secret: META_APP_SECRET, redirect_uri: redirectUri, code }
    });
    const shortToken = tokenRes.data.access_token;

    // Exchange for long-lived token (60 days)
    const longRes = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
      params: { grant_type: 'fb_exchange_token', client_id: META_APP_ID, client_secret: META_APP_SECRET, fb_exchange_token: shortToken }
    });
    const longToken = longRes.data.access_token;
    const expiresIn = longRes.data.expires_in || 5184000; // default 60 days

    // Get connected Facebook Page (needed for pages_manage_posts)
    let pageOrUserId = null;
    let instagramBusinessAccountId = null;
    let instagramToken = longToken;
    try {
      const pagesRes = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
        params: { access_token: longToken }
      });
      const firstPage = pagesRes.data.data && pagesRes.data.data[0];
      if (firstPage) {
        pageOrUserId = firstPage.id;
        // Try to get linked Instagram Business Account
        const igRes = await axios.get(`https://graph.facebook.com/v19.0/${firstPage.id}`, {
          params: { fields: 'instagram_business_account', access_token: firstPage.access_token }
        });
        if (igRes.data.instagram_business_account) {
          instagramBusinessAccountId = igRes.data.instagram_business_account.id;
          instagramToken = firstPage.access_token;
        }
      }
    } catch (pagesErr) {
      console.warn('Could not fetch Facebook pages:', pagesErr.message);
    }

    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    await User.findByIdAndUpdate(req.user._id, {
      'socialTokens.facebook.accessToken': longToken,
      'socialTokens.facebook.expiresAt': expiresAt,
      'socialTokens.facebook.pageOrUserId': pageOrUserId,
      'socialTokens.instagram.accessToken': instagramToken,
      'socialTokens.instagram.expiresAt': expiresAt,
      'socialTokens.instagram.instagramBusinessAccountId': instagramBusinessAccountId,
    });

    res.redirect((FRONTEND_URL || 'https://www.majorityhairsolutions.com') + '?social=connected&platform=facebook');
  } catch (err) {
    console.error('Facebook OAuth error:', err.message);
    res.redirect((process.env.FRONTEND_URL || 'https://www.majorityhairsolutions.com') + '?social=error&platform=facebook');
  }
});

// --- TIKTOK OAUTH ---

// GET /api/auth/tiktok — redirect user to TikTok OAuth consent screen
app.get('/api/auth/tiktok', (req, res) => {
  const { TIKTOK_CLIENT_KEY, BACKEND_URL, FRONTEND_URL } = process.env;
  const redirectUri = encodeURIComponent((BACKEND_URL || 'https://hair-backend-orpin.vercel.app') + '/api/auth/tiktok/callback');
  const csrfState = crypto.randomBytes(16).toString('hex');
  const scopes = 'video.upload,share.sound.create';
  const ttUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${TIKTOK_CLIENT_KEY}&response_type=code&scope=${scopes}&redirect_uri=${redirectUri}&state=${csrfState}`;
  res.redirect(ttUrl);
});

// GET /api/auth/tiktok/callback — exchange code for tokens & save
app.get('/api/auth/tiktok/callback', authMiddleware, async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: 'No code returned from TikTok' });

    const { TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, BACKEND_URL, FRONTEND_URL } = process.env;
    const redirectUri = (BACKEND_URL || 'https://hair-backend-orpin.vercel.app') + '/api/auth/tiktok/callback';

    const tokenRes = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', {
      client_key: TIKTOK_CLIENT_KEY,
      client_secret: TIKTOK_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    }, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

    const { access_token, refresh_token, expires_in, open_id } = tokenRes.data;
    const expiresAt = new Date(Date.now() + (expires_in || 86400) * 1000);

    await User.findByIdAndUpdate(req.user._id, {
      'socialTokens.tiktok.accessToken': access_token,
      'socialTokens.tiktok.refreshToken': refresh_token,
      'socialTokens.tiktok.expiresAt': expiresAt,
      'socialTokens.tiktok.openId': open_id,
    });

    res.redirect((FRONTEND_URL || 'https://www.majorityhairsolutions.com') + '?social=connected&platform=tiktok');
  } catch (err) {
    console.error('TikTok OAuth error:', err.message);
    res.redirect((process.env.FRONTEND_URL || 'https://www.majorityhairsolutions.com') + '?social=error&platform=tiktok');
  }
});

// GET /api/auth/social-status — return which platforms user has connected
app.get('/api/auth/social-status', authMiddleware, async (req, res) => {
  const tokens = req.user.socialTokens || {};
  const now = new Date();
  res.json({
    facebook: !!(tokens.facebook && tokens.facebook.accessToken && (!tokens.facebook.expiresAt || new Date(tokens.facebook.expiresAt) > now)),
    instagram: !!(tokens.instagram && tokens.instagram.accessToken && tokens.instagram.instagramBusinessAccountId && (!tokens.instagram.expiresAt || new Date(tokens.instagram.expiresAt) > now)),
    tiktok: !!(tokens.tiktok && tokens.tiktok.accessToken && (!tokens.tiktok.expiresAt || new Date(tokens.tiktok.expiresAt) > now)),
  });
});

// POST /api/profile/share — publish a video to connected social platforms
// Body: { videoUrl: string (absolute Cloudinary URL), platforms: ['instagram','tiktok','facebook'], caption: string }
app.post('/api/profile/share', authMiddleware, async (req, res) => {
  const { videoUrl, platforms, caption } = req.body;

  if (!videoUrl || !platforms || !Array.isArray(platforms) || platforms.length === 0) {
    return res.status(400).json({ error: 'videoUrl and platforms[] are required' });
  }

  // Validate videoUrl is an absolute https URL (must be Cloudinary or public CDN)
  let parsedUrl;
  try { parsedUrl = new URL(videoUrl); } catch (_) { return res.status(400).json({ error: 'videoUrl must be a valid absolute URL' }); }
  if (!['https:', 'http:'].includes(parsedUrl.protocol)) {
    return res.status(400).json({ error: 'videoUrl must use http or https' });
  }

  const tokens = req.user.socialTokens || {};
  const now = new Date();
  const results = {};

  // --- INSTAGRAM ---
  if (platforms.includes('instagram')) {
    const ig = tokens.instagram || {};
    if (!ig.accessToken || !ig.instagramBusinessAccountId) {
      results.instagram = { success: false, error: 'Instagram not connected. Visit /api/auth/facebook to connect.' };
    } else if (ig.expiresAt && new Date(ig.expiresAt) <= now) {
      results.instagram = { success: false, error: 'Instagram token expired. Please reconnect.' };
    } else {
      try {
        // Step 1: Create media container
        const containerRes = await axios.post(
          `https://graph.facebook.com/v19.0/${ig.instagramBusinessAccountId}/media`,
          { video_url: videoUrl, caption: caption || '', media_type: 'REELS', share_to_feed: true, access_token: ig.accessToken }
        );
        const containerId = containerRes.data.id;

        // Step 2: Poll for container status (up to 60s)
        let status = 'IN_PROGRESS';
        for (let i = 0; i < 12 && status === 'IN_PROGRESS'; i++) {
          await new Promise(r => setTimeout(r, 5000));
          const statusRes = await axios.get(`https://graph.facebook.com/v19.0/${containerId}`, {
            params: { fields: 'status_code', access_token: ig.accessToken }
          });
          status = statusRes.data.status_code;
        }

        if (status !== 'FINISHED') {
          results.instagram = { success: false, error: `Container not ready: ${status}` };
        } else {
          // Step 3: Publish
          const publishRes = await axios.post(
            `https://graph.facebook.com/v19.0/${ig.instagramBusinessAccountId}/media_publish`,
            { creation_id: containerId, access_token: ig.accessToken }
          );
          results.instagram = { success: true, mediaId: publishRes.data.id };
        }
      } catch (err) {
        results.instagram = { success: false, error: err.response?.data?.error?.message || err.message };
      }
    }
  }

  // --- TIKTOK ---
  if (platforms.includes('tiktok')) {
    const tt = tokens.tiktok || {};
    if (!tt.accessToken || !tt.openId) {
      results.tiktok = { success: false, error: 'TikTok not connected. Visit /api/auth/tiktok to connect.' };
    } else if (tt.expiresAt && new Date(tt.expiresAt) <= now) {
      results.tiktok = { success: false, error: 'TikTok token expired. Please reconnect.' };
    } else {
      try {
        // TikTok Video Upload: initialize upload
        const initRes = await axios.post(
          'https://open.tiktokapis.com/v2/post/publish/video/init/',
          {
            post_info: { title: caption || 'Check out this video!', privacy_level: 'PUBLIC_TO_EVERYONE', disable_duet: false, disable_stitch: false, disable_comment: false },
            source_info: { source: 'PULL_FROM_URL', video_url: videoUrl }
          },
          { headers: { 'Authorization': `Bearer ${tt.accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' } }
        );
        results.tiktok = { success: true, publishId: initRes.data.data?.publish_id };
      } catch (err) {
        results.tiktok = { success: false, error: err.response?.data?.error?.message || err.message };
      }
    }
  }

  // --- FACEBOOK PAGE ---
  if (platforms.includes('facebook')) {
    const fb = tokens.facebook || {};
    if (!fb.accessToken || !fb.pageOrUserId) {
      results.facebook = { success: false, error: 'Facebook not connected. Visit /api/auth/facebook to connect.' };
    } else if (fb.expiresAt && new Date(fb.expiresAt) <= now) {
      results.facebook = { success: false, error: 'Facebook token expired. Please reconnect.' };
    } else {
      try {
        const fbRes = await axios.post(
          `https://graph.facebook.com/v19.0/${fb.pageOrUserId}/videos`,
          { file_url: videoUrl, description: caption || '', published: true, access_token: fb.accessToken }
        );
        results.facebook = { success: true, videoId: fbRes.data.id };
      } catch (err) {
        results.facebook = { success: false, error: err.response?.data?.error?.message || err.message };
      }
    }
  }

  const anySuccess = Object.values(results).some(r => r.success);
  res.status(anySuccess ? 200 : 422).json({ results });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));
