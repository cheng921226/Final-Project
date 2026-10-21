import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TeacherFinalAssessment from './TeacherFinalAssessment';

jest.mock('react-router-dom', () => ({ Link: 'a' }), { virtual: true });

test('keeps a disabled question visible and re-enables it from the same action position', async () => {
  localStorage.setItem('access_token', 'teacher-token');
  const originalFetch = global.fetch;
  let active = false;
  let deleted = false;
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  global.fetch = jest.fn().mockImplementation(async (url, options = {}) => {
    if (String(url).endsWith('/teacher/final-assessments')) {
      return {
        ok: true,
        json: async () => ({ courses: [{ id: 1, title: '演算法' }] }),
      };
    }
    if (String(url).includes('/teacher/final-assessment/questions/8')) {
      if (options.method === 'PATCH') active = Boolean(JSON.parse(options.body).is_active);
      if (options.method === 'DELETE') deleted = true;
      return { ok: true, json: async () => ({ id: 8, is_active: active, is_deleted: deleted }) };
    }
    if (String(url).includes('/teacher/courses/1/final-assessment')) {
      return {
        ok: true,
        json: async () => ({
          course: { id: 1, passing_score: 70, final_question_count: 10 },
          has_final_assessment: true,
          current_version: 1,
          selected_version: 1,
          is_current_version: true,
          question_count: deleted ? 1 : 2,
          active_question_count: deleted ? 1 : active ? 2 : 1,
          versions: [{ bank_version: 1, question_count: deleted ? 1 : 2 }],
          knowledge_points: [],
          questions: [
            {
              id: 8,
              question_text: '停用的測試題目',
              options_json: ['A. 一', 'B. 二'],
              answer: 'A',
              explanation: '解析',
              source_type: 'ai',
              is_active: active,
            },
            {
              id: 9,
              question_text: '啟用中的題目',
              options_json: ['A. 一', 'B. 二'],
              answer: 'B',
              explanation: '解析',
              source_type: 'manual',
              is_active: true,
            },
          ].filter(question => question.id !== 8 || !deleted),
        }),
      };
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  try {
    render(<TeacherFinalAssessment />);
    const openButton = await screen.findByRole('button', { name: '開啟' });
    expect([...document.querySelectorAll('.final-question-content h4')].map(item => item.textContent)).toEqual([
      '啟用中的題目',
      '停用的測試題目',
    ]);
    const disabledArticle = screen.getByText('停用的測試題目').closest('article');
    expect(disabledArticle).toHaveClass('is-disabled');
    fireEvent.click(within(disabledArticle).getByRole('button', { name: '修改' }));
    expect(within(disabledArticle).getByRole('heading', { name: '修改正式測驗題目' })).toBeInTheDocument();
    expect(disabledArticle.querySelector('.final-question-editor.inline')).toBeInTheDocument();
    fireEvent.click(within(disabledArticle).getByRole('button', { name: '取消' }));
    expect(disabledArticle.querySelector('.final-question-editor')).not.toBeInTheDocument();
    fireEvent.click(openButton);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/teacher/final-assessment/questions/8',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ is_active: true }),
      })
    ));
    expect(await screen.findByText('題目已重新開啟。')).toBeInTheDocument();
    expect((await screen.findAllByRole('button', { name: '停用' })).length).toBe(2);
    expect(screen.getByText('停用的測試題目').closest('article')).not.toHaveClass('is-disabled');
    const reopenedArticle = screen.getByText('停用的測試題目').closest('article');
    fireEvent.click(within(reopenedArticle).getByRole('button', { name: '刪除' }));
    expect(await screen.findByText('題目已刪除，既有作答與歷史成績仍然保留。')).toBeInTheDocument();
    expect(screen.queryByText('停用的測試題目')).not.toBeInTheDocument();
    expect(screen.getByText('啟用中的題目')).toBeInTheDocument();
  } finally {
    confirmSpy.mockRestore();
    global.fetch = originalFetch;
    localStorage.removeItem('access_token');
  }
});

test('shows a clear read-only state when the viewer cannot manage the course', async () => {
  localStorage.setItem('access_token', 'campus-token');
  const originalFetch = global.fetch;
  global.fetch = jest.fn().mockImplementation(async url => {
    if (String(url).endsWith('/teacher/final-assessments')) {
      return { ok: true, json: async () => ({ courses: [{ id: 2, title: '老師的課程', can_manage: false }] }) };
    }
    return {
      ok: true,
      json: async () => ({
        course: { id: 2, passing_score: 70, final_question_count: 10 },
        can_manage: false,
        has_final_assessment: true,
        current_version: 1,
        selected_version: 1,
        is_current_version: true,
        question_count: 1,
        active_question_count: 1,
        versions: [{ bank_version: 1, question_count: 1 }],
        knowledge_points: [],
        questions: [{
          id: 20,
          question_text: '只能查看的題目',
          options_json: ['A. 一', 'B. 二'],
          answer: 'A',
          source_type: 'ai',
          is_active: true,
        }],
      }),
    };
  });

  try {
    render(<TeacherFinalAssessment />);
    expect(await screen.findByText('沒有權限修改這門課，僅能查看最終測驗內容。')).toBeInTheDocument();
    expect(screen.getByText('沒有權限')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AI 生成最終測驗' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '＋新增題目' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '停用' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '刪除' })).not.toBeInTheDocument();
  } finally {
    global.fetch = originalFetch;
    localStorage.removeItem('access_token');
  }
});
