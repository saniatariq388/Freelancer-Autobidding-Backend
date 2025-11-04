// const User = require('../models/user');
// const UserConfig = require('../models/userConfig');
// const { fetchSelfUser } = require('../services/freelancerService');

// // helper: schema defaults (NO DB WRITE)
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

// // GET /api/user/self

// // exports.getSelfAndCache = async (req, res) => {
// //   try {
// //     console.log("➡️  GET /api/user/self");


// //     // try {
// //       const fl = await fetchSelfUser(); 
// //       // if (!fl?.id) {
// //       //    console.warn("🟨 freelancer/self returned no id");
// //       //   // const defaults = extractDefaultsFromSchema(UserConfig.schema);
// //       //    return res.json({ ok: true, source: "none", user: null, configDefaults: defaults });
// //       // }
// //       // else{
// //        console.log(f1.json())
// //        //return f1.User
// //       // }

// //       //-------------------- map fields
// //       // const payload = {
// //       //   userId:   String(fl.id),
// //       //   userName: fl.public_name || fl.username,
// //       //   email:    fl.email || undefined,
// //       //   verified: !!(fl?.status?.email_verified || fl?.status?.payment_verified),
// //       //   raw:      fl
// //       // };

// //       //------------------- upsert (User collection) 
// //       // const saved = await User.findOneAndUpdate(
// //       //   { userId: payload.userId },
// //       //   { $set: payload },
// //       //   { upsert: true, new: true }
// //       // );

// //     //   console.log("✅ saved/updated user:", saved.userId);
// //     //   return res.json({ ok: true, source: "freelancer", user: saved });
// //     // }
// //     //  catch (e) {
// //     //   console.warn("🟨 freelancer/self failed:", e?.status, String(e?.body || e?.message || e).slice(0,150));

// //     //   const defaults = extractDefaultsFromSchema(UserConfig.schema);
// //     //   return res.json({ ok: true, source: "none", user: null, configDefaults: defaults });
// //     // }
// //   }
// //    catch (err) 
// //   {
// //     console.error("💥 /api/user/self error:", err);
// //     return res.status(500).json({ error: "Failed to resolve user" });
// //   }
// // };

//  exports.fetchSelfUser = async () => {
//    const data = await freelancerGet("https://www.freelancer.com/api/users/0.1/self/");
//    console.log(data)
//    return data?.result || null;

//  };




//-----------------------------------------

// controllers/userController.js
// const User = require("../models/User");

// // GET /api/user/self
// exports.getSelfAndUpsert = async (req, res) => {
//   try {
//     // ⚠️ For production, do NOT hardcode; use header/env.
//     const resp = await fetch("https://www.freelancer.com/api/users/0.1/self/", {
//       headers: {
//         Authorization: `Bearer m2HRR5pBj4iu1wf5yzDnXhzxyV3cTv`,
//       },
//     });

//     if (!resp.ok) {
//       const text = await resp.text().catch(() => "");
//       return res.status(resp.status).json({
//         ok: false,
//         error: `Freelancer API ${resp.status}: ${text.slice(0, 300)}`,
//       });
//     }

//     // ✅ With fetch you MUST parse:
//     const json = await resp.json();

//     // Freelancer usually wraps in { result: {...} }
//     const data = json?.result ?? json;

//     if (!data || typeof data !== "object" || !data.id) {
//       // Helpful debug (remove in prod):
//       console.error("Freelancer raw JSON:", JSON.stringify(json, null, 2));
//       return res.status(502).json({ ok: false, error: "Unexpected Freelancer API response" });
//     }

//     // Upsert by the freelancer 'id' field, store the payload as-is
//     const saved = await User.updateOne(
//       { id: data.id },
//       { $set: data },
//       { upsert: true, new: true, setDefaultsOnInsert: true }
//     ).lean();

//     return res.json({ ok: true, user: saved });
//   } catch (err) {
//     console.error("getSelfAndUpsert error:", err?.message || err);
//     return res.status(500).json({ ok: false, error: "Failed to fetch Freelancer self" });
//   }
// };







//--------------------------
const User = require("../models/user");

// how long cache is "fresh" (e.g. 60 minutes)
const CACHE_TTL_MIN = Number(process.env.USER_CACHE_TTL_MIN || 60);

async function fetchFreelancerSelf(authHeader) {
  const resp = await fetch("https://www.freelancer.com/api/users/0.1/self/", {
    headers: { Authorization: authHeader },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Freelancer API ${resp.status}: ${text.slice(0, 300)}`);
  }
  const json = await resp.json();
  const data = json?.result ?? json;
  if (!data || typeof data !== "object" || !data.id) {
    throw new Error("Unexpected Freelancer API response");
  }
  return data;
}

function isFresh(updatedAt) {
  if (!updatedAt) return false;
  const ageMin = (Date.now() - new Date(updatedAt).getTime()) / 60000;
  return ageMin < CACHE_TTL_MIN;
}


exports.getSelfSmart = async (req, res) => {
  try {
    const refresh = req.query.refresh === "1";
    const uidCookie = req.cookies?.uid ? Number(req.cookies.uid) : null;

    // Try fast path: cached Mongo by cookie uid (if present)
    if (uidCookie && !refresh) {
      const cached = await User.findOne({ id: uidCookie }).lean();
      if (cached && isFresh(cached.updatedAt)) {
        console.log("GET /api/user/self → From MongoDB (fresh):", {
          userId: cached.id,
          username: cached.username,
          email: cached.email,
          verified: cached.freelancer_verified_status
        });
        return res.json({ ok: true, source: "mongo", user: cached, cached: true });
      }


      // If cached exists but stale and no token, still return stale copy gracefully

      if (cached && !req.headers.authorization && !process.env.FREELANCER_OAUTH_TOKEN) {

        console.log("GET /api/user/self → From MongoDB (stale, no token):", {
          userId: cached.id,
          username: cached.username,
          email: cached.email,
          verified: cached.freelancer_verified_status
        });

        return res.json({ ok: true, source: "mongo-stale", user: cached, cached: true });
      }
    }

    // Need to fetch from Freelancer (first time OR stale OR force refresh)
    let auth = req.headers.authorization || process.env.FREELANCER_OAUTH_TOKEN;
    if (auth && !auth.toLowerCase().startsWith("bearer ")) auth = `Bearer ${auth}`;
    if (!auth) {

      // If we have a cookie and a cached doc (but stale) and no token → return it
      if (uidCookie) {
        const fallback = await User.findOne({ id: uidCookie }).lean();
        if (fallback) {

          console.log("GET /api/user/self → Fallback (stale, no token):", {
            userId: fallback.id,
            username: fallback.username,
            email: fallback.email,
            verified: fallback.freelancer_verified_status
          });

          return res.json({ ok: true, source: "mongo-stale", user: fallback, cached: true });
        }
      }
      return res.status(401).json({ ok: false, error: "Missing Bearer token" });
    }

    // Fetch fresh from Freelancer, upsert, return, and set cookie
    const data = await fetchFreelancerSelf(auth);

    const flatData = {
      ...data,
      country: data.location?.country?.name
        ? { name: data.location.country.name }
        : null,
      city: data.location?.city || null,
      timezone: data.timezone ? {
        id: data.timezone.id,
        country: data.timezone.country,
        timezone: data.timezone.timezone,
        offset: data.timezone.offset,
      } : null,
    }
    await User.updateOne({ id: data.id }, { $set: flatData }, { upsert: true });
    const saved = await User.findOne({ id: data.id }).lean();

    console.log("GET /api/user/self → Fresh from Freelancer.com:", {
      userId: saved.id,
      username: saved.username,
      email: saved.email,
      role: saved.role,
      freelancer_verified_status: saved.freelancer_verified_status,
      country: saved.country?.name,
      city: saved.city,
      timezone: saved.timezone?.timezone,
    });

    // set httpOnly cookie for future fast reads
    res.cookie("uid", String(data.id), {
      httpOnly: true,
       sameSite:  'none' ,
       secure:   true,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    return res.json({ ok: true, source: "freelancer", user: saved, cached: false });
  } catch (err) {
  console.error("getSelfSmart error:", err?.message || err);

  // 🔁 Try stale fallback by cookie uid if exists
  const uidCookie = req.cookies?.uid ? Number(req.cookies.uid) : null;
  if (uidCookie) {
    const fallback = await User.findOne({ id: uidCookie }).lean();
    if (fallback) {
      return res.json({ ok: true, source: "mongo-stale", user: fallback, cached: true, error: String(err?.message || err) });
    }
  }

  // last resort: json 500 (par JSON hi rahe)
  return res.status(500).json({ ok: false, error: err?.message || "Failed to resolve user" });
}

};
