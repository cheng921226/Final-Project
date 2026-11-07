import { clearManagementDataCache, managementFetch } from './managementDataCache';

const originalFetch = global.fetch;

function jsonResponse(data) {
  return {
    ok: true,
    headers: { get: () => 'application/json' },
    clone: () => jsonResponse(data),
    json: async () => data,
  };
}

afterEach(() => {
  clearManagementDataCache();
  global.fetch = originalFetch;
});

test('caches GET data separately per token and invalidates after successful writes', async () => {
  const fetchMock = jest.fn()
    .mockResolvedValueOnce(jsonResponse({ value: 'first response' }))
    .mockResolvedValueOnce(jsonResponse({ value: 'second user' }))
    .mockResolvedValueOnce(jsonResponse({ value: 'write complete' }))
    .mockResolvedValueOnce(jsonResponse({ value: 'fresh response' }));
  global.fetch = fetchMock;
  const url = 'http://127.0.0.1:8000/teacher/course-management';

  const firstUserOptions = { headers: { Authorization: 'Bearer first-user' } };
  await managementFetch(url, firstUserOptions);
  await managementFetch(url, firstUserOptions);
  expect(fetchMock).toHaveBeenCalledTimes(1);

  await managementFetch(url, { headers: { Authorization: 'Bearer second-user' } });
  expect(fetchMock).toHaveBeenCalledTimes(2);

  await managementFetch(url, {
    ...firstUserOptions,
    method: 'PUT',
    body: JSON.stringify({ title: 'Updated' }),
  });
  await managementFetch(url, firstUserOptions);
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

test('does not cache requests explicitly marked as volatile', async () => {
  const fetchMock = jest.fn()
    .mockResolvedValue(jsonResponse({ status: 'processing' }));
  global.fetch = fetchMock;
  const url = 'http://127.0.0.1:8000/teacher/course-management/job-statuses';

  await managementFetch(url, { managementCache: false });
  await managementFetch(url, { managementCache: false });

  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('expires cached data after 60 seconds', async () => {
  const fetchMock = jest.fn()
    .mockResolvedValueOnce(jsonResponse({ value: 'cached' }))
    .mockResolvedValueOnce(jsonResponse({ value: 'refreshed' }));
  global.fetch = fetchMock;
  const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
  const url = 'http://127.0.0.1:8000/teacher/analytics';

  await managementFetch(url);
  now.mockReturnValue(61_000);
  await managementFetch(url);

  expect(fetchMock).toHaveBeenCalledTimes(2);
  now.mockRestore();
});
