const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const cookieParser = require("cookie-parser");
// Load environment variables
dotenv.config();

const app = express();
app.set('trust proxy', 1);

// Middleware setup
app.use(express.json());
// REPLACE your CORS block with this:
const allowedOrigins = [
  'http://localhost:3001',
  'https://freelance-autobidding-production.up.railway.app', // aapka frontend
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // server-to-server / curl etc.
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('CORS blocked: ' + origin));
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

// (optional) Preflight ko explicitly handle:
app.options('*', cors({
  origin: allowedOrigins,
  credentials: true,
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

// === 24/7 AUTO FETCH LOOP  ===

startAutoFetcher();

app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Not Found', path: req.originalUrl });
});

// Central error handler (kabhi throw ho to 500 JSON aaye)
app.use((err, req, res, next) => {
  console.error('💥 Server error:', err);
  const msg = (err && err.message) ? err.message : 'Internal Server Error';
  res.status(500).json({ ok: false, error: msg });
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log("FREELANCER_OAUTH_TOKEN present:", !!process.env.FREELANCER_OAUTH_TOKEN);

});
