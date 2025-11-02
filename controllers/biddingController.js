// controllers/biddingController.js
const Project = require('../models/project');
const Bid = require('../models/bid');
const { SimpleQueue } = require('../utils/queue');
const { placeBidOnFreelancerAPI, fetchActiveProjects } = require('../services/freelancerService');
const { isWithinLast24Hours } = require('../utils/time');
const UserConfig = require('../models/userConfig');
const { getUid } = require('../controllers/userConfigController')


const queue = new SimpleQueue();
const queuedIds = new Set();
let bidTimer = null;
let refreshTimer = null;
let isRunning = false;

// === ENQUEUE SAFELY ===
async function enqueueProjects(projects) {
  let added = 0;
  for (const p of projects) {
    if (!p?.id) continue;

    const existing = await Project.findOne({ platformId: p.id }).lean();
    const inQueue = queue.list().some(q => q.platformId === p.id);

    if (
      existing?.status === "bid_sent" ||
      existing?.status === "error" ||
      inQueue ||
      queuedIds.has(p.id)
    ) continue;

    queue.enqueue({ platformId: p.id, title: p.title || "" });
    queuedIds.add(p.id);
    added++;
  }
  console.log(`[queue] +${added} → total=${queue.size()}`);
  return added;
}

// === BID ONE ===
async function bidOne() {
  const item = queue.dequeue();
  if (!item) {
    console.log("[bid] Queue empty — sleeping...");
    return;
  }

  const { platformId } = item;
  queuedIds.delete(platformId);

  try {
    const project = await Project.findOne({ platformId }).lean();
    if (!project || project.status === "bid_sent" || project.status === "error") {
      return;
    }

    await Project.updateOne({ platformId }, { $set: { status: "bidding" } });

    const avg = project.bid_stats?.bid_avg || 50;
    const amount = Math.max(20, Math.round(avg));
    const period = 7;

    const resp = await placeBidOnFreelancerAPI({
      projectId: platformId,
      amount,
      period,
      milestone_percentage: 20,
    });

    await Bid.create({
      projectRef: project._id,
      platformProjectId: platformId,
      amount,
      period,
      milestone_percentage: 20,
      status: "success",
      responseRaw: resp,
    });

    await Project.updateOne({ platformId }, { $set: { status: "bid_sent" } });
    console.log(`[bid] SUCCESS → $${amount} on ${platformId}`);

  } catch (e) {
    console.error(`[bid] FAILED → ${platformId}:`, e.message);

    const project = await Project.findOne({ platformId }).lean();
    await Bid.create({
      projectRef: project?._id,
      platformProjectId: platformId,
      status: "failed",
      error: String(e?.body || e?.message || e),
    });

    await Project.updateOne({ platformId }, { $set: { status: "error" } });
  }
}

// === START AUTO BIDDING ===
exports.startAutoBidding = async (req, res) => {
  try {
    if (isRunning) {
      return res.json({ ok: true, alreadyRunning: true, queueSize: queue.size() });
    }

    const uid = getUid(req)
    if (!uid) return res.status(400).json({ ok: false, error: "userId required" });


    const config = await UserConfig.findOne({ userId: Number(uid) }).lean();
    if (!config) {
      return res.status(404).json({ ok: false, error: "User/config not found" });
    }

    if (config.freelancer_verified_status !== "verified") {
      return res.json({ ok: false, reason: "User not verified" });
    }

    console.log(`[autobid] STARTED → ${user.username}`);

    // Initial fetch
    const all = await fetchActiveProjects({ limit: 50 });
    const recent = all.filter(p => isWithinLast24Hours(p.time_submitted));

    const filtered = recent.filter(p => {
      const type = p.type === "hourly" ? "hourly" : "fixed";
      const skills = (p.jobs || []).map(j => j.name.toLowerCase().trim());
      const country = p.owner?.location?.country?.code || "";
      const min = p.budget?.minimum || 0;
      const max = p.budget?.maximum || 0;

      const budgetOK =
        (type === "hourly" &&
          min >= (config.minHourlyBudget || 0) &&
          max <= (config.maxHourlyBudget || Infinity)) ||
        (type === "fixed" &&
          min >= (config.minFixedBudget || 0) &&
          max <= (config.maxFixedBudget || Infinity));

      const skillsOK = config.skills?.some(s => skills.includes(s.toLowerCase().trim()));
      const countryOK = !config.countries?.length || config.countries.includes(country);

      return budgetOK && skillsOK && countryOK;
    });

    await enqueueProjects(filtered.slice(0, 20));

    // Start loops
    bidTimer = setInterval(bidOne, 40 * 1000);
    refreshTimer = setInterval(async () => {
      try {
        const more = await fetchActiveProjects({ limit: 10 });
        const recentMore = more.filter(p => isWithinLast24Hours(p.time_submitted));
        const filteredMore = recentMore.filter(p => {
          const type = p.type === "hourly" ? "hourly" : "fixed";
          const skills = (p.jobs || []).map(j => j.name.toLowerCase().trim());
          const country = p.owner?.location?.country?.code || "";
          const min = p.budget?.minimum || 0;
          const max = p.budget?.maximum || 0;

          const budgetOK =
            (type === "hourly" &&
              min >= (config.minHourlyBudget || 0) &&
              max <= (config.maxHourlyBudget || Infinity)) ||
            (type === "fixed" &&
              min >= (config.minFixedBudget || 0) &&
              max <= (config.maxFixedBudget || Infinity));

          const skillsOK = config.skills?.some(s => skills.includes(s.toLowerCase().trim()));
          const countryOK = !config.countries?.length || config.countries.includes(country);

          return budgetOK && skillsOK && countryOK;
        });
        await enqueueProjects(filteredMore);
      } catch (e) {
        console.error("[refresh] ERROR:", e.message);
      }
    }, 10 * 60 * 1000);

    isRunning = true;
    res.json({ ok: true, queueSize: queue.size(), message: "Auto bidding started" });

  } catch (e) {
    console.error("[start] ERROR:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
};

// === STOP AUTO BIDDING ===
exports.stopAutoBidding = async (req, res) => {
  if (!isRunning) {
    return res.json({ ok: true, alreadyStopped: true });
  }

  clearInterval(bidTimer);
  clearInterval(refreshTimer);
  bidTimer = null;
  refreshTimer = null;
  isRunning = false;

  console.log("[autobid] STOPPED");
  res.json({ ok: true, message: "Stopped" });
};

// === QUEUE STATUS (UI) ===
exports.queueStatus = async (req, res) => {
  const list = queue.list();
  res.json({
    ok: true,
    running: isRunning,
    queueSize: queue.size(),
    queuedProjects: list.map(q => ({
      id: q.platformId,
      title: q.title
    }))
  });
};

// === RECENT BIDS (UI) ===
exports.recentBids = async (req, res) => {
  try {
    const bids = await Bid.find()
      .sort({ createdAt: -1 })
      .limit(25)
      .populate('projectRef', 'title platformId')
      .lean();

    res.json({ ok: true, bids });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Failed" });
  }
};

// === MANUAL BID ===
exports.placeBidManual = async (req, res) => {
  try {
    const { projectId, amount, period = 7, milestone_percentage = 20 } = req.body;
    if (!projectId || !amount) {
      return res.status(400).json({ ok: false, error: "projectId & amount required" });
    }

    const project = await Project.findOne({ platformId: Number(projectId) });
    if (!project) return res.status(404).json({ ok: false, error: "Project not found" });

    const resp = await placeBidOnFreelancerAPI({
      projectId: Number(projectId),
      amount,
      period,
      milestone_percentage,
    });

    await Bid.create({
      projectRef: project._id,
      platformProjectId: Number(projectId),
      amount,
      period,
      milestone_percentage,
      status: "success",
      responseRaw: resp,
    });

    await Project.updateOne({ _id: project._id }, { $set: { status: "bid_sent" } });
    res.json({ ok: true, message: "Manual bid placed" });
  } catch (e) {
    console.error("[manual] ERROR:", e);
    res.status(500).json({ ok: false, error: "Failed", detail: e.message });
  }
};



//======STATS BIDS========
exports.statsBid = async (req, res) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const daily = await Bid.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%a", date: "$createdAt" } },
          total: { $sum: 1 },
          success: {
            $sum: { $cond: [{ $eq: ["$status", "success"] }, 1, 0] }
          }
        }
      },
      { $sort: { "_id": 1 } }
    ]);

    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const result = days.map(day => {
      const found = daily.find(d => d._id === day);
      return {
        name: day,
        bids: found?.total || 0
      }
    });
    res.json({ ok: true, data: result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}