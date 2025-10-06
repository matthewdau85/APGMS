// ESM-safe env loader used by all modules that touch process.env
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// load repo-root .env.local first
dotenv.config({ path: resolve(__dirname, '../../../../.env.local') });
// provider bindings override
dotenv.config({ path: resolve(__dirname, '../../../../.env.providers'), override: true });
// then a local .env (optional)
dotenv.config({ override: true });
