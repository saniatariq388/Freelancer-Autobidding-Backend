// // services/freelancerService.js
// const token = process.env.FREELANCER_OAUTH_TOKEN;

// async function freelancerGet(url) {
//   if (!token) throw new Error("Missing FREELANCER_OAUTH_TOKEN");
//   const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
//   const txt = await r.text().catch(()=> "");
//   if (!r.ok) {
//     console.error("❌ [Freelancer GET]", r.status, txt?.slice(0,300));
//     const err = new Error(`Freelancer GET ${r.status}`);
//     err.status = r.status;
//     err.body = txt;
//     throw err;
//   }
//   return JSON.parse(txt);
// }

// // exports.fetchSelfUser = async () => {
// //   const data = await freelancerGet("https://www.freelancer.com/api/users/0.1/self/");
// //   console.log(data)
// //   return data?.result || null;
  
// // };

// const fetchActiveProjects = async ({
//   limit = 20,
//   query = "",
//   skills = [],
//   projectType,
//   preferredOnly = false,
//   verifiedOnly = false,
// }) => {
//   const params = new URLSearchParams();
//   params.append('limit', limit);
//   params.append("job_details", "true");


//   if (query) params.append('query', query.trim());
//   //if (skills.length > 0) params.append('job', skills.join(',')); // Freelancer API uses 'job'
//   if (projectType) params.append('project_type', projectType);
//  if (preferredOnly) params.append("preferred_only", "true");
//   if (verifiedOnly) params.append("verified_only", "true");

//  // let apiUrl = `https://www.freelancer.com/api/projects/0.1/projects/active/?limit=${limit}&job_details=`;

//   // Add query
//   if (query) {
//     apiUrl += `&query=${encodeURIComponent(query.trim())}`;
//   }

//   // Add project type
//   if (projectType) {
//     apiUrl += `&project_types[]=${encodeURIComponent(projectType)}`;
//   }

//   let cleanSkills = [];

//   // ADD SKILLS CORRECTLY — lowercase + proper jobs[]
//   if (skills?.length > 0) {
//     const cleanSkills = skills
//       .map(s => encodeURIComponent(s.trim()))
//       .filter(Boolean)
//       .map(s => s.toLowerCase().replace(/\s+/g, ' ')); // "WordPress Design" → "wordpress design"

//    cleanSkills.forEach(skill => params.append("jobs[]", skill));
//   }

//   // === 3. Final URL banao ===
//   const apiUrl = `https://www.freelancer.com/api/projects/0.1/projects/active/?${params.toString()}`;


//   console.log("Skills (cleaned):", cleanSkills || []);
//   console.log("Final API URL:", apiUrl);

//   const data = await freelancerGet(apiUrl);
//   console.log("API Response Projects Count:", data?.result?.projects?.length || 0);

//   return data?.result?.projects ?? [];
// };


// module.exports = {
//   fetchActiveProjects
// };






//----------------------------------

// services/freelancerService.js
const token = process.env.FREELANCER_OAUTH_TOKEN;

const freelancerGet = async (url) => {
  if (!token) throw new Error("Missing FREELANCER_OAUTH_TOKEN");

  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const txt = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`API Error ${r.status}: ${txt.slice(0, 200)}`);

  return JSON.parse(txt);
};

const fetchActiveProjects = async ({ skills = [], limit = 50 , offset = 0}) => {
  const params = new URLSearchParams();
 params.append("limit", Math.min(limit, 100));
  params.append("offset", offset);
  params.append("job_details", "true");
  skills.forEach(s => params.append("jobs[]", s));
  
  // ADD SKILLS PROPERLY
  const cleanSkills = skills
    .map(s => String(s).trim().toLowerCase().replace(/\s+/g, ' '))
    .filter(Boolean);

  cleanSkills.forEach(s => params.append("jobs[]", s));

  const url = `https://www.freelancer.com/api/projects/0.1/projects/active/?${params.toString()}`;
  console.log("Skills sent to API:", cleanSkills);
  console.log("API URL:", url);

  const data = await freelancerGet(url);
  const projects = data?.result?.projects || [];

  // LAST 24 HOURS FILTER
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const recent = projects.filter(p => p.time_submitted && (p.time_submitted * 1000) >= dayAgo);

  console.log(`Total API: ${projects.length} | Last 24h: ${recent.length}`);
  return recent;
};

module.exports = { fetchActiveProjects };