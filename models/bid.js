const mongoose = require('mongoose');

const bidSchema = new mongoose.Schema({
  projectRef: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },
  platformProjectId: Number,
  amount: Number,
  period: Number,
  milestone_percentage:Number,
  status: { type: String, enum: ["pending", "success", "failed"], default: "pending" },
  responseRaw: mongoose.Schema.Types.Mixed,
  error: mongoose.Schema.Types.Mixed,
}, { timestamps: true });

module.exports = mongoose.model('Bid', bidSchema);
