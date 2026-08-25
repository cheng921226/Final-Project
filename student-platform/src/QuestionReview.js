import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

const API_URL = 'http://127.0.0.1:8000';

const EMPTY_FORM = {
  id: null,
  lecture_id: '',
  knowledge_point_id: '',
  question_text: '',
  options_text: 'A. \nB. \nC. \nD. ',
  answer: 'A',
  explanation: '',
  source_timestamp: '',
};

function formatTime(seconds) {
  if (seconds === null || seconds === undefined || seconds === '') return '未設定';
  const value = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  const remainder = Math.floor(value % 60);
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function optionsToText(options) {
  if (!options) return '';
  if (Array.isArray(options)) return options.join('\n');
  if (typeof options === 'object') {
    return Object.entries(options).map(([key, value]) => `${key}. ${value}`).join('\n');
  }
  try {
    const parsed = JSON.parse(options);
    return optionsToText(parsed);
  } catch {
    return String(options);
  }
}

function normalizeNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : null;
}

function toPayload(form) {
  return {
    lecture_id: Number(form.lecture_id),
    knowledge_point_id: form.knowledge_point_id ? Number(form.knowledge_point_id) : null,
    question_text: form.question_text.trim(),
    options_json: form.options_text
      .split('\n')
      .map(option => option.trim())
      .filter(Boolean),
    answer: form.answer.trim().toUpperCase().slice(0, 1),
    explanation: form.explanation.trim() || null,
    source_timestamp: normalizeNumber(form.source_timestamp),
  };
}

function questionToForm(question) {
  return {
    id: question.id,
    lecture_id: String(question.lecture_id || ''),
    knowledge_point_id: question.knowledge_point_id ? String(question.knowledge_point_id) : '',
    question_text: question.question_text || '',
    options_text: optionsToText(question.options_json),
    answer: question.answer || 'A',
    explanation: question.explanation || '',
    source_timestamp: question.source_timestamp ?? '',
  };
}

export default function QuestionReview() {
  const token = localStorage.getItem('access_token');
  const [data, setData] = useState(null);
  const [courseId, setCourseId] = useState('');
  const [lectureId, setLectureId] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const editorRef = useRef(null);
  const questionTextRef = useRef(null);

  function focusEditor() {
    setTimeout(() => {
      editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      questionTextRef.current?.focus();
    }, 0);
  }

  async function loadReviewData(preferredLectureId = lectureId) {
    if (!token) {
      setError('請先使用老師帳號登入。');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/teacher/question-review`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(res.status === 403 ? '這個帳號沒有老師權限。' : body.detail || '無法取得審題資料。');
      }
      const result = await res.json();
      setData(result);

      const firstCourse = result.courses?.[0];
      const nextCourseId = courseId && result.courses?.some(course => String(course.id) === String(courseId))
        ? courseId
        : firstCourse?.id;
      const nextCourse = result.courses?.find(course => String(course.id) === String(nextCourseId)) || firstCourse;
      const nextLectureId = preferredLectureId && nextCourse?.lectures?.some(lecture => String(lecture.id) === String(preferredLectureId))
        ? preferredLectureId
        : nextCourse?.lectures?.[0]?.id;

      setCourseId(nextCourseId ? String(nextCourseId) : '');
      setLectureId(nextLectureId ? String(nextLectureId) : '');
      setForm(prev => ({
        ...prev,
        lecture_id: nextLectureId ? String(nextLectureId) : '',
      }));
    } catch (err) {
      setError(err.message || '審題資料載入失敗');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReviewData('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const course = useMemo(
    () => data?.courses?.find(item => String(item.id) === String(courseId)),
    [data, courseId]
  );

  const lecture = useMemo(
    () => course?.lectures?.find(item => String(item.id) === String(lectureId)),
    [course, lectureId]
  );

  const questions = lecture?.questions || [];
  const knowledgePoints = lecture?.knowledge_points || [];

  function changeLecture(nextLectureId) {
    setLectureId(nextLectureId);
    setForm({ ...EMPTY_FORM, lecture_id: nextLectureId });
    setEditorOpen(false);
    setMessage('');
  }

  function startCreate() {
    setForm({ ...EMPTY_FORM, lecture_id: lectureId });
    setEditorOpen(true);
    setMessage('');
    focusEditor();
  }

  function startEdit(question) {
    setForm(questionToForm(question));
    setEditorOpen(true);
    setMessage('');
    focusEditor();
  }

  async function saveQuestion(event) {
    event.preventDefault();
    if (!form.lecture_id || saving) return;

    const payload = toPayload(form);
    if (!payload.question_text) {
      setMessage('題目內容不可空白。');
      return;
    }
    if (!payload.options_json.length) {
      setMessage('至少要有一個選項。');
      return;
    }
    if (!payload.answer) {
      setMessage('請設定正確答案。');
      return;
    }

    setSaving(true);
    setMessage('');
    try {
      const url = form.id
        ? `${API_URL}/teacher/questions/${form.id}`
        : `${API_URL}/teacher/questions`;
      const res = await fetch(url, {
        method: form.id ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || '儲存題目失敗');
      }
      setMessage(form.id ? '題目已更新。' : '題目已新增。');
      setForm({ ...EMPTY_FORM, lecture_id: String(payload.lecture_id) });
      setEditorOpen(false);
      await loadReviewData(String(payload.lecture_id));
    } catch (err) {
      setMessage(err.message || '儲存題目失敗');
    } finally {
      setSaving(false);
    }
  }

  async function deleteQuestion(question) {
    const confirmed = window.confirm(`確定要刪除這題嗎？\n\n${question.question_text}`);
    if (!confirmed) return;

    setSaving(true);
    setMessage('');
    try {
      const res = await fetch(`${API_URL}/teacher/questions/${question.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || '刪除題目失敗');
      }
      setMessage('題目已刪除。');
      if (form.id === question.id) {
        setForm({ ...EMPTY_FORM, lecture_id: lectureId });
      }
      await loadReviewData(lectureId);
    } catch (err) {
      setMessage(err.message || '刪除題目失敗');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="teacher-state"><div className="teacher-loader" /><p>正在載入審題資料...</p></div>;
  }

  if (error) {
    return (
      <div className="teacher-state">
        <span className="teacher-state-icon">!</span>
        <h1>無法開啟審題頁</h1>
        <p>{error}</p>
        <Link to="/login" className="primary-link">前往登入</Link>
      </div>
    );
  }

  if (!data?.courses?.length) {
    return (
      <div className="teacher-state">
        <span className="teacher-state-icon">＋</span>
        <h1>尚無可審題課程</h1>
        <p>請先將課程的 teacher_id 指定給目前老師帳號。</p>
      </div>
    );
  }

  return (
    <div className="teacher-page question-review-page">
      <header className="teacher-hero">
        <div>
          <p className="eyebrow">Question review</p>
          <h1>審題中心</h1>
          <p>管理每個小節的題目、選項、答案、解析與影片出現時間。</p>
        </div>
        <div className="teacher-filters">
          <label>
            <span>課程</span>
            <select
              value={courseId}
              onChange={event => {
                const nextCourseId = event.target.value;
                const nextCourse = data.courses.find(item => String(item.id) === String(nextCourseId));
                const firstLectureId = nextCourse?.lectures?.[0]?.id ? String(nextCourse.lectures[0].id) : '';
                setCourseId(nextCourseId);
                changeLecture(firstLectureId);
              }}
            >
              {data.courses.map(item => (
                <option key={item.id} value={item.id}>{item.title || item.course_name || `課程 ${item.id}`}</option>
              ))}
            </select>
          </label>
          <label>
            <span>小節</span>
            <select value={lectureId} onChange={event => changeLecture(event.target.value)}>
              {(course?.lectures || []).map(item => (
                <option key={item.id} value={item.id}>{item.title || item.course_name || `小節 ${item.id}`}</option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {message && <p className="question-review-message">{message}</p>}

      <section className="question-review-grid">
        <article className="teacher-panel">
          <div className="panel-title">
            <div>
              <h3>{lecture?.title || '小節題目'}</h3>
              <p>{questions.length} 題 · 按「修改」可編輯原本題目</p>
            </div>
            <button type="button" className="question-secondary-button" onClick={startCreate}>
              新增題目
            </button>
          </div>

          {questions.length ? (
            <div className="question-review-list">
              {questions.map(question => (
                <div key={question.id} className={`question-review-item ${form.id === question.id ? 'active' : ''}`}>
                  <button type="button" onClick={() => startEdit(question)}>
                    <small>{formatTime(question.source_timestamp)} · 答案 {question.answer || '未設定'}</small>
                    <strong>{question.question_text}</strong>
                    <span>{question.explanation || '尚未填寫解析'}</span>
                  </button>
                  <div className="question-review-actions">
                    <button type="button" className="question-secondary-button compact" onClick={() => startEdit(question)}>
                      修改
                    </button>
                    <button
                      type="button"
                      className="question-delete-button"
                      onClick={() => deleteQuestion(question)}
                      disabled={saving}
                    >
                      刪除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="teacher-empty compact">這個小節目前沒有題目。</div>
          )}
        </article>

        {editorOpen ? (
        <form className="teacher-panel question-editor" ref={editorRef} onSubmit={saveQuestion}>
          <div className="panel-title">
            <div>
              <h3>{form.id ? '修改題目' : '新增題目'}</h3>
              <p>出現時間請填影片秒數，例如 80 代表 1:20。</p>
            </div>
          </div>

          <label className="review-field">
            <span>題目內容</span>
            <textarea
              ref={questionTextRef}
              value={form.question_text}
              onChange={event => setForm({ ...form, question_text: event.target.value })}
              placeholder="輸入題目..."
              rows={4}
            />
          </label>

          <label className="review-field">
            <span>選項，每行一個</span>
            <textarea
              value={form.options_text}
              onChange={event => setForm({ ...form, options_text: event.target.value })}
              rows={5}
            />
          </label>

          <div className="question-form-row">
            <label className="review-field">
              <span>正確答案</span>
              <select value={form.answer} onChange={event => setForm({ ...form, answer: event.target.value })}>
                {['A', 'B', 'C', 'D', 'E'].map(answer => (
                  <option key={answer} value={answer}>{answer}</option>
                ))}
              </select>
            </label>
            <label className="review-field">
              <span>出現秒數 source_timestamp</span>
              <input
                type="number"
                min="0"
                value={form.source_timestamp}
                onChange={event => setForm({ ...form, source_timestamp: event.target.value })}
                placeholder="例如 80"
              />
            </label>
          </div>

          <label className="review-field">
            <span>對應知識點</span>
            <select
              value={form.knowledge_point_id}
              onChange={event => setForm({ ...form, knowledge_point_id: event.target.value })}
            >
              <option value="">不指定</option>
              {knowledgePoints.map(point => (
                <option key={point.id} value={point.id}>
                  {point.title || `知識點 ${point.id}`}
                </option>
              ))}
            </select>
          </label>

          <label className="review-field">
            <span>解析</span>
            <textarea
              value={form.explanation}
              onChange={event => setForm({ ...form, explanation: event.target.value })}
              placeholder="輸入答案解析..."
              rows={4}
            />
          </label>

          <div className="question-editor-actions">
            <button type="button" className="question-secondary-button" onClick={() => setEditorOpen(false)}>
              取消
            </button>
            <button type="submit" className="question-save-button" disabled={saving || !lectureId}>
              {saving ? '儲存中...' : form.id ? '儲存修改' : '新增題目'}
            </button>
          </div>
        </form>
        ) : (
          <aside className="teacher-panel question-editor-empty">
            <h3>選擇操作</h3>
            <p>按左側「新增題目」建立新題目，或按題目旁邊的「修改」編輯既有題目。</p>
          </aside>
        )}
      </section>
    </div>
  );
}
