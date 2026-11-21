import type {
  HumanAuth,
  HumanPrincipal,
  LoginCompletion,
  LoginStart,
} from "../../application/auth.js";

export function createDevHumanAuth(principal: HumanPrincipal): HumanAuth {
  return {
    mode: "dev",
    beginLogin(): Promise<LoginStart | null> {
      return Promise.resolve(null);
    },
    completeLogin(): Promise<LoginCompletion | null> {
      return Promise.resolve(null);
    },
    authenticate(): Promise<HumanPrincipal> {
      return Promise.resolve(principal);
    },
    logout(): Promise<void> {
      return Promise.resolve();
    },
  };
}
