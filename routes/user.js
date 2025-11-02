// const express = require('express');
// const { fetchSelfUser } = require('../controllers/userController');
// const router = express.Router();

// router.get('/self', fetchSelfUser);

// module.exports = router;



//----------------------------------
const express = require("express");
const router = express.Router();
const { getSelfSmart } = require("../controllers/userController");

// UI always calls this one endpoint
router.get("/self", getSelfSmart);

module.exports = router;
