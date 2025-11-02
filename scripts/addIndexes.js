// scripts/addIndexes.js
require('dotenv').config()
const mongoose = require('mongoose');
require('../models/project');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const Project = mongoose.model('Project');
  console.log("Adding indexes...");
  
  await Project.syncIndexes();
  console.log("Indexes updated!");
  
  process.exit(0);
});