'use strict';
// Local static file server — serves the public/ directory only.
// The /api/update endpoint requires Google credentials and runs
// as a Vercel serverless function. For full local dev use: npm run dev
const express = require('express');
const path    = require('path');
const app     = express();

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Static preview → http://localhost:${PORT}`);
  console.log(`(Admin writes require: npm run dev)\n`);
});
