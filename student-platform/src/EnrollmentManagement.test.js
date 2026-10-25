import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EnrollmentManagement from './EnrollmentManagement';

const originalFetch = global.fetch;
const enrollmentData = {
  courses: [{ id: 10, title: '資料結構', teacher_name: '王老師', status: 'published' }],
  classes: [{ id: 1, name: '資訊一甲' }, { id: 2, name: '資訊二乙' }],
  course_id: 10,
  students: [
    { id: 1, name: '陳同學', email: 's1@example.com', student_number: 'S001', class_id: 1, class_name: '資訊一甲', enrolled: true, enrolled_at: '2026-10-25T01:00:00Z' },
    { id: 2, name: '林同學', email: 's2@example.com', student_number: 'S002', class_id: 2, class_name: '資訊二乙', enrolled: false, enrolled_at: null },
  ],
};

afterEach(() => {
  localStorage.clear();
  global.fetch = originalFetch;
  window.history.replaceState({}, '', '/');
  jest.restoreAllMocks();
});

test('filters the roster by class and enrollment status', async () => {
  localStorage.setItem('access_token', 'campus-token');
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => enrollmentData });

  render(<EnrollmentManagement />);

  expect(await screen.findByRole('heading', { name: '選課管理' })).toBeInTheDocument();
  expect(screen.getByText('陳同學')).toBeInTheDocument();
  expect(screen.getByText('林同學')).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('班級篩選'), { target: { value: '2' } });
  expect(screen.queryByText('陳同學')).not.toBeInTheDocument();
  expect(screen.getByText('林同學')).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('選課狀態篩選'), { target: { value: 'enrolled' } });
  expect(screen.queryByText('林同學')).not.toBeInTheDocument();
});

test('adds selected students to the current course', async () => {
  localStorage.setItem('access_token', 'campus-token');
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => enrollmentData })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ message: '已加入 1 位學生', count: 1 }) })
    .mockResolvedValueOnce({ ok: true, json: async () => enrollmentData });

  render(<EnrollmentManagement />);
  fireEvent.click(await screen.findByLabelText('選取 林同學'));
  fireEvent.click(screen.getByRole('button', { name: '加入課程' }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    'http://127.0.0.1:8000/campus/enrollments/10',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ student_ids: [2] }),
    })
  ));
});
