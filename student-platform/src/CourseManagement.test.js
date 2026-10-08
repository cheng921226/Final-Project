import { render, screen } from '@testing-library/react';
import CourseManagement from './CourseManagement';

jest.mock('react-router-dom', () => ({ Link: ({ children, to, ...props }) => <a href={to} {...props}>{children}</a> }), { virtual: true });

const baseCourse = {
  id: 1,
  title: '資料結構',
  description: '課程介紹',
  status: 'draft',
  teacher_id: 10,
  created_by_user_id: 99,
  creator: { id: 99, name: '校園平台甲', email: 'campus@example.com' },
  assigned_teacher: { id: 10, name: '王老師', email: 'teacher@example.com' },
  lectures: [],
};
const originalFetch = global.fetch;

afterEach(() => {
  localStorage.removeItem('access_token');
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

test('teacher manages owned courses without teacher assignment control', async () => {
  localStorage.setItem('access_token', 'teacher-token');
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      actor: { id: 10, role: 'teacher' },
      courses: [baseCourse],
      teachers: [],
    }),
  });

  render(<CourseManagement />);
  expect(await screen.findByRole('heading', { name: '我的課程管理' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: '課程名稱' })).toHaveValue('資料結構');
  expect(screen.queryByText('授課教師')).not.toBeInTheDocument();
});

test('campus sees and manages teacher courses alongside its own courses', async () => {
  localStorage.setItem('access_token', 'campus-token');
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      actor: { id: 99, role: 'campus' },
      courses: [
        baseCourse,
        {
          ...baseCourse,
          id: 2,
          title: '離散數學',
          teacher_id: 10,
          created_by_user_id: 10,
          creator: { id: 10, name: '王老師', email: 'teacher@example.com' },
        },
      ],
      teachers: [
        { id: 99, name: '校園平台甲（平台端）', email: 'campus@example.com', role: 'campus' },
        { id: 10, name: '王老師', email: 'teacher@example.com', role: 'teacher' },
      ],
    }),
  });

  render(<CourseManagement />);
  expect(await screen.findByRole('heading', { name: '平台課程管理' })).toBeInTheDocument();
  expect(screen.getByDisplayValue('校園平台甲')).toBeInTheDocument();
  expect(screen.getByText('授課教師')).toBeInTheDocument();
  expect(screen.getByRole('option', { name: '校園平台甲（平台端）' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: '王老師' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: '離散數學｜王老師' })).toBeInTheDocument();
});
