import express from 'express';

const app = express();

app.use(cors());
app.use(express.json());

// app.use('/api/market', marketAnalyticsRoutes);

// global middleware for error handling
app.use((err, req, res, next) => {
  console.error('🚨 Global Pipeline Error Context:', err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Pipeline Error',
  });
});

export default app;
