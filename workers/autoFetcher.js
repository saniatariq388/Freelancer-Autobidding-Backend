
const { fetchActiveProjects } = require('../services/freelancerService');
const Project = require('../models/project');
const UserConfig = require('../models/userConfig');

const FETCH_INTERVAL_MIN = 7; 
const BATCH_DELAY_MS = 800;
const MAX_PROJECTS_PER_USER = 800;

let isRunning = false;

const delay = (ms) => new Promise(r => setTimeout(r, ms));

const startAutoFetcher = () => {
  if (isRunning) {
    console.log("[autoFetcher] Already running!");
    return;
  }

  isRunning = true;
  console.log("\nAUTO FETCHER STARTED (24/7 - NO PM2)");
  console.log(`Har ${FETCH_INTERVAL_MIN} minute mein naye projects fetch honge...\n`);

  const runCycle = async () => {
    try {
      await runOneCycle();
    } catch (err) {
      console.error("[autoFetcher] CYCLE FAILED:", err.message);
    } finally {
      // Next cycle
      setTimeout(runCycle, FETCH_INTERVAL_MIN * 60 * 1000);
    }
  };

  runCycle();

  //  shutdown
  process.on('SIGTERM', () => {
    isRunning = false;
    console.log("[autoFetcher] Shutting down gracefully...");
  });
};

const runOneCycle = async () => {
  if (!isRunning) return;

  console.log("=".repeat(60));
  console.log("CYCLE START:", new Date().toISOString());
  console.log("=".repeat(60));

  const users = await UserConfig.find({}).lean();
  if (!users.length) {
    console.log("No users found. Sleeping...");
    return;
  }

  for (const user of users) {
    if (!isRunning) break;

    const skills = (user.skills || [])
      .map(s => String(s).trim().toLowerCase())
      .filter(Boolean);
    if (!skills.length) continue;

    let projects = [];
    let offset = 0;
    const limit = 100;

    try {
      while (projects.length < MAX_PROJECTS_PER_USER && isRunning) {
        const batch = await fetchActiveProjects({ skills, limit, offset });
        if (!batch || batch.length === 0) break;

        projects.push(...batch);
        offset += limit;
        await delay(BATCH_DELAY_MS);
      }

      const passed = projects
        .filter(p => {
          const s = (p.jobs || []).map(j => j.name.toLowerCase());
          const t = (p.title || '').toLowerCase();
          const d = (p.preview_description || '').toLowerCase();
          return s.some(x => skills.includes(x)) ||
                 skills.some(x => t.includes(x)) ||
                 skills.some(x => d.includes(x));
        })
        .filter(p => {
          if (p.type !== 'fixed') return false;
          if (!p.budget?.minimum || !p.budget?.maximum) return false;
          return p.budget.maximum >= (user.minFixedBudget || 0) &&
                 p.budget.minimum <= (user.maxFixedBudget || Infinity);
        });

      if (passed.length > 0) {
        const operations = passed.map(p => ({
          updateOne: {
            filter: { platformId: p.id },
            update: {
              $set: {
                platformId: p.id,
                title: p.title,
                type: p.type,
                budget: p.budget,
                status: "new",
                userId: user.userId,
                time_submitted: p.time_submitted,
                raw: p 
              },
              $setOnInsert: { createdAt: new Date() }
            },
            upsert: true
          }
        }));

        const result = await Project.bulkWrite(operations, { ordered: false });
        console.log(`User ${user.userId}: ${passed.length} projects → ${result.upsertedCount} new, ${result.modifiedCount} updated`);
      } else {
        console.log(`User ${user.userId}: No projects passed filters`);
      }

    } catch (err) {
      console.error(`User ${user.userId} fetch failed:`, err.message);
    }
  }

  console.log("CYCLE END. NEXT IN", FETCH_INTERVAL_MIN, "MIN...\n");
};

module.exports = { startAutoFetcher };