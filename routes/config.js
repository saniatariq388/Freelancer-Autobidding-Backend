const express = require('express');
const { getMyConfig, updateMyConfig } = require('../controllers/userConfigController');
const router = express.Router();


console.log("[routes/config] getMyConfig typeof:", typeof getMyConfig);
console.log("[routes/config] updateMyConfig typeof:", typeof updateMyConfig);


// User Config Routes
 // optional   
//router.post("/", updateMyConfig); 
  


router.get('/', getMyConfig);        

//router.get('/self', getMyConfig);    

// Upsert config (create/update)
router.post('/', updateMyConfig);     
//router.put('/self', updateMyConfig); 


module.exports = router;
