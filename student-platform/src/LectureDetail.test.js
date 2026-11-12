import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Markmap } from 'markmap-view';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import LectureDetail from './LectureDetail';
import { clearLectureDetailCache } from './lectureDetailCache';

jest.mock('markmap-view', () => ({
  Markmap: { create: jest.fn() },
}));

const originalFetch = global.fetch;
const lectureId = 'cache-test-lecture-401';
const lectureUrl = `http://127.0.0.1:8000/lectures/${lectureId}`;

function renderLectureDetail(path = `/course/course-401/lecture/${lectureId}`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/course/:id/lecture/:lectureId" element={<LectureDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  jest.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

afterEach(() => {
  Markmap.create.mockReset();
  global.fetch = originalFetch;
  localStorage.clear();
  clearLectureDetailCache();
  jest.restoreAllMocks();
});

test('uses measured zoom bounds and cancels mindmap animations when leaving the tab', async () => {
  const responses = {
    '/lectures/2': [{}],
    '/lectures/2/mindmaps': [{ mindmap_json: { markdown: '# 課程\n## 走訪' } }],
    '/lectures/2/knowledge_points': [{ id: 1, title: '走訪', start_time: 205 }],
  };
  global.fetch = jest.fn(async url => ({
    ok: true,
    json: async () => responses[new URL(url).pathname] ?? [],
  }));

  const markmap = {
    zoom: { extent: jest.fn() },
    state: {},
    svg: {
      interrupt: jest.fn().mockReturnThis(),
      selectAll: jest.fn().mockReturnThis(),
    },
    setData: jest.fn(root => { markmap.state.data = root; }),
    destroy: jest.fn(() => {
      expect(markmap.state.data).toBeUndefined();
      expect(markmap.svg.interrupt).toHaveBeenCalledTimes(2);
    }),
  };
  Markmap.create.mockReturnValue(markmap);

  renderLectureDetail('/course/1/lecture/2');
  fireEvent.click(screen.getByRole('button', { name: /心智圖/ }));
  await waitFor(() => expect(markmap.setData).toHaveBeenCalledTimes(1));

  const [svg] = Markmap.create.mock.calls[0];
  const [extent] = markmap.zoom.extent.mock.calls[0];
  const measure = jest.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ width: 640, height: 420 });
  expect(extent()).toEqual([[0, 0], [640, 420]]);
  expect(markmap.state.data.children[0].content).not.toContain('<button');

  fireEvent.click(screen.getByRole('button', { name: /AI 摘要/ }));
  expect(svg.isConnected).toBe(false);
  expect(markmap.destroy).toHaveBeenCalledTimes(1);
  measure.mockReturnValue({ width: 0, height: 0 });
  expect(extent()).toEqual([[0, 0], [1, 1]]);
});

test('reuses cached lecture data when returning to the same lecture', async () => {
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

test.each([
  ['invalid URL', '無效連結', true, 0],
  ['YouTube player error', 'https://youtu.be/abcdefghijk', true, 0],
  ['YouTube failure after playback starts', 'https://youtu.be/abcdefghijk', true, 77],
  ['YouTube player error without a backup', 'https://youtu.be/abcdefghijk', false, 0],
])('handles %s', async (_, mediaUrl, hasBackup, currentTime) => {
  localStorage.setItem('access_token', 'fallback-test-token');
  const originalYouTube = window.YT;
  const player = {
    destroy: jest.fn(),
    getCurrentTime: () => currentTime,
    getDuration: () => 120,
    seekTo: jest.fn(),
  };
  const createPlayer = jest.fn(() => player);
  window.YT = { Player: createPlayer };
  const responses = {
    '/lectures/2': [{
      media_url: mediaUrl,
      backup_status: hasBackup ? 'completed' : 'not_requested',
    }],
    '/lectures/2/backup': { status: 'completed', playback_url: '/backup.mp4' },
    '/lectures/2/chats': { messages: [] },
    '/video_progresses/2': { last_position: 42 },
  };
  global.fetch = jest.fn(async url => ({
    ok: true,
    json: async () => responses[new URL(url).pathname] ?? [],
  }));

  try {
    const { container } = renderLectureDetail('/course/1/lecture/2');
    if (mediaUrl.startsWith('https://')) {
      await waitFor(() => expect(createPlayer).toHaveBeenCalledTimes(1));
      await screen.findByText(/儘管發問吧/);
      expect(screen.queryByRole('button', { name: '切換至備份影片' })).not.toBeInTheDocument();
      const [, options] = createPlayer.mock.calls[0];
      if (currentTime > 0) {
        await act(async () => options.events.onReady({ target: player }));
      }
      act(() => options.events.onError({ data: 100 }));
    }

    if (hasBackup) {
      await waitFor(() => expect(container.querySelector('video')).toHaveAttribute('src', '/backup.mp4'));
      expect(screen.queryByRole('button', { name: '切換至 YouTube' })).not.toBeInTheDocument();
      const video = container.querySelector('video');
      fireEvent.loadedMetadata(video);
      await waitFor(() => expect(video.currentTime).toBe(currentTime || 42));
    } else {
      expect(await screen.findByText(/YouTube 播放器載入失敗/)).toBeInTheDocument();
      expect(container.querySelector('video')).toBeNull();
    }
  } finally {
    window.YT = originalYouTube;
  }
});

test('sends a selected image to the assistant without requiring a typed question', async () => {
  localStorage.setItem('access_token', 'image-test-token');
  const originalCreateUrl = URL.createObjectURL;
  const originalRevokeUrl = URL.revokeObjectURL;
  URL.createObjectURL = jest.fn(() => 'blob:chat-preview');
  URL.revokeObjectURL = jest.fn();
  const responses = {
    '/lectures/2': [{}],
    '/lectures/2/chats': { messages: [] },
    '/ai/chat': { answer: '圖片解說' },
  };
  let attempts = 0;
  global.fetch = jest.fn(async url => {
    const path = new URL(url).pathname;
    if (path === '/ai/chat' && ++attempts === 1) {
      return { ok: false, json: async () => ({ detail: 'AI 助教目前已達用量限制，請稍後再試' }) };
    }
    return { ok: true, json: async () => responses[path] ?? [] };
  });

  try {
    renderLectureDetail('/course/1/lecture/2');
    await screen.findByText(/儘管發問吧/);

    const image = new File(['image data'], 'lecture.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('選擇圖片'), { target: { files: [image] } });
    expect(await screen.findByAltText('待送出的圖片')).toHaveAttribute('src', 'blob:chat-preview');
    fireEvent.click(screen.getByRole('button', { name: '送出' }));

    expect(await screen.findByText('AI 助教目前已達用量限制，請稍後再試')).toBeInTheDocument();
    expect(screen.getByAltText('待送出的圖片')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '送出' }));
    expect(await screen.findByText('圖片解說')).toBeInTheDocument();
    expect(screen.getAllByAltText('提問附圖')).toHaveLength(2);
    const [, request] = global.fetch.mock.calls.find(([url]) => url.endsWith('/ai/chat'));
    expect(JSON.parse(request.body)).toMatchObject({
      lecture_id: 2,
      image: { mime_type: 'image/png', data: 'aW1hZ2UgZGF0YQ==' },
    });
  } finally {
    URL.createObjectURL = originalCreateUrl;
    URL.revokeObjectURL = originalRevokeUrl;
  }
});
