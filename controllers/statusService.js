const Project = require('../models/project');
const Bid = require('../models/bid');

const getProjectStatus = async (req, res) => {
  try {
    // 1) Collect project IDs by bid status (pending, success, failed)

    const [pendingIds, successIds, failedIds] = await Promise.all([
      Bid.distinct("platformProjectId", { status: "pending" }),
      Bid.distinct("platformProjectId", { status: "success" }),
      Bid.distinct("platformProjectId", { status: "failed" }),
    ]);

    const anyBidSet = new Set([
      ...pendingIds.map(Number),
      ...successIds.map(Number),
      ...failedIds.map(Number),
    ]);
    const anyBidArr = Array.from(anyBidSet);

    // 2) Pull  lists of projects with counts
    const [pending, success, unbid, counts] = await Promise.all([
      Project.find({ platformId: { $in: pendingIds } })
        .select("platformId title type budget.minimum budget.maximum")
        .sort({ time_submitted: -1 })
        .limit(20)
        .lean(),

      Project.find({ platformId: { $in: successIds } })
        .select("platformId title type budget.minimum budget.maximum")
        .sort({ time_submitted: -1 })
        .limit(20)
        .lean(),

      Project.find({ platformId: { $nin: anyBidArr } })
        .select("platformId title type budget.minimum budget.maximum")
        .sort({ time_submitted: -1 })
        .limit(20)
        .lean(),

      // Counts of each status type
      (async () => {
        const [total, pc, sc, uc] = await Promise.all([
          Project.countDocuments({}),
          Project.countDocuments({ platformId: { $in: pendingIds } }),
          Project.countDocuments({ platformId: { $in: successIds } }),
          Project.countDocuments({ platformId: { $nin: anyBidArr } }),
        ]);
        return { total, pending: pc, success: sc, unbid: uc };
      })(),
    ]);

    res.json({ pending, success, unbid, counts });
  } catch (err) {
    console.error("Error fetching project status:", err);
    res.status(500).json({ error: "Server error" });
  }
};

module.exports = { getProjectStatus };
