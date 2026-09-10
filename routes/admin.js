const express = require('express');
const router = express.Router();
const { Types } = require('mongoose');
const Order = require('../models/Order');
const authMiddleware = require('../middleware/auth');

// Secure access gate verification logic
const checkAdminRole = (req, res, next) => {
  if (req.user.email !== process.env.ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Access Denied: Admin authorization clearance required.' });
  }
  next();
};

// GET: Pull full ledger transactions overview
router.get('/api/admin/orders', authMiddleware, checkAdminRole, async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: 'Ledger database retrieval lookup error.' });
  }
});

// PUT: Patch a shipping cycle status index string parameter
router.put('/api/admin/orders/:id/status', authMiddleware, checkAdminRole, async (req, res) => {
  const { status } = req.body;
  if (!['Pending', 'Shipped', 'Delivered'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status property state argument provided.' });
  }

  if (!Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid order ID.' });
  }

  try {
    const patchedEntry = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    if (!patchedEntry) return res.status(404).json({ error: 'Target order record item reference not found.' });
    res.json(patchedEntry);
  } catch (err) {
    res.status(500).json({ error: 'Failed to push status modification parameters down to database level.' });
  }
});

module.exports = router;
