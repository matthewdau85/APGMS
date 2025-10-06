const express = require('express');
const path = require('path');

const app = express();
const root = path.resolve(__dirname, '..', 'apps', 'gui');

app.use(express.static(root));

const port = Number(process.env.PORT) || 4173;
const server = app.listen(port, () => {
  console.log(`[serve-gui] listening on http://127.0.0.1:${port}`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
