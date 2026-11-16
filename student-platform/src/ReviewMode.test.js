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
