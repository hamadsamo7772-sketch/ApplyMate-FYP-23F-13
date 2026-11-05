// server/index.js — ApplyMate API server
//   npm run server      (from the project root)
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const auth = require('./auth');
const profile = require('./profile');
const opportunities = require('./opportunities');
const applications = require('./applications');
const tracker = require('./tracker');
const notifications = require('./notify');
const dashboard = require('./dashboard');
const chat = require('./chat');

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/applymate';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.use('/api/auth', auth.router);
app.use('/api/profile', profile.router);
app.use('/api/opportunities', opportunities.router);
app.use('/api/applications', applications.router);
app.use('/api/tracker', tracker.router);
app.use('/api/notifications', notifications.router);
app.use('/api/dashboard', dashboard.router);
app.use('/api/chat', chat.router);
app.get('/api/health', (req, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1 }));

// Local demo portals the agent can practise on (agent/test-forms)
app.use('/demo', express.static(path.join(__dirname, '..', 'agent', 'test-forms')));

// In production, serve the built React app (client/dist)
const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|demo).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// Errors -> JSON instead of an HTML page
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

mongoose
  .connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 })
  .then(() => {
    console.log(`✅ MongoDB connected (${MONGO_URI})`);
    app.listen(PORT, () => console.log(`🚀 ApplyMate API on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error(`❌ Could not connect to MongoDB at ${MONGO_URI}\n   ${err.message}`);
    console.error('   Is MongoDB running? (Windows: Services -> MongoDB Server should be "Running")');
    process.exit(1);
  });
