import { createPgPool } from "../../libs/db/pool";

export const appPool = createPgPool("app-core");
