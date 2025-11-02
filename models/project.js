const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
  platformId: { type: Number, unique: true, index: true },
  title: String,
  preview_description: String,
  status: { type: String,enum: ["new","queued","bidding","bid_sent","skipped","error"], index:true , default: "new" },
  type: String,
  time_submitted:{ 
    type: Number, 
    index: true  
  },
  bid_stats: {
    bid_count: Number,
    bid_avg: Number,
  },
  budget: { minimum: Number, maximum: Number },
  currency: { code: String },
  jobs: [
    {
      id: Number,
      name: String,
      category: { id: Number, name: String },
    },
  ],
  raw: mongoose.Schema.Types.Mixed,
}, { timestamps: true });



// === COMPOSITE INDEXES (SUPER FAST) ===
projectSchema.index({ platformId: 1, userId: 1 });     // Unique per user (prevent duplicate)
projectSchema.index({ userId: 1, status: 1 });         // Fast: "User ke new projects"
projectSchema.index({ time_submitted: -1 });           // Global: Latest projects first
projectSchema.index({ userId: 1, time_submitted: -1 }); // Per user: Latest first


module.exports = mongoose.model('Project', projectSchema);
