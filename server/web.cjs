const express = require('express');
const path    = require('path');
try { require('dotenv').config(); } catch(e) {}

// Compression — reduces payload 60-80%
let compress;
try { compress = require('compression'); } catch(_) { compress = null; }

const app = express();

if (compress) app.use(compress());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Cache static assets aggressively (1 week for JS/CSS, 1 day for HTML)
app.use(express.static(path.join(__dirname, '..'), {
  maxAge: '1d',
  setHeaders(res, filePath) {
    if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=604800'); // 1 week
    }
  }
}));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

const port = process.env.PORT || 5800;
app.listen(port);
