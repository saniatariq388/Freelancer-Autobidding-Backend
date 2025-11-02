
const mongoose = require('mongoose');

const userConfigSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true, index: true },
  userName: {type:String,  trim: true},
  email: { type: String, trim: true, lowercase: true , default: null},
  freelancer_verified_status: { type: mongoose.Schema.Types.Mixed, default: "pending" },
  skills: { type: [String], default: ["Shopify", "Next.js"] },
  projectType: { type: String,enum: ["fixed", "hourly"], default: 'fixed' },
  minFixedBudget: { type: Number, default: 50 },
  maxFixedBudget: { type: Number, default: 500 },
  minHourlyBudget: { type: Number, default: 10 },
  maxHourlyBudget: { type: Number, default: 100 },
  countries: { type: [String], default: [] },
  timezones: { type: [String], default: [] },
}, { timestamps: true }); 

const UserConfig = mongoose.model('UserConfig', userConfigSchema);
module.exports = UserConfig;
