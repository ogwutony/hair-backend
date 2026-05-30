const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

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
    const JWT_SECRET = process.env.JWT_SECRET || 'majority-hair-default-secret-change-me';
    const decoded = jwt.verify(token, JWT_SECRET);
    const User = mongoose.model('User');
    const user = await User.findById(decoded.userId);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

module.exports = authMiddleware;
