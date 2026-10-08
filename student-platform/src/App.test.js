import { fireEvent, render, screen } from '@testing-library/react';
import App from './App';

jest.mock('markmap-lib', () => ({
  Transformer: jest.fn(),
}));

jest.mock('markmap-view', () => ({
  Markmap: { create: jest.fn() },
}));

afterEach(() => {
  window.history.pushState({}, '', '/');
  localStorage.clear();
  jest.restoreAllMocks();
});

test('renders the learning platform home navigation', () => {
  render(<App />);
  expect(screen.getByText('AI輔助線上學習平台')).toBeInTheDocument();
  expect(screen.getByText('登入')).toBeInTheDocument();
});

test('redirects unauthenticated users away from course preview', async () => {
  window.history.pushState({}, '', '/course/1');
  render(<App />);

  expect(await screen.findByRole('heading', { name: '歡迎回來' })).toBeInTheDocument();
});

test('returns the user to the attempted course page after login', async () => {
  window.history.pushState({}, '', '/course/1');
  global.fetch = jest.fn((url) => {
    if (typeof url === 'string' && url.includes('/login')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ access_token: 'new-token', refresh_token: 'refresh-token' }),
      });
    }

    if (typeof url === 'string' && url.includes('/courses/1/lectures')) {
      return Promise.resolve({
        ok: true,
        json: async () => [],
      });
    }

    return Promise.resolve({ ok: true, json: async () => ({}) });
  });

  render(<App />);

  fireEvent.change(screen.getByPlaceholderText('name@example.com'), {
    target: { value: 'user@example.com' },
  });
  fireEvent.change(screen.getByPlaceholderText('輸入你的密碼'), {
    target: { value: 'password123' },
  });
  fireEvent.click(screen.getByRole('button', { name: '登入學習空間' }));

  expect(await screen.findByRole('heading', { name: '課程學習地圖' })).toBeInTheDocument();
});
