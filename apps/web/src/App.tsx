import { Console } from "./Console.js";
import { Landing } from "./Landing.js";

export function App() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return path === "/console" ? <Console /> : <Landing />;
}


