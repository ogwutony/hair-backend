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

// Cloudinary Configuration
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
const DumaItem = mongoose.model('DumaItem', new mongoose.Schema({
  type:       { type: String, required: true }, // "Recommendation" | "Partner" | "Culture"
  category:   String,
  company:    String,
  product:    String,
  name:       String,
  reason:     String,
  desc:       String,
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
  votes:      { yay: { type: Number, default: 0 }, nay: { type: Number, default: 0 } },
  createdAt:  { type: Date, default: Date.now }
}));

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

// --- HELPERS ---
const JWT_SECRET = process.env.JWT_SECRET || 'majority-hair-default-secret-change-me';

const generateToken = (userId, rememberMe = false) => {
  return jwt.sign({ userId }, JWT_SECRET, {
    expiresIn: rememberMe ? '30d' : '24h'
  });
};

const authMiddleware = async (req, res, next) => {
  // 1. Try HttpOnly cookie first (secure path)
  let token = req.cookies?.token;

  // 2. Fall back to Authorization header (legacy path)
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
const ALLOWED_DUMA_TYPES = new Set(['Recommendation', 'Partner', 'Culture']);

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
app.post('/api/duma/recommend', authMiddleware, async (req, res) => {
  try {
    const { name, company, reason } = req.body;
    if (!name || !company || !reason) return res.status(400).json({ error: 'All fields required' });

    const rankTitle = req.user.rank_title || getRankTitle(req.user.rank_score || 1);
    const item = await DumaItem.create({
      type: 'Recommendation',
      name,
      company,
      reason,
      submittedBy: req.user.email,
      submitterRank: rankTitle,
      submitterId: req.user._id,
      submitterProfilePictureUrl: resolveProfilePictureUrl(req.user),
      submitterSocialLinks: req.user.socialLinks || DEFAULT_SOCIAL_LINKS
    });

    await updateRankScore(req.user._id, 5);
    res.status(201).json({ message: "Your recommendation has been sent to The Majority's Duma for voting", item });
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit recommendation' });
  }
});

// 4. Submit partner application to Duma
app.post('/api/duma/partner', authMiddleware, async (req, res) => {
  try {
    const { company, product, desc, tier } = req.body;
    if (!company || !product || !desc) return res.status(400).json({ error: 'All fields required' });

    const rankScore = req.user.rank_score || 1;
    const rankTitle = req.user.rank_title || getRankTitle(rankScore);

    if (tier === 'Premium' && !isPolitburoOrHigher(rankScore)) {
      return res.status(403).json({
        error: 'Premium Partner status requires Politburo rank or higher. Keep building your influence!'
      });
    }

    const item = await DumaItem.create({
      type: 'Partner',
      company,
      product,
      desc,
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
    const { prompt, response, videoUrl, perspective, category } = req.body;
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
      submitterSocialLinks: req.user.socialLinks || DEFAULT_SOCIAL_LINKS
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
      _id: user._id
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
    
    // Update social links if provided
    if (socialLinks) {
      updateData.socialLinks = { ...socialLinks, updatedAt: new Date() };
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
    
    const user = await User.findByIdAndUpdate(req.user._id, updateData, { new: true });
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
    
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { socialLinks: { ...socialLinks, updatedAt: new Date() } },
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

// POST /api/profile/add-points - Add points to user rank score
app.post('/api/profile/add-points', authMiddleware, async (req, res) => {
  try {
    const { points } = req.body;
    if (!points || typeof points !== 'number') return res.status(400).json({ error: 'points must be a number' });
    await updateRankScore(req.user._id, points);
    const user = await User.findById(req.user._id);
    res.json({ success: true, rank_score: user.rank_score, rank_title: user.rank_title });
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));
