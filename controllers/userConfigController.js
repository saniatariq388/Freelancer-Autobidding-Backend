// const UserConfig = require('../models/userConfig');  



// // ----------------------------------------------------------Fetch user configuration by userId from query string
// const getUserConfig = async (req, res) => {
//   try {
//     const { userId } = req.query;
//     console.log("➡️  GET /api/config userId:", userId);
//     if (!userId) return res.status(400).json({ error: "userId is required" });

//     const doc = await UserConfig.findOne({ userId }).lean();
//     if (!doc) return res.status(404).json({ error: "User config not found" });

//     return res.json(doc);
//   } catch (e) {
//     console.error("getUserConfig error:", e);
//     return res.status(500).json({ error: "Failed to fetch user config" });
//   }
// };

// function extractDefaultsFromSchema(schema) {
//   const fields = [
//     'skills','projectType','minFixedBudget','maxFixedBudget',
//     'minHourlyBudget','maxHourlyBudget','countries','timezones'
//   ];
//   const out = {};
//   for (const f of fields) {
//     const p = schema.path(f);
//     if (!p) continue;
//     const def = p.options?.default;
//     out[f] = typeof def === 'function' ? def() : def;
//   }
//   return out;
// }

// const getConfigDefaults = (req, res) => {
//   try {
//     const defaults = extractDefaultsFromSchema(UserConfig.schema);
//     return res.json(defaults);
//   } catch (e) {
//     console.error("getConfigDefaults error:", e);
//     return res.status(500).json({ error: "Failed to read config defaults" });
//   }
// };





// //------------------------------------------------- Create a new user configuration
// const createUserConfig = async (req, res) => {
//   try {
//     console.log("➡️  PUT /api/config/", req.params.userId, " body:", req.body);
//      console.log("Received data for new user config:", req.body);
//     const { userId, userName, skills, projectType, minFixedBudget, maxFixedBudget, minHourlyBudget, maxHourlyBudget, countries, timezones } = req.body;

//      if (!userId || !skills || !projectType) {
//       return res.status(400).json({ error: "Missing required fields" }); // Validate if key fields are missing
//     }


//     //----------------------------------------- Create a new user config
//     const newUserConfig = new UserConfig({
//       userId,
//       skills,
//       projectType,
//       minFixedBudget,
//       maxFixedBudget,
//       minHourlyBudget,
//       maxHourlyBudget,
//       countries,
//       timezones
//     });

//     await newUserConfig.save();  // Save the new user config to MongoDB
//     console.log("New user config created:", newUserConfig);
//     res.status(201).json(newUserConfig);  // Return the created config
//   } catch (error) {
//     console.error('Error creating user config:', error);
//     res.status(500).json({ error: 'Failed to create user config' });
//   }
// };

// // Update an existing user configuration
// const updateUserConfig = async (req, res) => {
//   try {
//     const { userId } = req.params;  // Extract userId from the URL path
//     const updatedData = req.body;  // Get the updated data from the request body
//     console.log("➡️  POST /api/config body:", req.body);
//     // Find the user config by userId and update it with the new data
//     const updatedConfig = await UserConfig.findOneAndUpdate(
//       { userId },
//       { $set: updatedData },
//       { new: true }  // Return the updated document
//     );

//     if (!updatedConfig) {
//       return res.status(404).json({ error: "User config not found" });
//     }

//     res.json(updatedConfig);  // Return the updated user config
//   } catch (error) {
//     console.error('Error updating user config:', error);
//     res.status(500).json({ error: 'Failed to update user config' });
//   }
// };

// module.exports = { getUserConfig, getConfigDefaults, createUserConfig, updateUserConfig };









//----------------------------------------------





const UserConfig = require("../models/userConfig");
const User = require("../models/user");
// verify helpers
function isVerified(v) {
  if (v == null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() === "verified" || v === "true";
  if (typeof v === "object") {
    const s = v.status ?? v.state ?? v.value;
    if (typeof s === "string") return s.toLowerCase() === "verified";
  }
  return false;
}

function normalizeVerified(v) {
  // store a consistent value; you can change to { status: "verified" } if you prefer
  return isVerified(v) ? "verified" : null;
}

const pick = (obj, keys) =>
  Object.fromEntries(
    Object.entries(obj || {}).filter(([k, v]) => keys.includes(k) && v !== undefined)
  );

const getUid = (req) => {
  const fromCookie = req.cookies?.uid;
  if (fromCookie && !isNaN(Number(fromCookie))) return Number(fromCookie);
  const q = req.query?.userId;
  if (q && !isNaN(Number(q))) return Number(q);
  return null;
}

const getMyConfig = async (req, res) => {
  try {
    const uid = getUid(req);
    console.log("User ID:", uid);
    if (!uid) return res.status(401).json({ ok: false, error: "Missing user identity (uid cookie)" });

    let doc = await UserConfig.findOne({ userId: uid }).lean();
    console.log("User Config Document:", doc);

    const userDoc = await User.findOne({ id: uid }).lean();
    const userVerified = normalizeVerified(userDoc?.freelancer_verified_status);
    const userEmail = userDoc?.email ?? null;


    if (!doc) {
      return res.json({
        ok: true,
        config: {
          userId: uid,
          skills: [],
          countries: [],
          projectType: "fixed",
          minFixedBudget: 0,
          maxFixedBudget: 0,
          minHourlyBudget: 0,
          maxHourlyBudget: 0,
          timezones: [],
          email: null,
          freelancer_verified_status: null,
          _exists: false,
        },
      });
    }
    if (!isVerified(doc.freelancer_verified_status) && isVerified(userVerified)) {
      await UserConfig.updateOne(
        { userId: uid },
        {
          $set: {
            freelancer_verified_status: userVerified, // "verified"

            ...(userEmail ? { email: userEmail } : {}),
          },
        }
      );
      doc = await UserConfig.findOne({ userId: uid }).lean();
    }


    return res.json({ ok: true, config: doc });
  } catch (e) {
    console.error("getMyConfig error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "Failed to fetch config" });
  }
};

const updateMyConfig = async (req, res) => {
  try {
    const uid = getUid(req);
    console.log("user uid: ", uid)
    if (!uid) return res.status(401).json({ ok: false, error: "Missing user identity (uid cookie)" });

    const allowed = [
      "skills",
      "countries",
      "projectType",
      "minFixedBudget",
      "maxFixedBudget",
      "minHourlyBudget",
      "maxHourlyBudget",
      "timezones",
      "email",
      "freelancer_verified_status",
    ];

    const data = pick(req.body, allowed);
    console.log("user data: ", data)

    // normalize arrays
    if (Array.isArray(data.skills)) data.skills = [...new Set(data.skills.map(String).filter(Boolean))];
    if (Array.isArray(data.countries)) data.countries = [...new Set(data.countries.map(String).filter(Boolean))];
    if (Array.isArray(data.timezones)) data.timezones = [...new Set(data.timezones.map(String).filter(Boolean))];

    // 🔐 Only set verified if it is actually verified; otherwise do not overwrite existing value
    if ("freelancer_verified_status" in data) {
      const normalized = normalizeVerified(data.freelancer_verified_status);
      if (isVerified(normalized)) {
        data.freelancer_verified_status = normalized; // "verified"
      } else {
        // Not verified ⇒ don't touch the field
        // delete data.freelancer_verified_status;
        console.log(data.freelancer_verified_status);
      }
    }


    await UserConfig.updateOne({ userId: uid }, { $set: { userId: uid, ...data } }, { upsert: true });
    const saved = await UserConfig.findOne({ userId: uid }).lean();
    console.log("user config in Mongodb updated: ", saved)
    return res.json({ ok: true, config: saved });
  } catch (e) {
    console.error("updateMyConfig error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "Failed to update config" });
  }
};


module.exports = { getMyConfig, updateMyConfig, getUid }
