import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import Home from './Home';

const originalFetch = global.fetch;
const publicCourses = [
  { id: 12, course_name: '已發布課程', teacher_name: '王老師', status: 'published' },
  { id: 15, course_name: '其他教師已發布課程', teacher_name: '陳老師', status: 'published' },
];
const managedCourses = [
  {
    id: 12,
    title: '已發布課程',
    status: 'published',
    teacher_id: 5,
    created_by_user_id: 22,
    assigned_teacher: { name: '王老師' },
  },
  { id: 13, title: '教師草稿', status: 'draft', teacher_id: 5, created_by_user_id: 99, assigned_teacher: { name: '王老師' } },
  { id: 14, title: '教師封存', status: 'archived', teacher_id: 5, created_by_user_id: 22, assigned_teacher: { name: '王老師' } },
];

function HomeHarness({ user, token = 'test-token' }) {
  return (
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<Outlet context={{ user }} />}>
          <Route index element={<Home token={token} />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => {
  global.fetch = originalFetch;
});

test('teachers see published and owned courses, with analysis only for owned courses', async () => {
  global.fetch = jest.fn(url => Promise.resolve({
    ok: true,
    json: async () => String(url).includes('/teacher/course-management')
      ? { actor: { id: 5, role: 'teacher' }, courses: managedCourses }
      : publicCourses,
  }));

  render(<HomeHarness user={{ role: 'teacher', email: 'teacher@example.com' }} />);

  expect(await screen.findByRole('heading', { name: '教師草稿' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '已發布課程' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '其他教師已發布課程' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '教師封存' })).toBeInTheDocument();
  const analysisLinks = screen.getAllByRole('link', { name: '課程分析' });
  expect(analysisLinks).toHaveLength(3);
  expect(analysisLinks.map(link => link.getAttribute('href'))).toEqual([
    '/teacher?course=12',
    '/teacher?course=13',
    '/teacher?course=14',
  ]);
  expect(screen.getAllByText('已發布')).toHaveLength(2);
  expect(screen.getByText('草稿')).toHaveClass('status-draft');
  expect(screen.getByText('已封存')).toHaveClass('status-archived');
});

test('campus users see all managed courses and can analyze each one', async () => {
  const allManagedCourses = managedCourses.map(item => ({
    ...item,
    teacher_id: item.id === 13 ? 88 : item.teacher_id,
  }));
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ actor: { id: 22, role: 'campus' }, courses: allManagedCourses }),
  });

  render(<HomeHarness user={{ role: 'campus', email: 'campus@example.com' }} />);

  expect(await screen.findByRole('heading', { name: '教師草稿' })).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: '課程分析' })).toHaveLength(3);
  expect(screen.getByText('已發布')).toBeInTheDocument();
  expect(screen.getByText('草稿')).toHaveClass('status-draft');
  expect(screen.getByText('已封存')).toHaveClass('status-archived');
});

test('students see only their enrolled published courses without status or analysis controls', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => [publicCourses[0]],
  });

  render(<HomeHarness user={{ id: 1, role: 'student', email: 'student@example.com' }} />);

  await screen.findByRole('heading', { name: '已發布課程' });
  expect(screen.queryByRole('heading', { name: '其他教師已發布課程' })).not.toBeInTheDocument();
  expect(screen.queryByText('已發布')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: '課程分析' })).not.toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch).toHaveBeenCalledWith(
    'http://127.0.0.1:8000/courses',
    expect.objectContaining({
      headers: { Authorization: 'Bearer test-token' },
    })
  );
});

test('unauthenticated visitors do not see course statuses or analysis controls', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => publicCourses,
  });

  render(<HomeHarness token={null} />);

  await screen.findByRole('heading', { name: '已發布課程' });
  expect(screen.queryByText('已發布')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: '課程分析' })).not.toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('reuses the recent course list when returning to the home page', async () => {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => publicCourses,
  });
  global.fetch = fetchMock;
  const user = { id: 2, role: 'student', email: 'cache-test@example.com' };

  const firstRender = render(<HomeHarness user={user} />);
  expect(await screen.findByRole('heading', { name: '已發布課程' })).toBeInTheDocument();
  firstRender.unmount();

  render(<HomeHarness user={user} />);

  expect(screen.getByRole('heading', { name: '已發布課程' })).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
