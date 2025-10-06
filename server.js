require('dotenv').config({ path: '.env.local' });

(async () => {
  try {
    const mod = await import('./dist/index.js');
    if (typeof mod.startServer === 'function') {
      await mod.startServer();
    } else {
      throw new Error('dist/index.js does not export startServer');
    }
  } catch (error) {
    console.error('Failed to load compiled server. Run "npm run build" to generate dist/index.js.', error);
    process.exit(1);
  }
})();
