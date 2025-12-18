import { createDefine } from "fresh";

import type { User } from "./utils/db/users.ts"; // Import your User type

export interface State {
  user?: User;
}

export const define = createDefine<State>();
