// ESM-safe env loader used by all modules that touch process.env
import { resolve } from 'path';
import dotenv from 'dotenv';

const repoEnv = resolve(process.cwd(), '.env.local');
dotenv.config({ path: repoEnv });
dotenv.config();
