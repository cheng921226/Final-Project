import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CourseDetail from './CourseDetail';

const originalFetch = global.fetch;

function renderCourseDetail(id = 'cache-test-301') {
  return render(
    <MemoryRouter initialEntries={[`/course/${id}`]}>
      <Routes>
        <Route path="/course/:id" element={<CourseDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => {
  global.fetch = originalFetch;
  localStorage.clear();
});

test('reuses cached lectures and user progress when returning to the learning map', async () => {
  localStorage.setItem('access_token', 'course-detail-cache-token');
  const fetchMock = jest.fn(url => {
    if (String(url).endsWith('/lectures')) {
      return Promise.resolve({
        ok: true,
        json: async () => [{
          id: 7,
          title: '快取測試小節',
          duration_seconds: 100,
          status: 'completed',
        }],
      });
    }
    if (String(url).endsWith('/video-progresses')) {
      return Promise.resolve({
        ok: true,
        json: async () => [{ lecture_id: 7, watched_seconds: 50, completed: false }],
      });
    }
    return Promise.resolve({
      ok: true,
      json: async () => ({ state: 'ready', settings: { passing_score: 70 } }),
    });
  });
  global.fetch = fetchMock;

  const firstRender = renderCourseDetail();
  expect(await screen.findByRole('heading', { name: '快取測試小節' })).toBeInTheDocument();
  expect(screen.getByText('50%')).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(3);
  firstRender.unmount();

  renderCourseDetail();

  expect(screen.getByRole('heading', { name: '快取測試小節' })).toBeInTheDocument();
  expect(screen.getByText('50%')).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

test('does not share cached learning progress between users', async () => {
  const fetchMock = jest.fn(() => Promise.resolve({
    ok: true,
    json: async () => [],
  }));
  global.fetch = fetchMock;
  const courseId = 'cache-test-user-isolation-302';

  localStorage.setItem('access_token', 'first-user-token');
  const firstRender = renderCourseDetail(courseId);
  await screen.findByText('這門課程目前還沒有小節內容。');
  firstRender.unmount();

  localStorage.setItem('access_token', 'second-user-token');
  renderCourseDetail(courseId);
  await screen.findByText('這門課程目前還沒有小節內容。');

  expect(fetchMock).toHaveBeenCalledTimes(6);
});
