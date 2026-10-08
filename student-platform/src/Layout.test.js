import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import Layout from './Layout';

const originalFetch = global.fetch;

function makeToken(exp) {
  const payload = window.btoa(JSON.stringify({ exp }))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `header.${payload}.signature`;
}

function TestApp() {
  const [token, setToken] = useState(localStorage.getItem('access_token'));
  return (
    <MemoryRouter>
      <Layout token={token} setToken={setToken} />
    </MemoryRouter>
  );
}

afterEach(() => {
  jest.useRealTimers();
  localStorage.clear();
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

test('refreshes an idle session before its access token expires', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-09T00:00:00Z'));
  const originalToken = makeToken(Date.now() / 1000 + 120);
  const refreshedToken = makeToken(Date.now() / 1000 + 3600);
  localStorage.setItem('access_token', originalToken);
  localStorage.setItem('refresh_token', 'refresh-token');
  global.fetch = jest.fn(url => Promise.resolve({
    ok: true,
    json: async () => url.includes('/refresh')
      ? { access_token: refreshedToken, refresh_token: 'rotated-refresh-token' }
      : { name: '測試使用者', role: 'teacher' },
  }));

  render(<TestApp />);
  expect(await screen.findByText('測試使用者')).toBeInTheDocument();

  await act(async () => {
    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(localStorage.getItem('access_token')).toBe(refreshedToken);
  expect(localStorage.getItem('refresh_token')).toBe('rotated-refresh-token');
  expect(screen.getByRole('button', { name: /教師功能/ })).toBeInTheDocument();
});
