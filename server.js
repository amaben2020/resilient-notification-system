import app from './app';

const PORT = process.env.PORT || 3300;

const server = app.listen(PORT, () => {
  console.log('Listening on' + ` ${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');

  server.close(() => {
    console.log('HTTP server closed — no more requests being accepted');
    // close DB connections, Redis clients, etc. here
    process.exit(0);
  });

  // safety net: force-exit if graceful shutdown takes too long
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
});
