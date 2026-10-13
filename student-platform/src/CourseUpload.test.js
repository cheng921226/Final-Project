import { fireEvent, render, screen } from '@testing-library/react';
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
  expect(searchInput).toHaveValue('');

  fireEvent.change(searchInput, { target: { value: '資料' } });
  const result = screen.getByRole('option', { name: '資料結構｜尚未指派' });
  fireEvent.click(result);
  expect(searchInput).toHaveValue('資料結構');
});
