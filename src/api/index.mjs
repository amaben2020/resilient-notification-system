// The Express app, unchanged, running on Lambda behind a Function URL.
// serverless-http converts the Lambda HTTP event into a Node request and the
// Express response back into the Lambda response format.
import serverless from 'serverless-http';
import app from '../../app.js';

export const handler = serverless(app);
