// const mongoose = require('mongoose');

// const userSchema = new mongoose.Schema(
//   {
//     userId:   { type: String, required: true, unique: true, index: true },
//     userName: { type: String, trim: true },
//     email:    { type: String, trim: true, lowercase: true },
//     verified: { type: Boolean, default: false },
//     raw:      { type: mongoose.Schema.Types.Mixed },
//   },
//   { timestamps: true }
// );

// module.exports = mongoose.model('User', userSchema);


//---------------------------------------
const mongoose = require("mongoose");

const CountrySchema = new mongoose.Schema(
  { name: { type: String } },
  { _id: false }
);

const TimezoneSchema = new mongoose.Schema(
  {
    id: { type: Number, },
    country: { type: String },
    timezone: { type: String },
    offset: { type: Number },
  },
  { _id: false }
);

const UserSchema = new mongoose.Schema(
  {
    // Freelancer ka original id field hi store kar rahe hain
    id: { type: Number, required: true, unique: true, index: true },

    username: { type: String, default: null },
    email: { type: String, default: null },
    hourly_rate: { type: Number, default: null },

    country: { type: CountrySchema, default: {} },
    city: { type: String, default: null },
    role: { type: String, default: null },

    timezone: { type: TimezoneSchema, default: {} },

    registration_completed: { type: Boolean, default: false },
    is_profile_visible: { type: Boolean, default: false },

    // kabhi string / object / null ho sakta hai → Mixed raho
    freelancer_verified_status: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.models.User || mongoose.model("User", UserSchema);
