const { startMockServer } = require('./mock_server.cjs');

(async () => {
  try {
    const ctx = await startMockServer();
    console.log(JSON.stringify({ baseUrl: ctx.baseUrl }));
    const shutdown = async () => {
      await ctx.close();
      process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
