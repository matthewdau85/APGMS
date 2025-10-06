export function createRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    try {
      return crypto.randomUUID();
    } catch (error) {
      // fall through to manual id if randomUUID throws
    }
  }
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `req_${timestamp}_${random}`;
}
