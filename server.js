const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const cookieParser = require("cookie-parser");
// Load environment variables
dotenv.config();

const app = express();

// Middleware setup
app.use(express.json());
app.use(cors({
  origin:[ process.env.CLIENT_URL],
  credentials: true
}));
app.use(cookieParser());   

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));
// Import Routes

const configRoute = require('./routes/config');
const projectRoute = require('./routes/projects');
const biddingRoute = require('./routes/bidding');
const freelancerRoute = require('./routes/freelancer');
const userRoute = require('./routes/user');
const { startAutoFetcher } = require('./workers/autoFetcher');


// Mount Routes

app.use('/api/config', configRoute);
app.use('/api/projects', projectRoute);
app.use('/api/bidding', biddingRoute);
app.use('/api/freelancer', freelancerRoute);
app.use('/api/user', userRoute);

// Health check route
app.get('/health', (_, res) => {
  res.json({ status: 'OK' });
});

// === 24/7 AUTO FETCH LOOP (NO PM2) ===

startAutoFetcher();

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log("FREELANCER_OAUTH_TOKEN present:", !!process.env.FREELANCER_OAUTH_TOKEN);

});
