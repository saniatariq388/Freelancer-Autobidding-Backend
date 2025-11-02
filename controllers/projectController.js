

//--------------------------------------------------------------------------------------





const { fetchActiveProjects } = require('../services/freelancerService');
const Project = require('../models/project');
const UserConfig = require('../models/userConfig');
const { getUid } = require('./userConfigController');

// ------------------- GET USER CONFIG -------------------
const getUserConfig = async (userId) => {
  const id = Number(userId);
  if (isNaN(id)) throw new Error("Invalid userId");

  const config = await UserConfig.findOne({ userId: id }).lean();
  if (!config) {
    return {
      userId: id,
      skills: [],
      minFixedBudget: 0,
      maxFixedBudget: Infinity,
      minHourlyBudget: 0,
      maxHourlyBudget: Infinity,
      projectType: null
    };
  }
  return config;
};

// ------------------- MANUAL FETCH (API CALL) -------------------
const fetchAndSaveProjects = async (req, res) => {
  try {
    const userId = getUid(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Login required" });

    console.log("\n" + "=".repeat(80));
    console.log("MANUAL FETCH REQUEST: USER", userId);
    console.log("=".repeat(80));

    const startedAt = Date.now();
    const config = await getUserConfig(userId);

    // === 1. USER SKILLS ===
    const userSkills = (config.skills || [])
      .map(s => String(s).trim().toLowerCase().replace(/\s+/g, ' '))
      .filter(Boolean);

    if (userSkills.length === 0) {
      return res.json({ ok: true, total: 0, matched: 0, final: 0, saved: 0, projects: [] });
    }

    console.log("Skills:", userSkills.join(', '));
    console.log("Budget Fixed:", config.minFixedBudget, "to", config.maxFixedBudget);
    if (config.projectType) console.log("Type:", config.projectType);

    // === 2. PAGINATION (MAX 2000) ===
    let allProjects = [];
    let offset = 0;
    const BATCH_SIZE = 100;
    let hasMore = true;
    let emptyBatches = 0;

    while (hasMore && emptyBatches < 2 && allProjects.length < 2000) {
      const batch = await fetchActiveProjects({
        skills: userSkills,
        limit: BATCH_SIZE,
        offset
      });

      if (batch.length === 0) {
        emptyBatches++;
        console.log(`Empty batch at offset ${offset}`);
      } else {
        emptyBatches = 0;
        console.log(`Fetched ${batch.length} projects (total: ${allProjects.length + batch.length})`);
        allProjects.push(...batch);
      }

      offset += BATCH_SIZE;
      await new Promise(r => setTimeout(r, 800));
    }

    console.log(`TOTAL COLLECTED: ${allProjects.length}`);

    if (allProjects.length === 0) {
      return res.json({ ok: true, total: 0, matched: 0, final: 0, saved: 0, projects: [] });
    }

    // === 3. SKILL MATCH (ANYWHERE) ===
    const skillMatched = allProjects.filter(p => {
      const projectSkills = (p.jobs || []).map(j => j.name.toLowerCase().trim());
      const title = (p.title || '').toLowerCase();
      const desc = (p.preview_description || '').toLowerCase();

      return projectSkills.some(s => userSkills.includes(s)) ||
        userSkills.some(s => title.includes(s)) ||
        userSkills.some(s => desc.includes(s));
    });

    console.log(`SKILL MATCHED: ${skillMatched.length} projects`);

    if (skillMatched.length === 0) {
      return res.json({ ok: true, total: allProjects.length, matched: 0, final: 0, saved: 0, projects: [] });
    }

    // === 4. BUDGET + TYPE FILTER ===
    const finalPassed = skillMatched.filter(p => {
      if (p.type !== 'fixed') return false;
      if (!p.budget?.minimum || !p.budget?.maximum) return false;

      const projectMin = p.budget.minimum;
      const projectMax = p.budget.maximum;

      const budgetOK = (projectMax >= config.minFixedBudget) && (projectMin <= config.maxFixedBudget);
      const typeOK = !config.projectType || p.type === config.projectType;

      if (budgetOK && typeOK) {
        console.log(`PASS: ${p.title} ($${projectMin}–$${projectMax})`);
      } else {
        console.log(`SKIP: ${p.title}`);
      }

      return budgetOK && typeOK;
    });

    console.log(`FINAL PASSED: ${finalPassed.length} projects`);

    // === 5. DISPLAY FINAL PROJECTS ===
    if (finalPassed.length > 0) {
      console.log("\n" + "=".repeat(80));
      console.log(`PROJECTS TO SAVE: ${finalPassed.length}`);
      console.log("=".repeat(80));

      finalPassed.forEach((p, i) => {
        const budget = `$${p.budget.minimum}–$${p.budget.maximum}`;
        const skills = (p.jobs || [])
          .filter(j => userSkills.includes(j.name.toLowerCase().trim()))
          .map(j => j.name)
          .join(', ');

        console.log(`\n[${i + 1}] ${p.title}`);
        console.log(`   ID: ${p.id} | Budget: ${budget}`);
        console.log(`   Link: https://www.freelancer.com/projects/${p.seo_url || p.id}`);
        console.log(`   Skills: ${skills || 'None'}`);
        console.log("   " + "-".repeat(60));
      });
    }

    // === 6. SAVE TO DB ===
    let saved = 0;
    if (finalPassed.length > 0) {
      const operations = finalPassed.map(p => ({
        updateOne: {
          filter: { platformId: p.id },
          update: {
            $set: {
              platformId: p.id,
              title: p.title || "No Title",
              type: p.type || "unknown",
              budget: p.budget || {},
              country: p.owner?.location?.country?.name || 'Unknown',
              jobs: p.jobs || [],
              skills: (p.jobs || []).map(j => j.name.toLowerCase().trim()).filter(Boolean),
              raw: p,
              status: "new",
              time_submitted: p.time_submitted,
              userId
            }
          },
          upsert: true
        }
      }));

      const result = await Project.bulkWrite(operations, { ordered: false });
      saved = result.upsertedCount + result.modifiedCount;
    }

    const ms = Date.now() - startedAt;
    console.log(`\nRESULT: matched=${skillMatched.length} final=${finalPassed.length} saved=${saved} in ${ms}ms`);
    console.log("=".repeat(80) + "\n");

    // === 7. RESPONSE ===
    res.json({
      ok: true,
      totalFetched: allProjects.length,
      skillMatched: skillMatched.length,
      final: finalPassed.length,
      saved,
      projects: finalPassed.map(p => ({
        id: p.id,
        title: p.title,
        budget: p.budget,
        link: `https://www.freelancer.com/projects/${p.seo_url || p.id}`
      }))
    });

  } catch (err) {
    console.error("MANUAL FETCH ERROR:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
};

// ------------------- GET SAVED PROJECTS -------------------
const getSavedProjects = async (req, res) => {
  try {
    const uid = getUid(req);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 10000);
    const projects = await Project.find({
      userId: uid,
      status: "new"
    })
      .sort({ time_submitted: -1 })
      .limit(limit)
      .lean();

    const totalSaved = await Project.countDocuments()

    const formatted = projects.map(p => ({
      id: p.platformId,
      title: p.title,
      budget: p.budget?.minimum
        ? `$${p.budget.minimum} - $${p.budget?.maximum}`
        : 'N/A',
      link: `HTTPS://www.freelancer.com/projects/${p.platformId}`,
      time: p.time_submitted
        ? new Date(p.time_submitted * 1000).toLocaleString()
        : '-'
    }));


    res.json({
      ok: true,
      count: projects.length,
      totalSaved,
      projects: formatted
    });
  } catch (err) {
    console.error("getSavedProjects error:", err);
    res.status(500).json({ ok: false, error: "Failed" });
  }
};

module.exports = {
  fetchAndSaveProjects,
  getSavedProjects
};





// -----------is main sab skip karaha h 

// // -------------------------------------------------------
// const { isWithinLast24Hours } = require('../utils/time');
// const Project = require('../models/project');
// const UserConfig = require('../models/userConfig');
// const { fetchActiveProjects } = require('../services/freelancerService');
// const { getUid } = require('./userConfigController'); 

// // =============================

// async function getUserConfig(userId) {
//   if (!userId) throw new Error("userId is required");

//   const id = Number(userId);
//   if (isNaN(id)) throw new Error("Invalid userId");

//   console.log("Fetching UserConfig for userId:", id);

//   const userConfig = await UserConfig.findOne({ userId: id }).lean();
//   console.log("Fetched UserConfig from MongoDB:", userConfig);

//   if (!userConfig) {
//     console.log("No config found, using defaults");
//     return {
//       userId: id,
//       skills: [],
//       countries: [],
//       minFixedBudget: 0,
//       maxFixedBudget: Infinity,
//       minHourlyBudget: 0,
//       maxHourlyBudget: Infinity,
//       freelancer_verified_status: null,
//     };
//   }

//   return userConfig;
// }


// // --------------------FILTER PROJECTS (3 CONDITIONS + LOGS)

// async function filterProjectsForBidding(userId, projectsToFilter) {
//   console.log("Filtering projects for userId:", userId);

//   const config = await getUserConfig(userId);
//   console.log("User Config Applied:", {
//     skills: config.skills,
//     countries: config.countries,
//     minFixed: config.minFixedBudget,
//     maxFixed: config.maxFixedBudget,
//     minHourly: config.minHourlyBudget,
//     maxHourly: config.maxHourlyBudget,
//     verified: config.freelancer_verified_status
//   });

//   // VERIFIED CONDITION IS OPTIONAL — REMOVED


//   // -------------abhi ky liay skip ki hai 
//   // 2. User must be verified
//   // if (config.freelancer_verified_status !== "verified") {
//   //   console.log("User is not verified, skipping all bids.");
//   //   return [];
//   // }




//   const filteredProjects = projectsToFilter.filter((project) => {
//     const type = project.type?.includes("hourly") ? "hourly" : "fixed";
//     const projectSkills = (project.jobs || []).map(j => j.name.toLowerCase());
//     const country = project.owner?.country?.code || "";
//     const min = project.budget?.minimum || 0;
//     const max = project.budget?.maximum || 0;

//     //---------------------------- Condition 1: Budget
//     const budgetOK = !project.budget || !project.budget.minimum || !project.budget.maximum ||
//       (type === "hourly" &&
//         min >= (config.minHourlyBudget || 0) &&
//         max <= (config.maxHourlyBudget || Infinity)) ||
//       (type === "fixed" &&
//         min >= (config.minFixedBudget || 0) &&
//         max <= (config.maxFixedBudget || Infinity));

//     if (!budgetOK) {
//       console.log("Skip [Budget]", { id: project.id, title: project.title, type, min, max });
//     }

//     // -----------------------------Condition 2: Skills
//     const skillsOK =
//       Array.isArray(config.skills) &&
//       config.skills.length > 0 &&
//       config.skills.some(s => projectSkills.includes(s.toLowerCase()));

//     if (!skillsOK) {
//       console.log("Skip [Skills]", { id: project.id, title: project.title, projectSkills, configSkills: config.skills });
//     }

//     // ---------------------------Condition 3: Country
//     // abhi ky liay change
//     // const countryOK =
//     //   Array.isArray(config.countries) &&
//     //   config.countries.length > 0 &&
//     //   config.countries.includes(country);


//       const countryOK = !country || 
//   (config.countries.length === 0 || config.countries.includes(country));

//     if (!countryOK) {
//       console.log("Skip [Country]", { id: project.id, title: project.title, country, configCountries: config.countries });
//     }

//     if (!budgetOK || !skillsOK || !countryOK) {
//       console.log("Skip Project", { id: project.id, title: project.title, reason: { budgetOK, skillsOK, countryOK } });
//       return false;
//     }

//     console.log("PASS [All 3 OK]", {
//       id: project.id,
//       title: project.title,
//       type,
//       budget: `${min}-${max}`,
//       country,
//       matchedSkill: projectSkills.find(s => config.skills.map(ss => ss.toLowerCase()).includes(s))
//     });

//     return true;
//   });

//   console.log(`FINAL: ${filteredProjects.length} projects passed (budget + skills + country)`);
//   return filteredProjects;
// }


// //------------------------ GET SAVED PROJECTS

// const getSavedProjects = async (req, res) => {
//   try {
//     const projects = await Project.find({ status: "new" })
//       .sort({ time_submitted: -1 })
//       .limit(50)
//       .lean();

//     res.json({ ok: true, projects });
//   } catch (err) {
//     console.error("getSavedProjects error:", err);
//     res.status(500).json({ error: "Failed to fetch saved projects" });
//   }
// };


// // ----------------------FETCH & SAVE PROJECTS

// const fetchAndSaveProjects = async (req, res) => {
//   try {
//     const userId = getUid(req);
//     if (!userId) {
//       return res.status(401).json({ ok: false, error: "user not login! (uid cookie missing)" });
//     }

//     console.log("User ID from cookie/query:", userId);
//     const startedAt = Date.now();

//     const {
//       limit = 20,
//       query = "",
//       skills = "",
//       projectType = "",
//       preferredOnly = "false",
//       verifiedOnly = "false",
//     } = req.query;

//     const skillsArr = String(skills).trim() ? String(skills).split(",").map(s => s.trim()).filter(Boolean) : [];
//     console.log("Skills from query:", skillsArr);

//     // GET USER CONFIG (with defaults)
//     const userConfig = await getUserConfig(userId);
//     console.log("UserConfig skills:", userConfig.skills);
//     console.log("UserConfig countries:", userConfig.countries);

//     // MERGE SKILLS: UI + DB
//     const skillsFromConfig = userConfig.skills || [];
//     const mergedSkills = [...new Set([...skillsArr, ...skillsFromConfig])];
//     console.log("Merged Skills:", mergedSkills);

//     // FETCH FROM FREELANCER API
//     const items = await fetchActiveProjects({
//       limit: Number(limit),
//       query: String(query),
//       skills: mergedSkills,
//       projectType: projectType || undefined,
//       preferredOnly: preferredOnly === "true",
//       verifiedOnly: verifiedOnly === "true",
//     });

//     const recent = items.filter(p => isWithinLast24Hours(p.time_submitted));
//     const filtered = await filterProjectsForBidding(userId, recent);

//     // SAVE TO DB
//     let upserts = 0;
//     for (const p of filtered) {
//       if (!p?.id) continue;
//       const update = {
//         $set: {
//           platformId: p.id,
//           title: p.title || "",
//           preview_description: p.preview_description || "",
//           status: "new",
//           type: p.type || "",
//           time_submitted: p.time_submitted || null,
//           bid_stats: p.bid_stats || {},
//           budget: p.budget || {},
//           currency: p.currency || {},
//           jobs: p.jobs || [],
//           raw: p,
//         },
//       };
//       const r = await Project.updateOne({ platformId: p.id }, update, { upsert: true });
//       if (r.upsertedCount || r.modifiedCount) upserts++;
//     }

//     const ms = Date.now() - startedAt;
//     console.log(`[/api/projects] fetched=${items.length} recent=${recent.length} saved=${upserts} in ${ms}ms`);
//     res.json({ ok: true, fetched: items.length, recent: recent.length, saved: upserts, projects: filtered });
//   } catch (err) {
//     console.error("[/api/projects] error:", err);
//     res.status(500).json({ error: "Failed to fetch projects", detail: String(err?.message || err) });
//   }
// };


// module.exports = {
//   fetchAndSaveProjects,
//   getSavedProjects,
// };













//---------------------for this time skills priority---------




// // -------------------------------------------------------
// const { isWithinLast24Hours } = require('../utils/time');
// const Project = require('../models/project');
// const UserConfig = require('../models/userConfig');
// const { fetchActiveProjects } = require('../services/freelancerService');
// const { getUid } = require('./userConfigController'); 

// // =============================

// async function getUserConfig(userId) {
//   if (!userId) throw new Error("userId is required");

//   const id = Number(userId);
//   if (isNaN(id)) throw new Error("Invalid userId");

//   console.log("Fetching UserConfig for userId:", id);

//   const userConfig = await UserConfig.findOne({ userId: id }).lean();
//   console.log("Fetched UserConfig from MongoDB:", userConfig);

//   if (!userConfig) {
//     console.log("No config found, using defaults");
//     return {
//       userId: id,
//       skills: [],
//       countries: [],
//       minFixedBudget: 0,
//       maxFixedBudget: Infinity,
//       minHourlyBudget: 0,
//       maxHourlyBudget: Infinity,
//       freelancer_verified_status: null,
//     };
//   }

//   return userConfig;
// }


// // --------------------FILTER PROJECTS (3 CONDITIONS + LOGS)

// // async function filterProjectsForBidding(userId, projectsToFilter) {
// //   console.log("Filtering projects for userId:", userId);

// //   const config = await getUserConfig(userId);
// //   console.log("User Config Applied:", {
// //     skills: config.skills,
// //     countries: config.countries,
// //     minFixed: config.minFixedBudget,
// //     maxFixed: config.maxFixedBudget,
// //     minHourly: config.minHourlyBudget,
// //     maxHourly: config.maxHourlyBudget,
// //     verified: config.freelancer_verified_status
// //   });

// //   // VERIFIED CONDITION IS OPTIONAL — REMOVED


// //   // -------------abhi ky liay skip ki hai 
// //   // 2. User must be verified
// //   // if (config.freelancer_verified_status !== "verified") {
// //   //   console.log("User is not verified, skipping all bids.");
// //   //   return [];
// //   // }




// //   const filteredProjects = projectsToFilter.filter((project) => {
// //     const type = project.type?.includes("hourly") ? "hourly" : "fixed";
// //     const projectSkills = (project.jobs || []).map(j => j.name.toLowerCase());
// //     const country = project.owner?.country?.code || "";
// //     const min = project.budget?.minimum || 0;
// //     const max = project.budget?.maximum || 0;

// //     //---------------------------- Condition 1: Budget
// //     const budgetOK = 
// //       (type === "hourly" &&
// //         min >= (config.minHourlyBudget || 0) &&
// //         max <= (config.maxHourlyBudget || Infinity)) ||
// //       (type === "fixed" &&
// //         min >= (config.minFixedBudget || 0) &&
// //         max <= (config.maxFixedBudget || Infinity));

// //     if (!budgetOK) {
// //       console.log("Skip [Budget]", { id: project.id, title: project.title, type, min, max });
// //     }

// //     // -----------------------------Condition 2: Skills
// //     // const skillsOK = !config.skills?.length > 0|| 
// //     // config.skills.some(s => projectSkills.includes(s.toLowerCase()));

// //     // if (!skillsOK) {
// //     //   console.log("Skip [Skills]", { id: project.id, title: project.title, projectSkills, configSkills: config.skills });
// //     // }

// //     // ---------------------------Condition 3: Country
// //     // abhi ky liay change
// //     // const countryOK =
// //     //   Array.isArray(config.countries) &&
// //     //   config.countries.length > 0 &&
// //     //   config.countries.includes(country);


// //       const countryOK = !country || 
// //     !config.countries.length  || config.countries.includes(country);

// //     if (!countryOK) {
// //       console.log("Skip [Country]", { id: project.id, title: project.title, country, configCountries: config.countries });
// //     }

// //     if (!budgetOK  || !countryOK) {
// //       console.log("Skip Project", { id: project.id, title: project.title, reason: { budgetOK, countryOK } });
// //       return false;
// //     }

// //     console.log("PASS [All OK]", {
// //       id: project.id,
// //       title: project.title,
// //       type,
// //       budget: `${min}-${max}`,
// //       country,
// //       matchedSkill: projectSkills.find(s => config.skills.map(ss => ss.toLowerCase()).includes(s))
// //     });

// //     return true;
// //   });

// //   console.log(`FINAL: ${filteredProjects.length} projects passed (budget + skills + country)`);
// //   return filteredProjects;
// // }


// // utils/filterProjects.js
// async function filterProjectsForBidding(userId, projects) {
//   const config = await getUserConfig(userId);
//   const { countries, minFixedBudget, maxFixedBudget, minHourlyBudget, maxHourlyBudget, projectType } = config;

//   const passed = [];

//   for (const p of projects) {
//     if (!p || !p.id) continue;

//     let budgetOK = false;
//     const countryCode = p.owner?.location?.country?.code || '';
//     const countryOK = countries.length === 0 || countries.includes(countryCode);
//     const typeOK = !projectType || p.type === projectType;

//     if (p.type === 'fixed') {
//       const min = p.budget?.minimum || 0;
//       const max = p.budget?.maximum || Infinity;
//       budgetOK = min >= minFixedBudget && max <= maxFixedBudget;
//     } else if (p.type === 'hourly') {
//       const [minStr, maxStr] = String(p.budget?.price || '0-0').split('-');
//       const min = parseInt(minStr) || 0;
//       const max = parseInt(maxStr) || Infinity;
//       budgetOK = min >= minHourlyBudget && max <= maxHourlyBudget;
//     }

//     if (budgetOK && countryOK && typeOK) {
//       passed.push(p);
//     }
//   }

//   return { passed, skipped: [] };
// }

// //------------------------ GET SAVED PROJECTS

// const getSavedProjects = async (req, res) => {
//   try {
//     const projects = await Project.find({ status: "new" })
//       .sort({ time_submitted: -1 })
//       .limit(50)
//       .lean();

//     res.json({ ok: true, projects });
//   } catch (err) {
//     console.error("getSavedProjects error:", err);
//     res.status(500).json({ error: "Failed to fetch saved projects" });
//   }
// };


// // ----------------------FETCH & SAVE PROJECTS

// // const fetchAndSaveProjects = async (req, res) => {
// //   try {
// //     const userId = getUid(req);
// //     if (!userId) {
// //       return res.status(401).json({ ok: false, error: "user not login! (uid cookie missing)" });
// //     }

// //     console.log("User ID from cookie/query:", userId);
// //     const startedAt = Date.now();

// //     const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100); 
// //     const query = String(req.query.query || "").trim().slice(0, 200);
// //     const projectType = String(req.query.projectType || "").trim();
// //     const preferredOnly = req.query.preferredOnly === "true";
// //     const verifiedOnly = req.query.verifiedOnly === "true";

// //     const skillsArr = req.query.skills
// //       ? String(req.query.skills)
// //           .split(",")
// //           .map(s => s.trim().toLowerCase())
// //           .filter(Boolean)
// //       : [];
// //     console.log("Skills from query:", skillsArr);

// //     // GET USER CONFIG (with defaults)
// //     const userConfig = await getUserConfig(userId);
// //     console.log("UserConfig skills:", userConfig.skills);
// //     console.log("UserConfig countries:", userConfig.countries);

// //     // MERGE SKILLS: UI + DB
// //     const skillsFromConfig = (userConfig.skills || [])
// //      .map(s => String(s).trim().toLowerCase())
// //      .filter(Boolean);
// //     const mergedSkills = [...new Set([...skillsArr, ...skillsFromConfig])];
// //     console.log("Merged Skills:", mergedSkills);
// //     // const cleanSkills = mergedSkills
// //     //  .map(s => s.trim())
// //     //  .filter(Boolean)
// //     // .map(s => s.toLowerCase().replace(/\s+/g, ' '));

// // // Log to confirm
// // console.log("Cleaned Skills for API:", mergedSkills);



// //     // FETCH FROM FREELANCER API
// //     const items = await fetchActiveProjects({
// //       limit: Number(limit),
// //       query: String(query),
// //       skills: mergedSkills,
// //       projectType: projectType || undefined,
// //       preferredOnly: preferredOnly === "true",
// //       verifiedOnly: verifiedOnly === "true",
// //     });

// //     // ---LOG JOBS (SKILLS) IN TERMINAL FOR EACH PROJECT
// //     items.forEach((project, index) => {
// //       console.log(`Project ${index + 1}: ${project.title}`);
// //       console.log("Jobs/Skills:");
// //       project.jobs.forEach(job => {
// //         console.log(`- ID: ${job.id}, Name: ${job.name}`);
// //       });
// //       console.log("-------------------");
// //     });

// //     const recent = items.filter(p => isWithinLast24Hours(p.time_submitted));
// //     const filtered = await filterProjectsForBidding(userId, recent);

// //     // SAVE TO DB
// //     let upserts = 0;
// //     const operations = filtered
// //   .filter(p => p && p?.id)
// //   .map(p => ({
// //     updateOne: {
// //       filter: { platformId: p.id },
// //       update: {
// //         $set: {
// //           platformId: p.id,
// //           title: p.title || "",
// //           preview_description: p.preview_description || "",
// //           status: "new",
// //           type: p.type || "",
// //           time_submitted: p.time_submitted || null,
// //           bid_stats: p.bid_stats || {},
// //           budget: p.budget || {},
// //           currency: p.currency || {},
// //           jobs: p.jobs || [],
// //           skills: (p.jobs || []).map(job => job.name?.toLowerCase().trim()).filter(Boolean),
// //           //jobsId:p.job.id ,
// //           raw: p,
// //         },
// //       },
// //       upsert: true,
// //     },
// //   }));

// // if (operations.length > 0) {
// //   const result = await Project.bulkWrite(operations, { ordered: false });
// //   upserts = result.upsertedCount + result.modifiedCount;
// // }

// //     const ms = Date.now() - startedAt;
// //     console.log(`[/api/projects] fetched=${items.length} recent=${recent.length} saved=${upserts} in ${ms}ms`);
// //     res.json({ ok: true, fetched: items.length, recent: recent.length, saved: upserts, projects: filtered });
// //   } catch (err) {
// //     console.error("[/api/projects] error:", err);
// //     res.status(500).json({ error: "Failed to fetch projects", detail: String(err?.message || err) });
// //   }
// // };

// const fetchAndSaveProjects = async (req, res) => {
//   try {
//     const userId = getUid(req);
//     if (!userId) return res.status(401).json({ ok: false, error: "Login required" });

//     console.log("User ID:", userId);
//     const startedAt = Date.now();

//     const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
//     const query = String(req.query.query || "").trim();
//     const projectType = String(req.query.projectType || "").trim();

//     const skillsArr = req.query.skills
//       ? String(req.query.skills).split(",").map(s => s.trim()).filter(Boolean)
//       : [];

//     // Get config
//     const userConfig = await getUserConfig(userId);
//     const configSkills = (userConfig.skills || []).map(s => String(s).trim());
//     const mergedSkills = [...new Set([...skillsArr, ...configSkills])];

//     console.log("Merged Skills:", mergedSkills);

//     // Fetch projects
//     const items = await fetchActiveProjects({
//       limit,
//       query,
//       skills: mergedSkills,
//       projectType: projectType || undefined,
//     });

//     const recent = items.filter(p => isWithinLast24Hours(p.time_submitted));
//     const { passed } = await filterProjectsForBidding(userId, recent);

//     // SHOW ONLY PASS PROJECTS IN TERMINAL WITH FULL DETAILS
//     if (passed.length === 0) {
//       console.log("No projects passed filters.");
//     } else {
//       console.log(`\n${"=".repeat(60)}`);
//       console.log(`PASS PROJECTS (${passed.length})`);
//       console.log(`${"=".repeat(60)}`);

//       passed.forEach((p, i) => {
//         const budget = p.type === 'fixed'
//           ? `$${p.budget?.minimum || 0}–$${p.budget?.maximum || 0}`
//           : p.budget?.price || 'N/A';

//         const country = p.owner?.location?.country?.name || 'Unknown';

//         console.log(`\n[${i + 1}] ${p.title}`);
//         console.log(`   ID: ${p.id} | Type: ${p.type} | Budget: ${budget}`);
//         console.log(`   Country: ${country} | Posted: ${new Date(p.time_submitted * 1000).toLocaleString()}`);
//         console.log(`   URL: https://www.freelancer.com/projects/${p.seo_url || p.id}`);

//         console.log(`   Skills:`);
//         p.jobs?.forEach(job => {
//           console.log(`      • ${job.name} (ID: ${job.id})`);
//         });
//         console.log(`   ${"-".repeat(50)}`);
//       });
//       console.log(`${"=".repeat(60)}\n`);
//     }

//     // SAVE ONLY PASS PROJECTS
//     let saved = 0;
//     if (passed.length > 0) {
//       const ops = passed
//         .filter(p => p && p.id)
//         .map(p => ({
//           updateOne: {
//             filter: { platformId: p.id },
//             update: {
//               $set: {
//                 platformId: p.id,
//                 title: p.title,
//                 type: p.type,
//                 budget: p.budget,
//                 country: p.owner?.location?.country?.name || '',
//                 jobs: p.jobs,
//                 skills: p.jobs?.map(j => j.name?.toLowerCase().trim()),
//                 raw: p,
//                 status: "new",
//                 time_submitted: p.time_submitted,
//               },
//             },
//             upsert: true,
//           },
//         }));

//       const result = await Project.bulkWrite(ops, { ordered: false });
//       saved = result.upsertedCount + result.modifiedCount;
//     }

//     const ms = Date.now() - startedAt;
//     console.log(`[/api/projects] fetched=${items.length} recent=${recent.length} passed=${passed.length} saved=${saved} in ${ms}ms`);

//     res.json({
//       ok: true,
//       fetched: items.length,
//       recent: recent.length,
//       passed: passed.length,
//       saved,
//       projects: passed
//     });

//   } catch (err) {
//     console.error("[/api/projects] error:", err);
//     res.status(500).json({ error: "Server error", detail: err.message });
//   }
// };
// module.exports = {
//   fetchAndSaveProjects,
//   getSavedProjects,
// };









// //---------------perfectly fetch on skills --------------------------



// // // controllers/projectController.js

// const { fetchActiveProjects } = require('../services/freelancerService');
// const Project = require('../models/project');
// const UserConfig = require('../models/userConfig');
// const { getUid } = require('./userConfigController');

// // ------------------- GET USER CONFIG -------------------
// const getUserConfig = async (userId) => {
//   const id = Number(userId);
//   if (isNaN(id)) throw new Error("Invalid userId");

//   const config = await UserConfig.findOne({ userId: id }).lean();
//   if (!config) {
//     return {
//       userId: id,
//       skills: [],
//       countries: [],
//       minFixedBudget: 0,
//       maxFixedBudget: Infinity,
//       minHourlyBudget: 0,
//       maxHourlyBudget: Infinity,
//       projectType: null
//     };
//   }
//   return config;
// };

// // ------------------- LAST 24 HOURS CHECK -------------------
// const isWithinLast24Hours = (timestamp) => {
//   if (!timestamp) return false;
//   const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
//   return (timestamp * 1000) >= dayAgo;
// };

// // ------------------- FETCH & SAVE PROJECTS -------------------
// const fetchAndSaveProjects = async (req, res) => {
//   try {
//     const userId = getUid(req);
//     if (!userId) return res.status(401).json({ ok: false, error: "Login required" });

//     console.log("\n" + "=".repeat(60));
//     console.log("FETCHING PROJECTS FOR USER:", userId);
//     console.log("=".repeat(60));

//     const startedAt = Date.now();
//      //--------------------------------------------skills condition
//     // === 1. GET USER SKILLS FROM CONFIG ===
//     const config = await getUserConfig(userId);
//     const userSkills = (config.skills || [])
//       .map(s => String(s).trim().toLowerCase().replace(/\s+/g, ' '))
//       .filter(Boolean);

//     if (userSkills.length === 0) {
//       console.log("No skills in config. Nothing to fetch.");
//       return res.json({ ok: true, matched: 0, saved: 0, projects: [] });
//     }

//     console.log("Your Skills:", userSkills.join(', '));


//     //---------------------------------------------country condition
//     // === 1. GET USER COUNTRIES FROM CONFIG ===
//      const userCountries = (config.countries || [])
//      .map(c => String(c).trim().toLowerCase().replace(/\s+/g, ' '))
//      .filter(Boolean)

//      if (userCountries.length === 0) {
//       console.log("No countries in config. Nothing to fetch.");
//       return response.json({ok: true, match: 0, saved: 0, projects: []});
//      }

//      console.log("Your Countries: ", userCountries.join(', '));



//     // === 2. FETCH LAST 24H PROJECTS FROM API ===
//     const projects = await fetchActiveProjects({ skills: userSkills, limit: 10000 });

//     if (projects.length === 0) {
//       console.log("No projects found in last 24 hours.");
//       return res.json({ ok: true, matched: 0, saved: 0, projects: [] });
//     }

//     // === 3. FILTER: ONLY MATCHED SKILLS ===
//     const passed = projects.filter(p => {
//       const projectSkills = (p.jobs || []).map(j => j.name.toLowerCase().trim());
//       return projectSkills.some(s => userSkills.includes(s));
//     });

//     console.log(`SKILL MATCHED PROJECTS: ${passed.length}`);

//     // === 4. SHOW FULL DETAILS IN TERMINAL ===
//     if (passed.length === 0) {
//       console.log("No project matched your skills in last 24 hours.\n");
//     } else {
//       console.log("\n" + "=".repeat(70));
//       console.log(`MATCHED PROJECTS (${passed.length}) - LAST 24 HOURS`);
//       console.log("=".repeat(70));

//       passed.forEach((p, i) => {
//         const budget = p.type === 'fixed'
//           ? `$${p.budget?.minimum || 0}–$${p.budget?.maximum || 0}`
//           : p.budget?.price || 'N/A';

//         const country = p.owner?.location?.country?.name || 'Unknown';

//        // === MATCHED SKILLS WITH IDs ===
//         const matchedSkillsWithIds = (p.jobs || [])
//           .filter(j => userSkills.includes(j.name.toLowerCase().trim()))
//           .map(j => `ID ${j.id}: ${j.name}`)
//           .join('\n      ');

//         console.log(`\n[${i + 1}] ${p.title}`);
//         console.log(`   ID: ${p.id}`);
//         console.log(`   Type: ${p.type} | Budget: ${budget}`);
//         console.log(`   Country: ${country}`);
//         console.log(`   Posted: ${new Date(p.time_submitted * 1000).toLocaleString()}`);
//         console.log(`   Link: https://www.freelancer.com/projects/${p.seo_url || p.id}`);

//         console.log(`   Matched Skills (ID: Name):`);
//         console.log(`      ${matchedSkillsWithIds || 'None'}`);

//         // === ALL SKILLS WITH IDs (BONUS FOR PROPOSAL) ===
//         console.log(`   All Project Skills (ID: Name):`);
//         const allSkillsWithIds = (p.jobs || [])
//           .map(j => `ID ${j.id}: ${j.name}`)
//           .join('\n      ');
//         console.log(`      ${allSkillsWithIds || 'None'}`);

//         console.log("   " + "-".repeat(50));
//       });
//       console.log("=".repeat(70) + "\n");
//     }

//     // === 5. SAVE ONLY MATCHED PROJECTS TO DB ===
//     let saved = 0;
//     if (passed.length > 0) {
//       const operations = passed.map(p => ({
//         updateOne: {
//           filter: { platformId: p.id },
//           update: {
//             $set: {
//               platformId: p.id,
//               title: p.title || "No Title",
//               type: p.type || "unknown",
//               budget: p.budget || {},
//               country: p.owner?.location?.country?.name || 'Unknown',
//               jobs: p.jobs || [],
//               skills: (p.jobs || []).map(j => j.name?.toLowerCase().trim()).filter(Boolean),
//               raw: p,
//               status: "new",
//               time_submitted: p.time_submitted,
//               userId
//             }
//           },
//           upsert: true
//         }
//       }));

//       const result = await Project.bulkWrite(operations, { ordered: false });
//       saved = result.upsertedCount + result.modifiedCount;
//     }

//     const ms = Date.now() - startedAt;
//     console.log(`[/api/projects] matched=${passed.length} saved=${saved} in ${ms}ms`);
//     console.log("=".repeat(60) + "\n");

//     // === 6. SEND RESPONSE ===
//     res.json({
//       ok: true,
//       matched: passed.length,
//       saved,
//       projects: passed
//     });

//   } catch (err) {
//     console.error("[/api/projects] ERROR:", err.message);
//     res.status(500).json({ ok: false, error: err.message });
//   }
// };

// // ------------------- GET SAVED PROJECTS -------------------
// const getSavedProjects = async (req, res) => {
//   try {
//     const projects = await Project.find({ status: "new" })
//       .sort({ time_submitted: -1 })
//       .limit(10000)  //----------------------------------limit
//       .lean();

//     res.json({ ok: true, projects });
//   } catch (err) {
//     console.error("getSavedProjects error:", err);
//     res.status(500).json({ ok: false, error: "Failed to fetch saved projects" });
//   }
// };

// module.exports = {
//   fetchAndSaveProjects,
//   getSavedProjects
// };


//-------------------------------------------------


// // controllers/projectController.js
// const { fetchActiveProjects } = require('../services/freelancerService');
// const Project = require('../models/project');
// const UserConfig = require('../models/userConfig');
// const { getUid } = require('./userConfigController');

// // ------------------- GET USER CONFIG -------------------
// const getUserConfig = async (userId) => {
//   const id = Number(userId);
//   if (isNaN(id)) throw new Error("Invalid userId");

//   try {
//     const config = await UserConfig.findOne({ userId: id }).lean().maxTimeMS(5000);
//     if (!config) {
//       return {
//         userId: id,
//         skills: [],
//         countries: [],
//         minFixedBudget: 0,
//         maxFixedBudget: 100000,
//         minHourlyBudget: 0,
//         maxHourlyBudget: 1000,
//         projectType: null,
//         freelancer_verified_status: null
//       };
//     }
//     return config;
//   } catch (err) {
//     console.error("getUserConfig DB Error:", err.message);
//     return {
//       userId: id,
//       skills: [],
//       countries: [],
//       minFixedBudget: 0,
//       maxFixedBudget: 100000,
//       minHourlyBudget: 0,
//       maxHourlyBudget: 1000,
//       projectType: null,
//       freelancer_verified_status: null
//     };
//   }
// };

// // ------------------- FETCH & SAVE PROJECTS -------------------
// const fetchAndSaveProjects = async (req, res) => {
//   try {
//     const userId = getUid(req);
//     if (!userId) return res.status(401).json({ ok: false, error: "Login required" });

//     console.log("\n" + "=".repeat(70));
//     console.log("FETCHING PROJECTS FOR USER:", userId);
//     console.log("=".repeat(70));

//     const startedAt = Date.now();
//     const config = await getUserConfig(userId);

//     const userSkills = (config.skills || [])
//       .map(s => String(s).trim().toLowerCase().replace(/\s+/g, ' '))
//       .filter(Boolean);

//     const userCountries = (config.countries || [])
//       .map(c => String(c).trim().toUpperCase())
//       .filter(Boolean);

//     if (userSkills.length === 0) {
//       return res.json({ ok: true, matched: 0, saved: 0, projects: [] });
//     }

//     console.log("Your Skills:", userSkills.join(', '));
//     if (userCountries.length > 0) console.log("Your Countries:", userCountries.join(', '));
//     if (config.projectType) console.log("Project Type:", config.projectType);
//     console.log("Fixed Budget:", config.minFixedBudget, "→", config.maxFixedBudget);
//     console.log("Hourly Budget:", config.minHourlyBudget, "→", config.maxHourlyBudget);
//     if (config.freelancer_verified_status === "verified") console.log("Verified Owners Only: YES");

//     // === LOOP: FETCH UNTIL SKILL MATCH FOUND ===
//     let skillMatchedProjects = [];  // ← YEH VARIABLE
//     let offset = 0;
//     const batchSize = 100;
//     let attempts = 0;
//     const maxAttempts = 5;

//     while (skillMatchedProjects.length === 0 && attempts < maxAttempts) {
//       attempts++;
//       console.log(`\nFETCH ATTEMPT ${attempts}: limit=${batchSize}, offset=${offset}`);

//       const batch = await fetchActiveProjects({
//         skills: userSkills,
//         limit: batchSize,
//         offset
//       });

//       if (batch.length === 0) {
//         console.log("No more projects from API.");
//         break;
//       }

//       const matched = batch.filter(p => {
//         const ps = (p.jobs || []).map(j => j.name.toLowerCase().trim());
//         return ps.some(s => userSkills.includes(s));
//       });

//       if (matched.length > 0) {
//         skillMatchedProjects = matched;  // ← YAHAN ASSIGN
//         console.log(`FOUND ${matched.length} skill-matched projects in attempt ${attempts}`);
//         break;
//       }

//       offset += batchSize;
//     }

//     // ← YAHAN BHI `skillMatchedProjects`
//     if (skillMatchedProjects.length === 0) {
//       console.log("NO SKILL-MATCHED PROJECTS FOUND EVEN AFTER MULTIPLE FETCHES");
//       return res.json({ ok: true, matched: 0, saved: 0, projects: [] });
//     }

//     // === APPLY OTHER FILTERS ===
//     const step2 = skillMatchedProjects.filter(p => {
//       const pc = (p.owner?.location?.country?.code || '').toUpperCase();
//       return userCountries.length === 0 || userCountries.includes(pc);
//     });
//     console.log(`+ COUNTRY → ${step2.length}`);

//     const step3 = step2.filter(p => {
//       if (p.type === 'fixed') {
//         const min = p.budget?.minimum || 0;
//         const max = p.budget?.maximum || Infinity;
//         return min >= config.minFixedBudget && max <= config.maxFixedBudget;
//       } else if (p.type === 'hourly') {
//         const [minStr, maxStr] = String(p.budget?.price || '0-0').split('-');
//         const min = parseInt(minStr) || 0;
//         const max = parseInt(maxStr) || Infinity;
//         return min >= config.minHourlyBudget && max <= config.maxHourlyBudget;
//       }
//       return false;
//     });
//     console.log(`+ BUDGET → ${step3.length}`);

//     const step4 = step3.filter(p => {
//       return !config.projectType || p.type === config.projectType;
//     });
//     console.log(`+ TYPE → ${step4.length}`);

//     const passed = step4.filter(p => {
//       if (config.freelancer_verified_status === "verified") {
//         return p.owner?.is_verified === true;
//       }
//       return true;
//     });
//     console.log(`+ VERIFIED → ${passed.length}`);
//     console.log(`\nFINAL: ${passed.length} projects passed all filters\n`);

//     // === SHOW FULL DETAILS OF PASSED PROJECTS ===
//     if (passed.length > 0) {
//       console.log("=".repeat(80));
//       console.log(`MATCHED PROJECTS (${passed.length})`);
//       console.log("=".repeat(80));

//       passed.forEach((p, i) => {
//         const budget = p.type === 'fixed'
//           ? `$${p.budget?.minimum || 0}–$${p.budget?.maximum || 0}`
//           : p.budget?.price || 'N/A';

//         const country = p.owner?.location?.country?.name || 'Unknown';
//         const countryCode = p.owner?.location?.country?.code || '';
//         const verified = p.owner?.is_verified ? "VERIFIED" : "Not Verified";

//         const matchedSkills = (p.jobs || [])
//           .filter(j => userSkills.includes(j.name.toLowerCase().trim()))
//           .map(j => `ID ${j.id}: ${j.name}`)
//           .join('\n      ');

//         console.log(`\n[${i + 1}] ${p.title}`);
//         console.log(`   ID: ${p.id} | Type: ${p.type} | Budget: ${budget}`);
//         console.log(`   Country: ${country} (${countryCode}) | ${verified}`);
//         console.log(`   Posted: ${new Date(p.time_submitted * 1000).toLocaleString()}`);
//         console.log(`   Link: https://www.freelancer.com/projects/${p.seo_url || p.id}`);
//         console.log(`   Matched Skills:`);
//         console.log(`      ${matchedSkills || 'None'}`);
//         console.log("   " + "-".repeat(60));
//       });
//       console.log("=".repeat(80) + "\n");
//     }

//     // === SAVE TO DB ===
//     let saved = 0;
//     if (passed.length > 0) {
//       const ops = passed.map(p => ({
//         updateOne: {
//           filter: { platformId: p.id },
//           update: {
//             $set: {
//               platformId: p.id,
//               title: p.title || "No Title",
//               type: p.type || "unknown",
//               budget: p.budget || {},
//               country: p.owner?.location?.country?.name || 'Unknown',
//               countryCode: p.owner?.location?.country?.code || '',
//               jobs: p.jobs || [],
//               skills: (p.jobs || []).map(j => j.name?.toLowerCase().trim()).filter(Boolean),
//               raw: p,
//               status: "new",
//               time_submitted: p.time_submitted,
//               userId,
//               verified: !!p.owner?.is_verified
//             }
//           },
//           upsert: true
//         }
//       }));
//       const result = await Project.bulkWrite(ops, { ordered: false });
//       saved = result.upsertedCount + result.modifiedCount;
//     }

//     const ms = Date.now() - startedAt;
//     console.log(`[/api/projects] attempts=${attempts} final=${passed.length} saved=${saved} in ${ms}ms`);
//     console.log("=".repeat(70) + "\n");

//     res.json({
//       ok: true,
//       attempts,
//       final: passed.length,
//       saved,
//       projects: passed
//     });

//   } catch (err) {
//     console.error("[ERROR]:", err.message);
//     res.status(500).json({ ok: false, error: err.message });
//   }
// };

// // ------------------- GET SAVED PROJECTS -------------------
// const getSavedProjects = async (req, res) => {
//   try {
//     const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 10000);
//     const projects = await Project.find({ status: "new" })
//       .sort({ time_submitted: -1 })
//       .limit(limit)
//       .lean();

//     res.json({ ok: true, count: projects.length, projects });
//   } catch (err) {
//     console.error("getSavedProjects error:", err);
//     res.status(500).json({ ok: false, error: "Failed" });
//   }
// };

// // ------------------- EXPORT -------------------
// module.exports = {
//   fetchAndSaveProjects,
//   getSavedProjects
// };










