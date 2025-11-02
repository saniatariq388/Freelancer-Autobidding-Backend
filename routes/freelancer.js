const express = require("express");
const router = express.Router();
const fetch = require("node-fetch");

router.get("/self", async (req, res) => {
  try {
    const token = process.env.FREELANCER_OAUTH_TOKEN;
    if (!token) return res.status(500).json({ error: "Missing FREELANCER_OAUTH_TOKEN" });

    const apiRes = await fetch("https://www.freelancer.com/api/users/0.1/self/", {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (apiRes.status === 401) {
      const text = await apiRes.text();
      console.error("Freelancer 401:", text);
      return res.status(401).json({ error: "Freelancer 401 (token invalid/expired)" });
    }

    if (!apiRes.ok) {
      const text = await apiRes.text();
      console.error("Freelancer error:", apiRes.status, text);
      return res.status(apiRes.status).json({ error: "Freelancer API error", status: apiRes.status });
    }

    const data = await apiRes.json();
    return res.json(data.result);
  } catch (e) {
    console.error("Freelancer /self error:", e);
    return res.status(500).json({ error: "Internal error hitting Freelancer" });
  }
});

module.exports = router;
