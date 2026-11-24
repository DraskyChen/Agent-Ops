import { getText } from "./http.js";

export async function fetchContentText(contentId: string): Promise<string> {
  return getText(`/api/v1/content/${encodeURIComponent(contentId)}`);
}
