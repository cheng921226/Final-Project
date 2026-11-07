import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

jest.mock('markmap-lib', () => ({ Transformer: jest.fn() }));
jest.mock('markmap-view', () => ({ Markmap: { create: jest.fn() } }));

import LectureDetail from './LectureDetail';

const originalFetch = global.fetch;
const lectureId = 'cache-test-lecture-401';
const lectureUrl = `http://127.0.0.1:8000/lectures/${lectureId}`;

function renderLectureDetail() {
  return render(
    <MemoryRouter initialEntries={[`/course/course-401/lecture/${lectureId}`]}>
      <Routes>
        <Route
          path="/course/:id/lecture/:lectureId"
          element={<LectureDetail />}
        />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => {
  global.fetch = originalFetch;
  localStorage.clear();
});

test('reuses cached lecture data when returning to the same lecture', async () => {
  window.scrollTo = jest.fn();
  Element.prototype.scrollIntoView = jest.fn();
  const fetchMock = jest.fn(url => Promise.resolve({
    ok: true,
    json: async () => {
      if (url === lectureUrl) {
        return [{ media_url: 'https://youtu.be/abcdefghijk' }];
      }
      if (String(url).endsWith('/chats')) return { messages: [] };
      if (String(url).endsWith(`/video_progresses/${lectureId}`)) {
        return { watched_seconds: 30, completed: false };
      }
      return [];
    },
  }));
  global.fetch = fetchMock;
  localStorage.setItem('access_token', 'lecture-cache-test-token');

  const firstRender = renderLectureDetail();
  expect(await screen.findByText('無摘要資料')).toBeInTheDocument();
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(fetchMock.mock.calls.filter(([url]) => url === lectureUrl)).toHaveLength(1);
  firstRender.unmount();

  renderLectureDetail();

  expect(screen.getByText('無摘要資料')).toBeInTheDocument();
  expect(fetchMock.mock.calls.filter(([url]) => url === lectureUrl)).toHaveLength(1);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
});

test('shows the HTTP failure for a summary request instead of a null property error', async () => {
  window.scrollTo = jest.fn();
  Element.prototype.scrollIntoView = jest.fn();
  const fetchMock = jest.fn(url => {
    if (String(url).endsWith('/summaries')) {
      return Promise.resolve({
        ok: false,
        status: 500,
        clone: () => ({
          json: async () => ({ detail: '摘要服務暫時無法使用' }),
          text: async () => '',
        }),
      });
    }

    return Promise.resolve({
      ok: true,
      json: async () => {
        if (url === lectureUrl) {
          return [{ media_url: 'https://youtu.be/abcdefghijk' }];
        }
        if (String(url).endsWith('/chats')) return { messages: [] };
        if (String(url).endsWith(`/video_progresses/${lectureId}`)) {
          return { watched_seconds: 0, completed: false };
        }
        return [];
      },
    });
  });
  global.fetch = fetchMock;
  localStorage.setItem('access_token', 'lecture-summary-error-test-token');

  renderLectureDetail();

  expect(await screen.findByRole('alert')).toHaveTextContent(
    '摘要載入失敗：摘要請求失敗（HTTP 500）：摘要服務暫時無法使用'
  );
  expect(screen.queryByText(/Cannot read properties of null/)).not.toBeInTheDocument();
});
