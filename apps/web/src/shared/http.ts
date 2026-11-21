export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`${path} failed with HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function getText(path: string): Promise<string> {
  const response = await fetch(path, {
    headers: {
      accept: "text/plain, application/json, */*",
    },
  });
  if (!response.ok) {
    throw new Error(`${path} failed with HTTP ${response.status}`);
  }
  return response.text();
}
