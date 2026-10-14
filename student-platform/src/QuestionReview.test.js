import { fireEvent, render, screen } from '@testing-library/react';
import QuestionReview from './QuestionReview';

jest.mock('react-router-dom', () => ({ Link: ({ children, to }) => <a href={to}>{children}</a> }), { virtual: true });

const reviewData = {
  teacher: { id: 1, role: 'teacher' },
  courses: [{
    id: 10,
    title: '資料結構',
    lectures: [{
      id: 7,
      title: '堆疊',
      knowledge_points: [],
      questions: [{
        id: 5,
        lecture_id: 7,
        question_text: '堆疊使用哪一種順序？',
        options_json: ['A. FIFO', 'B. LIFO'],
        answer: 'B',
        explanation: '後進先出',
        source_timestamp: 30,
        review_status: 'pending',
        generation_batch_id: 'batch-1',
      }],
    }],
  }],
};

afterEach(() => {
  localStorage.removeItem('access_token');
  jest.restoreAllMocks();
});

test('shows pending AI questions and publishes the latest batch', async () => {
  localStorage.setItem('access_token', 'teacher-token');
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => reviewData })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ published_count: 1 }) })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...reviewData,
        courses: [{
          ...reviewData.courses[0],
          lectures: [{
            ...reviewData.courses[0].lectures[0],
            questions: [{ ...reviewData.courses[0].lectures[0].questions[0], review_status: 'published' }],
          }],
        }],
      }),
    });
  jest.spyOn(window, 'confirm').mockReturnValue(true);

  render(<QuestionReview />);

  expect(await screen.findByText('待審核')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '全部核准發布' }));

  expect(window.confirm).toHaveBeenCalled();
  expect(global.fetch).toHaveBeenCalledWith(
    'http://127.0.0.1:8000/teacher/lectures/7/questions/publish-pending',
    expect.objectContaining({ method: 'POST' })
  );
  expect(await screen.findByText('已發布 1 題，學生現在可以看到新版題目。')).toBeInTheDocument();
});

test('builds correct-answer choices from non-empty option lines', async () => {
  localStorage.setItem('access_token', 'teacher-token');
  global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => reviewData });

  render(<QuestionReview />);
  await screen.findByText('堆疊使用哪一種順序？');
  fireEvent.click(screen.getByRole('button', { name: '新增題目' }));

  const options = screen.getByLabelText('選項，每行一個');
  const answer = screen.getByLabelText('正確答案');
  fireEvent.change(options, { target: { value: '第一個\n第二個\n\n第三個' } });

  expect(Array.from(answer.options).map(option => option.value)).toEqual(['A', 'B', 'C']);
  fireEvent.change(answer, { target: { value: 'C' } });
  fireEvent.change(options, { target: { value: '第一個\n第二個' } });
  expect(answer.value).toBe('A');
  expect(Array.from(answer.options).map(option => option.value)).toEqual(['A', 'B']);
});

test('keeps pending, unpublished, and published questions visible', async () => {
  localStorage.setItem('access_token', 'teacher-token');
  const questions = [
    { ...reviewData.courses[0].lectures[0].questions[0], id: 1, question_text: '待審題目', review_status: 'pending' },
    { ...reviewData.courses[0].lectures[0].questions[0], id: 2, question_text: '未發布題目', review_status: 'unpublished' },
    { ...reviewData.courses[0].lectures[0].questions[0], id: 3, question_text: '已發布題目', review_status: 'published' },
  ];
  global.fetch = jest.fn().mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      ...reviewData,
      courses: [{
        ...reviewData.courses[0],
        lectures: [{ ...reviewData.courses[0].lectures[0], questions }],
      }],
    }),
  });

  render(<QuestionReview />);

  expect(await screen.findByText('待審題目')).toBeInTheDocument();
  expect(screen.getByText('未發布題目')).toBeInTheDocument();
  expect(screen.getByText('已發布題目')).toBeInTheDocument();
  expect(screen.getByText('1 題待審核 · 1 題未發布 · 1 題已發布')).toBeInTheDocument();
});
