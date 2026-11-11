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
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'student＠example.com' } });
  expect(screen.getByLabelText('Email')).toHaveValue('student@example.com');
  expect(screen.getAllByRole('option', { name: '資訊三甲' })).toHaveLength(2);

  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('shows a duplicate student number warning in the editor when saving', async () => {
  localStorage.setItem('access_token', 'campus-token');
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => personnelData })
    .mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ detail: '此學號已被其他學生使用，請輸入不同學號' }),
    });

  render(<PersonnelManagement />);
  fireEvent.click((await screen.findAllByRole('button', { name: '修改' }))[0]);
  fireEvent.click(screen.getByRole('button', { name: '儲存人員' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    '此學號已被其他學生使用，請輸入不同學號'
  );
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('imports an Excel roster and preserves text student numbers and row errors', async () => {
  const { default: ExcelJS } = await import('exceljs');
  localStorage.setItem('access_token', 'campus-token');
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => personnelData })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: '匯入完成：成功 1 人，失敗 1 人',
        succeeded: 1,
        failed: 1,
        errors: [{ row: 3, email: 'bad@example.com', error: '找不到班級' }],
      }),
    })
    .mockResolvedValueOnce({ ok: true, json: async () => personnelData });

  render(<PersonnelManagement />);
  fireEvent.click(await screen.findByRole('button', { name: '匯入名冊' }));
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('人員名冊');
  sheet.addRow(['姓名', 'Email', '初始密碼', '角色', '學號', '班級']);
  sheet.addRow(['學生一', 'stu1@example.com', '123123123', '學生', '00123', '資訊三甲']);
  sheet.addRow(['學生二', 'bad@example.com', '123123123', '學生', '00124', '不存在']);
  const file = new File([await workbook.xlsx.writeBuffer()], 'people.xlsx');
  fireEvent.change(screen.getByLabelText('選擇 Excel 檔案'), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: '開始匯入' }));

  expect(await screen.findByText('成功 1 人 · 失敗 1 人')).toBeInTheDocument();
  expect(screen.getByText('bad@example.com')).toBeInTheDocument();
  expect(screen.getByText('找不到班級')).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith(
    'http://127.0.0.1:8000/campus/personnel/import.csv',
    expect.objectContaining({ method: 'POST', body: expect.any(FormData) })
  );
  const upload = global.fetch.mock.calls.find(([url]) => url.endsWith('/import.csv'))[1].body.get('file');
  const csv = await new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsText(upload);
  });
  expect(csv).toContain('"00123"');
});

test('creates and removes an empty class from personnel management', async () => {
  localStorage.setItem('access_token', 'campus-token');
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  const updatedRoster = {
    ...personnelData,
    classes: [...personnelData.classes, { id: 2, name: '資訊一乙' }],
  };
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => personnelData })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ message: '已新增班級' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => updatedRoster })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ message: '已刪除班級' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => personnelData });

  render(<PersonnelManagement />);
  fireEvent.click(await screen.findByText('班級管理'));
  expect(screen.getByRole('button', { name: '刪除班級 資訊三甲' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('班級名稱'), { target: { value: '資訊一乙' } });
  fireEvent.click(screen.getByRole('button', { name: '新增班級' }));

  fireEvent.click(await screen.findByRole('button', { name: '刪除班級 資訊一乙' }));
  expect(await screen.findByText('已刪除班級')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '刪除班級 資訊一乙' })).not.toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith(
    'http://127.0.0.1:8000/campus/personnel/classes',
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: '資訊一乙' }) })
  );
  expect(global.fetch).toHaveBeenCalledWith(
    'http://127.0.0.1:8000/campus/personnel/classes/2',
    expect.objectContaining({ method: 'DELETE' })
  );
});
