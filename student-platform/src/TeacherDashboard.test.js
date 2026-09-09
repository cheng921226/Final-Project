import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HotspotTimeline } from './TeacherDashboard';

jest.mock('react-router-dom', () => ({ Link: 'a' }), { virtual: true });

test('places ranked hotspots chronologically on a shared time scale and exposes details', () => {
  render(<HotspotTimeline title="暫停熱點" type="pause" timelineEnd={300} items={[
    { start: 120, end: 150, count: 8, knowledge_points: ['迴圈'] },
    { start: 30, end: 60, count: 2, knowledge_points: ['變數'] },
  ]} />);
  const buttons = screen.getAllByRole('button');
  expect(buttons[0]).toHaveStyle({ left: '10%', width: '10%' });
  expect(buttons[1]).toHaveStyle({ left: '40%', width: '10%' });
  expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(buttons[1]);
  expect(buttons[1]).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('迴圈')).toBeInTheDocument();
  expect(screen.getByText('8 次')).toBeInTheDocument();
  expect(screen.getByText('5:00')).toBeInTheDocument();
});

test('shows an empty state when there are no hotspots', () => {
  render(<HotspotTimeline title="跳轉熱點" type="seek" items={[]} />);
  expect(screen.getByText('目前還沒有足夠的事件資料')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('hides zero-error questions by default and toggles all questions', async () => {
  const TeacherDashboard = require('./TeacherDashboard').default;
  localStorage.setItem('access_token', 'test-token');
  const originalFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true, json: async () => ({
      courses: [{
        id: 1, title: '測試課程', summary: { students: 0, active_students: 0, lectures: 0 },
        lectures: [], students: [], questions: Array.from({ length: 7 }, (_, i) => ({
          id: i, text: `測試題目${i}`, accuracy: i === 6 ? 100 : i * 10, attempts: 10,
        })),
      }]
    })
  });
  try {
    render(<TeacherDashboard />);
    const toggle = await screen.findByRole('button', { name: '顯示所有題目錯誤率（7 題）' });
    expect(screen.queryByText('測試題目5')).not.toBeInTheDocument();
    expect(screen.queryByText('測試題目6')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText('測試題目5')).toBeInTheDocument();
    expect(screen.getByText('測試題目6')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '收合，僅顯示需關注題目' }));
    expect(screen.queryByText('測試題目6')).not.toBeInTheDocument();
  } finally {
    global.fetch = originalFetch;
    localStorage.removeItem('access_token');
  }
});

test('selects students and sends the chosen recipients to the email API', async () => {
  const TeacherDashboard = require('./TeacherDashboard').default;
  localStorage.setItem('access_token', 'test-token');
  const originalFetch = global.fetch;
  const fetchMock = jest.fn().mockImplementation(async (url) => {
    if (String(url).includes('/teacher/analytics')) {
      return {
        ok: true,
        json: async () => ({
          courses: [{
            id: 1, title: '測試課程', summary: { students: 2, active_students: 2, lectures: 1 },
            lectures: [], students: [
              { id: 1, name: 'Alice', email: 'alice@example.com', completed_lectures: 1, total_lectures: 1, watched_minutes: 20, accuracy: 88, last_active: '2024-01-01T00:00:00Z' },
              { id: 2, name: 'Bob', email: 'bob@example.com', completed_lectures: 1, total_lectures: 1, watched_minutes: 30, accuracy: 66, last_active: '2024-01-02T00:00:00Z' },
            ],
            questions: [],
          }]
        }),
      };
    }

    return {
      ok: true,
      json: async () => ({ message: 'email sent', recipients: ['alice@example.com', 'bob@example.com'] }),
    };
  });
  global.fetch = fetchMock;
  const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => { });

  try {
    render(<TeacherDashboard />);
    const allCheckbox = await screen.findByRole('checkbox', { name: '全選學生' });
    expect(allCheckbox).not.toBeChecked();
    fireEvent.click(allCheckbox);
    expect(screen.getByRole('checkbox', { name: '選擇 Alice' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '選擇 Bob' })).toBeChecked();

    const mailButton = screen.getByRole('button', { name: /寄信給選取學生/i });
    expect(mailButton).toBeEnabled();
    fireEvent.click(mailButton);

    expect(screen.getByText('寄信預覽')).toBeInTheDocument();
    expect(screen.getByText(/學習提醒/i)).toBeInTheDocument();
    expect(screen.getByLabelText('信件內容')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /確認寄送/i }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([, options]) => options && options.method === 'POST');
      expect(postCall).toBeTruthy();
      const requestBody = JSON.parse(postCall[1].body);
      expect(requestBody.to).toEqual(['alice@example.com', 'bob@example.com']);
      expect(requestBody.subject).toContain('學習提醒');
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/email/send',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        }),
      })
    );
  } finally {
    global.fetch = originalFetch;
    alertSpy.mockRestore();
    localStorage.removeItem('access_token');
  }
});
