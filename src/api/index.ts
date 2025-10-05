import { Router } from "express";

import { paymentsApi } from "./payments";

const api = Router();

// Ensure payments routes are registered before any other subrouters that may shadow them.
api.use(paymentsApi);

export { api, paymentsApi };
export default api;
