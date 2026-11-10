const MANAGEMENT_CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES_PER_USER = 100;
const dataByToken = new Map();
const requestGenerationByToken = new Map();

function getToken(input, init) {
  const requestHeaders = typeof Request !== 'undefined' && input instanceof Request
    ? input.headers
    : undefined;
  const headers = new Headers(init?.headers || requestHeaders);
  const authorization = headers.get('Authorization');
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7);
  return localStorage.getItem('access_token') || 'anonymous';
}

function getGeneration(token) {
  if (!requestGenerationByToken.has(token)) requestGenerationByToken.set(token, 0);
  return requestGenerationByToken.get(token);
}

function pruneExpiredEntries(now) {
  for (const [token, entries] of dataByToken) {
    for (const [url, entry] of entries) {
      if (entry.expiresAt <= now) entries.delete(url);
    }
    if (entries.size === 0) dataByToken.delete(token);
  }
}

export function clearManagementDataCache(token) {
  if (token) {
    dataByToken.delete(token);
    requestGenerationByToken.set(token, getGeneration(token) + 1);
    return;
  }

  dataByToken.clear();
  for (const [cachedToken, generation] of requestGenerationByToken) {
    requestGenerationByToken.set(cachedToken, generation + 1);
  }
}

export async function managementFetch(input, init = {}) {
  const { managementCache = true, ...requestInit } = init;
  const request = typeof Request !== 'undefined' && input instanceof Request
    ? input
    : null;
  const method = (requestInit.method || request?.method || 'GET').toUpperCase();
  const token = getToken(input, requestInit);
  const url = typeof input === 'string' ? input : input.url || input.href;
  const cacheable = managementCache && method === 'GET';
  const now = Date.now();
  pruneExpiredEntries(now);
  const userCache = dataByToken.get(token);
  const cached = cacheable ? userCache?.get(url) : null;

  if (cached && cached.expiresAt > now) {
    return cached.response.clone();
  }
  if (cached) userCache.delete(url);

  const generation = getGeneration(token);
  const response = await fetch(input, requestInit);

  if (!response.ok) return response;
  if (method !== 'GET') {
    clearManagementDataCache(token);
    return response;
  }

  if (
    cacheable
    && response.headers?.get?.('content-type')?.includes('application/json')
    && !response.headers.get('cache-control')?.includes('no-store')
    && typeof response.clone === 'function'
    && generation === getGeneration(token)
  ) {
    const entries = userCache || new Map();
    entries.set(url, {
      response: response.clone(),
      expiresAt: now + MANAGEMENT_CACHE_TTL_MS,
    });
    while (entries.size > MAX_CACHE_ENTRIES_PER_USER) {
      entries.delete(entries.keys().next().value);
    }
    dataByToken.set(token, entries);
  }

  return response;
}
