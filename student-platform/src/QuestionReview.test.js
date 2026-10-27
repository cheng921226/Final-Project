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
  window.history.replaceState({}, '', '/');
  jest.restoreAllMocks();
});

test('opens the course and lecture provided by the course-management link', async () => {
  localStorage.setItem('access_token', 'teacher-token');
  window.history.replaceState({}, '', '/teacher/questions?lecture=21');
  global.fetch = jest.fn().mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      ...reviewData,
      courses: [
        reviewData.courses[0],
        {
          id: 20,
          title: '演算法',
          lectures: [{
            id: 21,
            title: '排序演算法',
            knowledge_points: [],
            questions: [{
              ...reviewData.courses[0].lectures[0].questions[0],
              id: 22,
              lecture_id: 21,
              question_text: '快速排序的核心操作是什麼？',
            }],
          }],
        },
      ],
    }),
  });

  render(<QuestionReview />);

  expect(await screen.findByText('快速排序的核心操作是什麼？')).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: '課程' })).toHaveValue('演算法');
  expect(screen.getByRole('combobox', { name: '小節' })).toHaveValue('21');
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

test('uses the selected knowledge point end time when it is available', async () => {
  localStorage.setItem('access_token', 'teacher-token');
  global.fetch = jest.fn().mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      ...reviewData,
      courses: [{
        ...reviewData.courses[0],
        lectures: [{
          ...reviewData.courses[0].lectures[0],
          knowledge_points: [
            {
              id: 11,
              lecture_id: 7,
              title: '堆疊操作',
              start_time: 30,
              end_time: 80,
            },
            {
              id: 12,
              lecture_id: 7,
              title: '佇列操作',
              start_time: 100,
              end_time: 150,
            },
          ],
        }],
      }],
    }),
  });

  render(<QuestionReview />);
  await screen.findByText('堆疊使用哪一種順序？');
  fireEvent.click(screen.getByRole('button', { name: '新增題目' }));
  fireEvent.change(screen.getByLabelText('對應知識點'), { target: { value: '11' } });

  expect(screen.getByLabelText('出現秒數 source_timestamp')).toHaveValue(80);
});

test('uses one second before the next knowledge point when the selected point has no end time', async () => {
  localStorage.setItem('access_token', 'teacher-token');
  global.fetch = jest.fn().mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      ...reviewData,
      courses: [{
        ...reviewData.courses[0],
        lectures: [{
          ...reviewData.courses[0].lectures[0],
          knowledge_points: [
            { id: 11, lecture_id: 7, title: '堆疊操作', start_time: 30, end_time: null },
            { id: 12, lecture_id: 7, title: '佇列操作', start_time: 100, end_time: 150 },
          ],
        }],
      }],
    }),
  });

  render(<QuestionReview />);
  await screen.findByText('堆疊使用哪一種順序？');
  fireEvent.click(screen.getByRole('button', { name: '新增題目' }));
  fireEvent.change(screen.getByLabelText('對應知識點'), { target: { value: '11' } });

  expect(screen.getByLabelText('出現秒數 source_timestamp')).toHaveValue(99);
});

test('places a new question five seconds before the video ends for the last open-ended knowledge point', async () => {
  localStorage.setItem('access_token', 'teacher-token');
  global.fetch = jest.fn().mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      ...reviewData,
      courses: [{
        ...reviewData.courses[0],
        lectures: [{
          ...reviewData.courses[0].lectures[0],
          duration_seconds: 120,
          knowledge_points: [
            { id: 11, lecture_id: 7, title: '基礎概念', start_time: 0, end_time: 60 },
            { id: 12, lecture_id: 7, title: '最後總結', start_time: 60, end_time: null },
          ],
        }],
      }],
    }),
  });

  render(<QuestionReview />);
  await screen.findByText('堆疊使用哪一種順序？');
  fireEvent.click(screen.getByRole('button', { name: '新增題目' }));
  fireEvent.change(screen.getByLabelText('對應知識點'), { target: { value: '12' } });

  expect(screen.getByLabelText('出現秒數 source_timestamp')).toHaveValue(115);
});

test('continues option letters on Enter and removes an empty prefix on Backspace', async () => {
  localStorage.setItem('access_token', 'teacher-token');
  global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => reviewData });

  render(<QuestionReview />);
  await screen.findByText('堆疊使用哪一種順序？');
  fireEvent.click(screen.getByRole('button', { name: '修改' }));

  const options = screen.getByLabelText('選項，每行一個');
  const firstLineEnd = options.value.indexOf('\n');
  options.setSelectionRange(firstLineEnd, firstLineEnd);
  fireEvent.keyDown(options, { key: 'Enter' });

  expect(options).toHaveValue('A. FIFO\nB. \nC. LIFO');

  const emptyPrefixEnd = 'A. FIFO\nB. '.length;
  options.setSelectionRange(emptyPrefixEnd, emptyPrefixEnd);
  fireEvent.keyDown(options, { key: 'Backspace' });

  expect(options).toHaveValue('A. FIFO\n\nC. LIFO');

  fireEvent.change(options, { target: { value: 'A. FIFO\nC. LIFO' } });
  expect(options).toHaveValue('A. FIFO\nB. LIFO');
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
  expect(screen.getByRole('button', { name: '待審核 1' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '未發布 1' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '已發布 1' })).toBeInTheDocument();
});

test('unpublishes a published question and updates the review list', async () => {
  localStorage.setItem('access_token', 'teacher-token');
  const publishedQuestion = {
    ...reviewData.courses[0].lectures[0].questions[0],
    review_status: 'published',
  };
  global.fetch = jest.fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...reviewData,
        courses: [{
          ...reviewData.courses[0],
          lectures: [{
            ...reviewData.courses[0].lectures[0],
            questions: [publishedQuestion],
          }],
        }],
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: 'unpublished', question_id: 5 }),
    });
  jest.spyOn(window, 'confirm').mockReturnValue(true);

  render(<QuestionReview />);

  fireEvent.click(await screen.findByRole('button', { name: '取消發布' }));

  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('學生將不會看到這題'));
  expect(global.fetch).toHaveBeenLastCalledWith(
    'http://127.0.0.1:8000/teacher/questions/5/unpublish',
    expect.objectContaining({ method: 'POST' })
  );
  expect(await screen.findByText('題目已設為未發布，仍保留在題目列表。')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '未發布 1' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '已發布 0' })).toBeInTheDocument();
});

test('shows a clear inline message when unpublishing is forbidden', async () => {
  localStorage.setItem('access_token', 'campus-token');
  const publishedQuestion = {
    ...reviewData.courses[0].lectures[0].questions[0],
    review_status: 'published',
  };
  global.fetch = jest.fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...reviewData,
        courses: [{
          ...reviewData.courses[0],
          lectures: [{
            ...reviewData.courses[0].lectures[0],
            questions: [publishedQuestion],
          }],
        }],
      }),
    })
    .mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ detail: '沒有權限管理這門課的題目' }),
    });
  jest.spyOn(window, 'confirm').mockReturnValue(true);

  render(<QuestionReview />);

  fireEvent.click(await screen.findByRole('button', { name: '取消發布' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    '你沒有權限變更這門課的題目。請由課程建立者或授課教師操作。'
  );
  expect(screen.getByRole('button', { name: '已發布 1' })).toBeInTheDocument();
});
