import { fireEvent, render, screen } from '@testing-library/react';
import PersonnelManagement from './PersonnelManagement';

const originalFetch = global.fetch;
const personnelData = {
  actor_id: 22,
  classes: [{ id: 1, name: '資訊三甲' }],
  personnel: [
    { id: 1, name: '王小明', email: 'student@example.com', role: 'student', student_number: 'STU001', class_id: 1, class_name: '資訊三甲', account_status: 'active', email_confirmed: true },
    { id: 10, name: '王老師', email: 'teacher@example.com', role: 'teacher', account_status: 'active' },
    { id: 22, name: '校園平台', email: 'campus@example.com', role: 'campus', account_status: 'active' },
  ],
};

afterEach(() => {
  localStorage.clear();
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

test('shows all roles and filters personnel by keyword', async () => {
  localStorage.setItem('access_token', 'campus-token');
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => personnelData });

  render(<PersonnelManagement />);

  expect(await screen.findByRole('heading', { name: '人員管理' })).toBeInTheDocument();
  expect(screen.getByText('王小明')).toBeInTheDocument();
  expect(screen.getByText('王老師')).toBeInTheDocument();
  expect(screen.getByText('校園平台')).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('搜尋人員'), { target: { value: 'STU001' } });
  expect(screen.getByText('王小明')).toBeInTheDocument();
  expect(screen.queryByText('王老師')).not.toBeInTheDocument();
});

test('opens a complete account form for a new student', async () => {
  localStorage.setItem('access_token', 'campus-token');
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => personnelData });

  render(<PersonnelManagement />);
  fireEvent.click(await screen.findByRole('button', { name: '新增人員' }));

  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '新增人員' })).toBeInTheDocument();
  expect(screen.getByLabelText(/^初始密碼/)).toHaveAttribute('minLength', '9');
  expect(screen.getByLabelText('學號')).toBeRequired();
  expect(screen.getAllByRole('option', { name: '資訊三甲' })).toHaveLength(2);

  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
