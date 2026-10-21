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
    const allCheckbox = await screen.findByRole('checkbox', { name: '全選篩選結果' });
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

test('filters students by class, credit status, learning status, and keyword', async () => {
  const TeacherDashboard = require('./TeacherDashboard').default;
  localStorage.setItem('access_token', 'test-token');
  const originalFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      teacher: { role: 'teacher' },
      courses: [{
        id: 1,
        title: '測試課程',
        summary: { students: 3, active_students: 2, lectures: 2, completion_rate: 50, watched_hours: 2, question_accuracy: 70 },
        lectures: [],
        questions: [],
        students: [
          { id: 1, student_number: 'S001', name: '王小明', email: 'ming@example.com', classes: [{ id: 10, name: '資訊三甲' }], completed_lectures: 2, total_lectures: 2, watched_minutes: 40, attempts: 3, accuracy: 90, last_active: '2024-01-01T00:00:00Z', course_passed: true, credits_earned: 2 },
          { id: 2, student_number: 'S002', name: '陳小華', email: 'hua@example.com', classes: [{ id: 11, name: '資訊三乙' }], completed_lectures: 1, total_lectures: 2, watched_minutes: 20, attempts: 2, accuracy: 50, last_active: '2024-01-02T00:00:00Z', course_passed: false, credits_earned: 0 },
          { id: 3, student_number: 'S003', name: '林小美', email: 'mei@example.com', classes: [{ id: 10, name: '資訊三甲' }], completed_lectures: 0, total_lectures: 2, watched_minutes: 0, attempts: 0, accuracy: 0, last_active: null, course_passed: false, credits_earned: 0 },
        ],
      }],
    }),
  });

  try {
    render(<TeacherDashboard />);
    await screen.findByText('王小明');

    fireEvent.change(screen.getByLabelText('班級'), { target: { value: '10' } });
    expect(screen.getByText('王小明')).toBeInTheDocument();
    expect(screen.getByText('林小美')).toBeInTheDocument();
    expect(screen.queryByText('陳小華')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('學分'), { target: { value: 'not_earned' } });
    expect(screen.queryByText('王小明')).not.toBeInTheDocument();
    expect(screen.getByText('林小美')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('學習狀態'), { target: { value: 'not_started' } });
    expect(screen.getByText('林小美')).toBeInTheDocument();
    expect(screen.getByText('顯示 1 / 3 人')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('搜尋學生'), { target: { value: 'S999' } });
    expect(screen.getByText('沒有符合目前篩選條件的學生')).toBeInTheDocument();
  } finally {
    global.fetch = originalFetch;
    localStorage.removeItem('access_token');
  }
});

test('sorts the student roster independently by each column', async () => {
  const TeacherDashboard = require('./TeacherDashboard').default;
  localStorage.setItem('access_token', 'test-token');
  const originalFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      teacher: { role: 'teacher' },
      courses: [{
        id: 1,
        title: '測試課程',
        summary: { students: 3, active_students: 3, lectures: 2, completion_rate: 50, watched_hours: 2, question_accuracy: 70 },
        lectures: [],
        questions: [],
        students: [
          { id: 1, student_number: 'S003', name: '王同學', email: 'wang@example.com', classes: [{ id: 10, name: '資訊三甲' }], completed_lectures: 2, total_lectures: 2, watched_minutes: 40, attempts: 3, accuracy: 90, last_active: '2024-01-03T00:00:00Z', course_passed: true, credits_earned: 2 },
          { id: 2, student_number: 'S001', name: '陳同學', email: 'chen@example.com', classes: [{ id: 11, name: '資訊三乙' }], completed_lectures: 1, total_lectures: 2, watched_minutes: 20, attempts: 2, accuracy: 50, last_active: '2024-01-02T00:00:00Z', course_passed: false, credits_earned: 0 },
          { id: 3, student_number: 'S002', name: '林同學', email: 'lin@example.com', classes: [], completed_lectures: 0, total_lectures: 2, watched_minutes: 0, attempts: 0, accuracy: 0, last_active: null, course_passed: false, credits_earned: 0 },
        ],
      }],
    }),
  });

  const selectedOrder = () => screen.getAllByRole('checkbox')
    .slice(1)
    .map(checkbox => checkbox.getAttribute('aria-label'));

  try {
    render(<TeacherDashboard />);
    await screen.findByText('王同學');

    expect(selectedOrder()).toEqual(['選擇 陳同學', '選擇 林同學', '選擇 王同學']);
    fireEvent.click(screen.getByRole('button', { name: '觀看時間' }));
    expect(selectedOrder()).toEqual(['選擇 林同學', '選擇 陳同學', '選擇 王同學']);
    fireEvent.click(screen.getByRole('button', { name: '觀看時間' }));
    expect(selectedOrder()).toEqual(['選擇 王同學', '選擇 陳同學', '選擇 林同學']);
    expect(screen.getByRole('columnheader', { name: '觀看時間' })).toHaveAttribute('aria-sort', 'descending');
  } finally {
    global.fetch = originalFetch;
    localStorage.removeItem('access_token');
  }
});

test('shows evidence-based teaching recommendations and opens the related scope', async () => {
  const TeacherDashboard = require('./TeacherDashboard').default;
  localStorage.setItem('access_token', 'test-token');
  const originalFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      teacher: { role: 'teacher' },
      courses: [{
        id: 1,
        title: '演算法',
        summary: { students: 10, active_students: 10, lectures: 1, completion_rate: 35, watched_hours: 2, question_accuracy: 45 },
        students: [],
        questions: [],
        lectures: [{ id: 7, title: '遞迴', completion_rate: 35, watched_minutes: 30, accuracy: 45, attempts: 20, students_started: 10, pause_count: 8, seek_count: 6, pause_hotspots: [], seek_hotspots: [], students: [] }],
        recommendations: [{
          id: 'bottleneck-7-120',
          category: 'comprehension',
          priority: 'high',
          title: '遞迴可能有理解瓶頸',
          evidence: '2:00–2:30累積 14 次暫停／跳轉，小節答題正確率為 45%。',
          action: '補充終止條件的圖例。',
          lecture_id: 7,
          timestamp: 120,
        }],
      }],
    }),
  });

  try {
    render(<TeacherDashboard />);
    expect(await screen.findByText('遞迴可能有理解瓶頸')).toBeInTheDocument();
    expect(screen.getByText(/累積 14 次/)).toBeInTheDocument();
    expect(screen.getByText('2:00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看小節分析' }));
    expect(screen.getByRole('combobox', { name: '分析範圍' })).toHaveValue('7');
    fireEvent.change(
      screen.getByRole('combobox', { name: '延後重新計算 遞迴可能有理解瓶頸' }),
      { target: { value: '7' } }
    );
    fireEvent.click(screen.getByRole('button', { name: '套用' }));
    await waitFor(() => expect(global.fetch).toHaveBeenLastCalledWith(
      'http://127.0.0.1:8000/teacher/analytics/courses/1/recommendations/snooze',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ recommendation_id: 'bottleneck-7-120', days: 7 }),
      })
    ));
    expect(await screen.findByText('已暫停這項建議，7 天後會依最新資料重新計算。')).toBeInTheDocument();
    expect(screen.queryByText('遞迴可能有理解瓶頸')).not.toBeInTheDocument();
  } finally {
    global.fetch = originalFetch;
    localStorage.removeItem('access_token');
  }
});

test('switches the student table to the selected lecture metrics', async () => {
  const TeacherDashboard = require('./TeacherDashboard').default;
  localStorage.setItem('access_token', 'test-token');
  const originalFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      teacher: { role: 'teacher' },
      courses: [{
        id: 1,
        title: '測試課程',
        summary: { students: 1, active_students: 1, lectures: 1, completion_rate: 100, watched_hours: 1, question_accuracy: 80 },
        students: [{ id: 1, name: '課程資料', email: 'student@example.com', completed_lectures: 3, total_lectures: 3, watched_minutes: 60, accuracy: 80 }],
        questions: [],
        lectures: [{
          id: 11,
          title: '第一小節',
          completion_rate: 0,
          watched_minutes: 2,
          accuracy: 50,
          attempts: 2,
          students_started: 1,
          pause_count: 0,
          seek_count: 0,
          pause_hotspots: [],
          seek_hotspots: [],
          students: [{ id: 1, name: '小節資料', email: 'student@example.com', completed_lectures: 0, total_lectures: 1, watched_minutes: 2, accuracy: 50 }],
        }],
      }],
    }),
  });

  try {
    render(<TeacherDashboard />);
    await screen.findByText('課程資料');
    const scopeSelect = screen.getByRole('combobox', { name: '分析範圍' });
    fireEvent.change(scopeSelect, { target: { value: '11' } });
    expect(screen.queryByText('課程資料')).not.toBeInTheDocument();
    expect(screen.getByText('小節資料')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '正確率' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '小節完成' })).toBeInTheDocument();
  } finally {
    global.fetch = originalFetch;
    localStorage.removeItem('access_token');
  }
});

test('shows unanswered questions without treating them as errors', async () => {
  const TeacherDashboard = require('./TeacherDashboard').default;
  localStorage.setItem('access_token', 'test-token');
  const originalFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      teacher: { role: 'teacher' },
      courses: [{
        id: 1,
        title: '測試課程',
        summary: { students: 0, active_students: 0, lectures: 0 },
        lectures: [],
        students: [],
        questions: [{ id: 1, text: '尚未作答題目', accuracy: 0, attempts: 0, has_attempts: false }],
      }],
    }),
  });

  try {
    render(<TeacherDashboard />);
    const toggle = await screen.findByRole('button', { name: '顯示所有題目錯誤率（1 題）' });
    expect(screen.queryByText('尚未作答題目')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText('尚未作答題目')).toBeInTheDocument();
    expect(screen.getByText('尚無作答')).toBeInTheDocument();
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
  } finally {
    global.fetch = originalFetch;
    localStorage.removeItem('access_token');
  }
});
