// routes/bidding.js
const express = require('express');
const {
  startAutoBidding,
  stopAutoBidding,
  queueStatus,
  recentBids,
  placeBidManual,
  statsBid
} = require('../controllers/biddingController');

const router = express.Router();

// Start/Stop
router.post('/start', startAutoBidding);
router.post('/stop', stopAutoBidding);

// Manual bid
router.post('/place-bid', placeBidManual);

// UI
router.get('/status', queueStatus);
router.get('/results', recentBids);
router.get('/stats/daily' , statsBid)

module.exports = router;