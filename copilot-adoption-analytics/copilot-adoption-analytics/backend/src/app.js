const express = require('express');
const cors = require('cors');
const pool = require('./db/pool');

const app = express();

app.use(cors());
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', require('./routes/auth')(pool));
app.use('/api/data', require('./routes/data')(pool));
app.use('/api/ai', require('./routes/ai')(pool));

app.use((req, res) => res.status(404).json({ success: false, message: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

module.exports = app;
