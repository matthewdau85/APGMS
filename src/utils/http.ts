export async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const text = await response.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch (error) {
    data = undefined;
  }

  if (!response.ok) {
    const message = data?.error || data?.message || data?.detail || text || `HTTP ${response.status}`;
    throw new Error(String(message));
  }

  return data as T;
}
