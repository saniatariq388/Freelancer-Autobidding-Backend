// // routes/projectRoutes.js

// const express = require('express');
// const fetch = require('node-fetch');
// const Project = require('../models/project');  
// const UserConfig = require('../models/UserConfig');  
// const router = express.Router();

// const FREELANCER_URL = 'https://www.freelancer.com/api/projects/0.1/projects/active/?limit=20&job_details=';

// // Route to fetch and save projects from Freelancer API based on user skills
// router.get('/api/projects/status', async (req, res) => {
//   const { userId } = req.query;

//   if (!userId) {
//     return res.status(400).json({ error: "User ID is required" });
//   }

//   try {
//     // Step 1: Get skills of the user from MongoDB
//     const userConfig = await UserConfig.findOne({ userId });
//     if (!userConfig) {
//       return res.status(404).json({ error: "User not found or no config available" });
//     }

//     const skills = userConfig.skills;
//     if (skills.length === 0) {
//       return res.status(400).json({ error: "User skills are not defined" });
//     }

//     //  Build Freelancer API URL with user's skills
//     let apiUrl = `${FREELANCER_URL}&skills[]=${skills.join("&skills[]=")}`;

//     //  Fetch projects from Freelancer API
//     const response = await fetch(apiUrl);
//     if (!response.ok) {
//       throw new Error("Failed to fetch data from Freelancer API");
//     }
//     const data = await response.json();
//     const projects = data.result.projects;

//     //  fetched projects to MongoDB
//     const savedProjects = [];
//     for (const project of projects) {
//       const existingProject = await Project.findOne({ platformId: project.id });
//       if (!existingProject) {
//         const newProject = new Project({
//           platformId: project.id,
//           title: project.title,
//           preview_description: project.preview_description,
//           status: "new",
//           type: project.type,
//           time_submitted: project.time_submitted,
//           bid_stats: project.bid_stats || {},
//           budget: project.budget || {},
//           currency: project.currency || {},
//           jobs: project.jobs || [],
//           raw: project,
//         });

//         await newProject.save();
//         savedProjects.push(newProject);
//       }
//     }

   
//     const latestProjects = await Project.find().sort({ time_submitted: -1 }).limit(20);
//     return res.json({ projects: latestProjects });

//   } catch (error) {
//     console.error("Error fetching and saving projects:", error);
//     return res.status(500).json({ error: "Error fetching projects from Freelancer API" });
//   }
// });

// module.exports = router;




//-------------------------------------------------

const express = require('express');
const { fetchAndSaveProjects, getSavedProjects } = require('../controllers/projectController');
const router = express.Router();
console.log("fetchAndSaveProjects typeof:", typeof fetchAndSaveProjects);
console.log("getSavedProjects typeof:", typeof getSavedProjects);

// Project Routes
router.get('/', fetchAndSaveProjects); // Fetch and save filtered projects


// read only from mongodb (ui will call )
router.get('/saved', getSavedProjects);

module.exports = router;
