import { fireEvent, render, screen } from '@testing-library/react';
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

test('warns before leaving or switching courses with unsaved changes', async () => {
  localStorage.setItem('access_token', 'teacher-token');
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      actor: { id: 10, role: 'teacher' },
      courses: [
        baseCourse,
        { ...baseCourse, id: 2, title: '演算法' },
      ],
      teachers: [],
    }),
  });
  jest.spyOn(window, 'confirm').mockReturnValue(false);

  render(<CourseManagement />);
  const titleInput = await screen.findByRole('textbox', { name: '課程名稱' });
  fireEvent.change(titleInput, { target: { value: '尚未儲存的新名稱' } });

  const unloadEvent = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unloadEvent);
  expect(unloadEvent.defaultPrevented).toBe(true);

  const courseSelect = screen.getByRole('combobox', { name: '課程' });
  fireEvent.change(courseSelect, { target: { value: '2' } });
  expect(window.confirm).toHaveBeenCalledWith('你有尚未儲存的變更，確定要離開嗎？');
  expect(courseSelect).toHaveValue('1');
  expect(titleInput).toHaveValue('尚未儲存的新名稱');
});

test('asks before replacing an existing video backup', async () => {
  localStorage.setItem('access_token', 'teacher-token');
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      actor: { id: 10, role: 'teacher' },
      courses: [{
        ...baseCourse,
        lectures: [{
          id: 48,
          title: '搜尋演算法',
          media_url: 'https://www.youtube.com/watch?v=BUTSrY9K01c',
          backup_status: 'completed',
          content_status: { generation_status: {} },
        }],
      }],
      teachers: [],
    }),
  });
  jest.spyOn(window, 'confirm').mockReturnValue(false);

  render(<CourseManagement />);
  fireEvent.click(await screen.findByRole('button', { name: '重新備份' }));

  expect(window.confirm).toHaveBeenCalledWith(
    '這個小節已經有影片備份。確定要重新備份並覆蓋現有版本嗎？'
  );
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
