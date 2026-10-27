import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CourseUpload from './CourseUpload';

const originalFetch = global.fetch;

afterEach(() => {
  localStorage.removeItem('access_token');
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

test('starts empty and lets the teacher search for a course', async () => {
  localStorage.setItem('access_token', 'teacher-token');
  global.fetch = jest.fn(url => Promise.resolve({
    ok: true,
    json: async () => {
      if (url.includes('/teacher/course-management')) {
        return {
          courses: [
            { id: 1, title: '資料結構' },
            { id: 2, title: '離散數學' },
          ],
        };
      }
      if (url.endsWith('/id')) return { id: 10 };
      if (url.endsWith('/role')) return { role: 'teacher' };
      return {};
    },
  }));

  render(
    <MemoryRouter initialEntries={[{
      pathname: '/teacher/upload',
      state: { courseId: 2 },
    }]}>
      <Routes>
        <Route path="/teacher/upload" element={<CourseUpload />} />
      </Routes>
    </MemoryRouter>
  );

  const searchInput = await screen.findByRole('combobox', { name: '課程' });
  expect(screen.getByRole('radio', { name: 'YouTube 連結' })).toBeChecked();
  expect(screen.getByRole('radio', { name: '本機影片' })).toBeInTheDocument();
  expect(searchInput).toHaveValue('');

  fireEvent.change(searchInput, { target: { value: '資料' } });
  const result = screen.getByRole('option', { name: '資料結構｜尚未指派' });
  fireEvent.click(result);
  expect(searchInput).toHaveValue('資料結構');
});

test('asks before overwriting a duplicate video and reuses the existing lecture', async () => {
  localStorage.setItem('access_token', 'teacher-token');
  let lectureRequests = 0;
  global.fetch = jest.fn(async (url, options = {}) => {
    if (url.includes('/teacher/course-management')) return {
      ok: true,
      json: async () => ({ courses: [{ id: 1, title: '資料結構' }] }),
    };
    if (url.endsWith('/id')) return { ok: true, json: async () => ({ id: 10 }) };
    if (url.endsWith('/role')) return { ok: true, json: async () => ({ role: 'teacher' }) };
    if (url.endsWith('/lectures') && options.method === 'POST') {
      lectureRequests += 1;
      if (lectureRequests === 1) return {
        ok: false,
        json: async () => ({ detail: { code: 'DUPLICATE_LECTURE', message: '此影片已存在於目前課程中。', lecture: { id: 48, title: '原有小節', course_id: 1 } } }),
      };
      return {
        ok: true,
        json: async () => ({ id: 48, course_id: 1, status: 'uploaded', overwritten: true, pipeline: { status: 'processing', message: '已更新原有小節。' } }),
      };
    }
    return { ok: false, json: async () => ({}) };
  });
  jest.spyOn(window, 'confirm').mockReturnValue(true);

  render(<MemoryRouter><CourseUpload /></MemoryRouter>);
  const courseInput = await screen.findByRole('combobox', { name: '課程' });
  fireEvent.focus(courseInput);
  fireEvent.click(screen.getByRole('option', { name: '資料結構｜尚未指派' }));
  fireEvent.change(screen.getByRole('textbox', { name: '小節名稱' }), { target: { value: '新小節名稱' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'YouTube 連結' }), { target: { value: 'https://youtu.be/BUTSrY9K01c' } });
  fireEvent.click(screen.getByRole('button', { name: '建立並自動生成' }));

  await waitFor(() => expect(lectureRequests).toBe(2));
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('要覆蓋原有小節嗎？'));
  const lectureCalls = global.fetch.mock.calls.filter(([url]) => url.endsWith('/lectures'));
  expect(JSON.parse(lectureCalls[1][1].body).overwrite_existing).toBe(true);
  expect(await screen.findByRole('heading', { name: '原有小節已覆蓋' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '前往課程管理查看進度' })).toHaveAttribute(
    'href',
    '/teacher/courses?course=1'
  );
});
