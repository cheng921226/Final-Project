import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ReviewMode from './ReviewMode';

const originalFetch = global.fetch;
const courses = [
  { id: 1, title: '資料結構', teacher_name: '林老師' },
  { id: 2, course_name: '演算法', teacher_name: '王老師' },
];

function renderReview(mockFetch) {
  localStorage.setItem('access_token', 'student-token');
  global.fetch = jest.fn(mockFetch);
  return render(<MemoryRouter><ReviewMode /></MemoryRouter>);
}

function response(data) {
  return { ok: true, json: async () => data };
}

afterEach(() => {
  global.fetch = originalFetch;
  localStorage.removeItem('access_token');
});

test('waits for a course card selection and can return to the course cards', async () => {
  renderReview(async url => {
    if (url.endsWith('/courses')) return response(courses);
    if (url.endsWith('/name')) return response({});
    return response({ stats: { question_count: 10 }, assessment: {
      mastery_rate: 0.6, mastered_questions: 6, mastery_question_count: 10,
    } });
  });

  const secondCourse = await screen.findByRole('button', { name: '演算法' });
  expect(screen.getByText('王老師')).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringMatching(/\/courses$/),
    expect.objectContaining({ headers: { Authorization: 'Bearer student-token' } }),
  );
  expect(global.fetch.mock.calls.some(([url]) => url.endsWith('/review'))).toBe(false);

  fireEvent.click(secondCourse);
  expect(await screen.findByRole('heading', { name: '演算法' })).toBeInTheDocument();
  expect(screen.getByText('6／10 題已掌握')).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringMatching(/\/courses\/2\/review$/),
    expect.any(Object),
  );

  fireEvent.click(screen.getByRole('button', { name: '更換課程' }));
  expect(screen.getByRole('heading', { name: '選擇課程' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '資料結構' })).toBeInTheDocument();
  expect(screen.queryByText('6／10 題已掌握')).not.toBeInTheDocument();
});

test('ignores a late review response after switching courses', async () => {
  let finishFirstReview;
  renderReview(async url => {
    if (url.endsWith('/courses')) return response(courses);
    if (url.endsWith('/name')) return response({});
    if (url.endsWith('/courses/1/review')) {
      return new Promise(resolve => { finishFirstReview = resolve; });
    }
    return response({ stats: { question_count: 10 } });
  });

  fireEvent.click(await screen.findByRole('button', { name: '資料結構' }));
  fireEvent.click(screen.getByRole('button', { name: '更換課程' }));
  fireEvent.click(screen.getByRole('button', { name: '演算法' }));
  expect(await screen.findByText(/10 題可練習/)).toBeInTheDocument();

  await act(async () => {
    finishFirstReview(response({ stats: { question_count: 99 } }));
  });
  expect(screen.getByText(/10 題可練習/)).toBeInTheDocument();
  expect(screen.queryByText(/99 題可練習/)).not.toBeInTheDocument();
});

test('updates mastery after practice and keeps the answer feedback visible', async () => {
  let completed = false;
  let refreshFailed = false;
  const wrongQuestion = {
    question_id: 7, question_text: '堆疊先取出哪一筆？',
    selected_answer: 'B', correct_answer: 'A', lecture_id: 4,
  };
  renderReview(async (url, options) => {
    if (url.endsWith('/courses')) return response(courses);
    if (url.endsWith('/name')) return response({});
    if (url.endsWith('/retest/start')) {
      return response({
        session: { id: 6 },
        questions: [{ ...wrongQuestion, options_json: ['最後放入', '最先放入'] }],
      });
    }
    if (url.endsWith('/submit')) {
      expect(JSON.parse(options.body)).toEqual({ answers: [{ question_id: 7, selected_answer: 'A' }] });
      completed = true;
      return response({ retest_accuracy: 1, results: [{
        question_id: 7, selected_answer: 'A', correct_answer: 'A', is_correct: true,
        explanation: '堆疊採後進先出。',
      }] });
    }
    if (completed && !refreshFailed) {
      refreshFailed = true;
      return { ok: false, status: 503, json: async () => ({ detail: '暫時無法讀取進度' }) };
    }
    return response({
      assessment: {
        mastery_rate: completed ? 0.8 : 0.7, mastery_question_count: 10,
        mastered_questions: completed ? 8 : 7, pass_threshold: 0.7, passed: true,
        needs_retest: !completed,
      },
      next_lecture_id: 4,
      wrong_questions: [{ ...wrongQuestion, retest_status: completed ? 'mastered' : 'not_retested' }],
    });
  });

  fireEvent.click(await screen.findByRole('button', { name: '資料結構' }));
  expect(await screen.findByRole('link', { name: '回課堂練習' })).toHaveAttribute(
    'href', '/course/1/lecture/4#classroom-practice-title',
  );
  fireEvent.click(screen.getByRole('button', { name: '開始補充練習' }));
  const option = await screen.findByRole('radio', { name: 'A. 最後放入' });
  const submit = screen.getByRole('button', { name: '送出補充練習' });
  expect(submit).toBeDisabled();
  fireEvent.click(option);
  fireEvent.click(submit);

  const retry = await screen.findByRole('button', { name: '重新讀取複習進度' });
  expect(screen.getByText('堆疊採後進先出。')).toBeInTheDocument();
  fireEvent.click(retry);
  expect(await screen.findByText('8／10 題已掌握')).toBeInTheDocument();
  expect(screen.getByText('堆疊採後進先出。')).toBeInTheDocument();
  expect(screen.getByText('練習前掌握率 70% → 送出後 80%')).toBeInTheDocument();
  expect(screen.getByText('目前沒有待訂正的錯題。')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: '顯示錯題' }), { target: { value: 'all' } });
  expect(screen.getByText('補練後已掌握')).toBeInTheDocument();
});
