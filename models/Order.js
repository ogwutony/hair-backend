const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  customerEmail: { type: String, required: true },
  items: [{ name: String }],
  status: {
    type: String,
    enum: ['Pending', 'Shipped', 'Delivered'],
    default: 'Pending'
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Order || mongoose.model('Order', orderSchema);
