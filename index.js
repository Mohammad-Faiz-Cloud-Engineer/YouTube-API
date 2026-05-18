const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const youtubeRoutes = require('./routes');
const { getCacheStats } = require('./cache');

// ── Startup env validation ────────────────────────────────────────────────
// Warn loudly if CORS_ORIGIN is not set — wildcard is insecure in production.
if (!process.env.CORS_ORIGIN) {
  console.warn(
    '[server] WARNING: CORS_ORIGIN env variable is not set. ' +
    'Defaulting to wildcard (*). Set CORS_ORIGIN to a specific origin in production.'
  );
}

const app = express();
const PORT = process.env.PORT || 3040;

// ── Security ──────────────────────────────────────────────────────────────
app.use(helmet({ crossOriginEmbedderPolicy: false }));

// ── CORS ──────────────────────────────────────────────────────────────────
// REQUIRES HUMAN DECISION: In production, set CORS_ORIGIN to your exact
// client origin (e.g. "https://app.example.com"). Wildcard is acceptable
// only for a fully public, unauthenticated API.
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Range', 'Accept'],
  exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length'],
}));

// ── Logging ───────────────────────────────────────────────────────────────
// Use 'combined' in production for full access logs; 'dev' is noisy.
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── Rate limiting ─────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many requests, please try again later' },
});

app.use('/api', apiLimiter);

// ── Body parsing ──────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));

// ── Admin panel (static files) ────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API routes ────────────────────────────────────────────────────────────
app.use('/api', youtubeRoutes);

// ── Cache stats endpoint (admin) ──────────────────────────────────────────
// REQUIRES HUMAN DECISION: This endpoint exposes internal server metrics.
// Add authentication middleware here before deploying publicly.
// Example: app.get('/api/admin/cache', requireAdminAuth, (_req, res) => { ... })
app.get('/api/admin/cache', (_req, res) => {
  res.json(getCacheStats());
});

// ── 404 handler ───────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'not_found', message: 'Route not found' });
});

// ── Global error handler ──────────────────────────────────────────────────
// Intentionally does NOT forward err.message to the client — internal
// error details must not leak to untrusted callers.
app.use((err, _req, res, _next) => {
  console.error('[server] unhandled error:', err.message, err.stack);
  res.status(500).json({ error: 'internal_error', message: 'An internal server error occurred' });
});

// ── Start ─────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║        OpenMusic YouTube Server v1.0.0              ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Admin Panel:  http://localhost:${PORT}                `);
  console.log(`║  API Base:     http://localhost:${PORT}/api            `);
  console.log(`║  Health:       http://localhost:${PORT}/api/health     `);
  console.log('╚══════════════════════════════════════════════════════╝');
});

// Surface port-in-use and permission errors immediately rather than letting
// the process hang silently after a failed bind.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[server] Port ${PORT} is already in use. Set a different PORT env variable.`);
  } else if (err.code === 'EACCES') {
    console.error(`[server] Permission denied binding to port ${PORT}. Use a port > 1024 or run with elevated privileges.`);
  } else {
    console.error('[server] Failed to start:', err.message);
  }
  process.exit(1);
});

module.exports = app;
