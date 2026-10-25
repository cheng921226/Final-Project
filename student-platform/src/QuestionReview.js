import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import SearchableCourseSelect from './SearchableCourseSelect';

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

function optionLines(value) {
  return String(value || '')
    .split('\n')
    .map(option => option.trim())
    .filter(Boolean);
}

function answerChoices(value) {
  return optionLines(value).slice(0, 26).map((option, index) => ({
    value: String.fromCharCode(65 + index),
    option,
  }));
}

function renumberOptionPrefixes(value) {
  return String(value || '')
    .split('\n')
    .map((line, index) => {
      if (index >= 26 || !/^[A-Z][.、)]\s*/i.test(line)) return line;
      return line.replace(/^[A-Z][.、)]\s*/i, `${String.fromCharCode(65 + index)}. `);
    })
    .join('\n');
}

function toPayload(form) {
  return {
    lecture_id: Number(form.lecture_id),
    knowledge_point_id: form.knowledge_point_id ? Number(form.knowledge_point_id) : null,
    question_text: form.question_text.trim(),
    options_json: optionLines(form.options_text),
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
  const initialLectureId = new URLSearchParams(window.location.search).get('lecture') || '';
  const [data, setData] = useState(null);
  const [courseId, setCourseId] = useState('');
  const [lectureId, setLectureId] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const questionListPanelRef = useRef(null);
  const editorRef = useRef(null);
  const questionTextRef = useRef(null);

  useLayoutEffect(() => {
    const listPanel = questionListPanelRef.current;
    const editor = editorRef.current;
    if (!listPanel) return undefined;

    const syncPanelHeight = () => {
      if (window.innerWidth <= 900 || !editor) {
        listPanel.style.height = '';
        return;
      }
      listPanel.style.height = `${editor.getBoundingClientRect().height}px`;
    };

    syncPanelHeight();
    window.addEventListener('resize', syncPanelHeight);
    const observer = typeof ResizeObserver === 'undefined' || !editor
      ? null
      : new ResizeObserver(syncPanelHeight);
    observer?.observe(editor);

    return () => {
      window.removeEventListener('resize', syncPanelHeight);
      observer?.disconnect();
      listPanel.style.height = '';
    };
  }, [editorOpen, lectureId, data]);

  function focusEditor() {
    setTimeout(() => {
      questionTextRef.current?.focus({ preventScroll: true });
    }, 0);
  }

  async function loadReviewData(preferredLectureId = lectureId) {
    if (!token) {
      setError('請先使用教師或校園平台端帳號登入。');
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
      const preferredCourse = preferredLectureId
        ? result.courses?.find(course =>
            course.lectures?.some(lecture => String(lecture.id) === String(preferredLectureId))
          )
        : null;
      const nextCourseId = preferredCourse?.id
        || (courseId && result.courses?.some(course => String(course.id) === String(courseId))
          ? courseId
          : firstCourse?.id);
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
    loadReviewData(initialLectureId);
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
  const pendingQuestions = questions.filter(question => question.review_status === 'pending');
  const unpublishedQuestions = questions.filter(question => question.review_status === 'unpublished');
  const publishedQuestions = questions.filter(question => question.review_status === 'published');
  const knowledgePoints = lecture?.knowledge_points || [];
  const availableAnswers = useMemo(() => answerChoices(form.options_text), [form.options_text]);

  function updateLectureQuestions(targetLectureId, updateQuestions) {
    setData(current => {
      if (!current) return current;
      return {
        ...current,
        courses: current.courses.map(course => ({
          ...course,
          lectures: (course.lectures || []).map(item => (
            String(item.id) === String(targetLectureId)
              ? { ...item, questions: updateQuestions(item.questions || []) }
              : item
          )),
        })),
      };
    });
  }

  function changeOptions(optionsText) {
    const nextAnswers = answerChoices(optionsText);
    const answerStillExists = nextAnswers.some(item => item.value === form.answer);
    setForm({
      ...form,
      options_text: optionsText,
      answer: answerStillExists ? form.answer : (nextAnswers[0]?.value || ''),
    });
  }

  function handleOptionsKeyDown(event) {
    const input = event.currentTarget;
    const { selectionStart, selectionEnd, value } = input;
    if (selectionStart === null || selectionEnd === null) return;

    if (event.key === 'Enter') {
      const lineIndex = value.slice(0, selectionStart).split('\n').length - 1;
      if (lineIndex >= 25) return;

      event.preventDefault();
      const marker = '__OPTION_CURSOR__';
      const nextPrefix = `${String.fromCharCode(66 + lineIndex)}. `;
      const withNewLine = `${value.slice(0, selectionStart)}\n${nextPrefix}${marker}${value.slice(selectionEnd)}`;
      const renumbered = renumberOptionPrefixes(withNewLine);
      const nextCursor = renumbered.indexOf(marker);
      const nextValue = renumbered.replace(marker, '');
      changeOptions(nextValue);
      window.requestAnimationFrame(() => {
        input.setSelectionRange(nextCursor, nextCursor);
      });
      return;
    }

    if (event.key === 'Backspace' && selectionStart === selectionEnd) {
      const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
      const beforeCursor = value.slice(lineStart, selectionStart);
      if (/^[A-Z][.、)]\s?$/i.test(beforeCursor)) {
        event.preventDefault();
        const nextValue = value.slice(0, lineStart) + value.slice(selectionStart);
        changeOptions(nextValue);
        window.requestAnimationFrame(() => {
          input.setSelectionRange(lineStart, lineStart);
        });
      }
    }
  }

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
    if (payload.options_json.length < 2) {
      setMessage('至少要有兩個選項，每行代表一個選項。');
      return;
    }
    if (payload.options_json.length > 26) {
      setMessage('選項最多 26 個。');
      return;
    }
    if (!availableAnswers.some(item => item.value === payload.answer)) {
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
      const savedQuestion = await res.json();
      updateLectureQuestions(payload.lecture_id, currentQuestions => {
        const nextQuestions = form.id
          ? currentQuestions.map(question => (
              String(question.id) === String(form.id) ? savedQuestion : question
            ))
          : [...currentQuestions, savedQuestion];
        return nextQuestions.sort((left, right) => (
          (Number(left.source_timestamp) || 0) - (Number(right.source_timestamp) || 0)
        ));
      });
      setMessage(form.id ? '題目已更新。' : '題目已新增為未發布。');
      setForm({ ...EMPTY_FORM, lecture_id: String(payload.lecture_id) });
      setEditorOpen(false);
    } catch (err) {
      setMessage(err.message || '儲存題目失敗');
    } finally {
      setSaving(false);
    }
  }

  async function deleteQuestion(question) {
    const confirmed = window.confirm(`確定刪除這題嗎？刪除後會從題目列表消失，但歷史作答仍會保留。\n\n${question.question_text}`);
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
      setMessage('題目已刪除，歷史作答仍然保留。');
      updateLectureQuestions(lectureId, currentQuestions => (
        currentQuestions.filter(item => String(item.id) !== String(question.id))
      ));
      if (form.id === question.id) {
        setForm({ ...EMPTY_FORM, lecture_id: lectureId });
        setEditorOpen(false);
      }
    } catch (err) {
      setMessage(err.message || '刪除題目失敗');
    } finally {
      setSaving(false);
    }
  }

  async function changePublicationStatus(question, action) {
    if (saving) return;
    const isPublishing = action === 'publish';
    const actionLabel = isPublishing ? '發布' : '取消發布';
    if (!isPublishing && !window.confirm(`確定將這題改為未發布嗎？學生將不會看到這題。\n\n${question.question_text}`)) return;

    setSaving(true);
    setMessage('');
    try {
      const res = await fetch(`${API_URL}/teacher/questions/${question.id}/${action}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `${actionLabel}題目失敗`);
      }
      setMessage(isPublishing ? '題目已發布，學生現在可以看到。' : '題目已設為未發布，仍保留在題目列表。');
      updateLectureQuestions(lectureId, currentQuestions => currentQuestions.map(item => (
        String(item.id) === String(question.id)
          ? { ...item, review_status: isPublishing ? 'published' : 'unpublished' }
          : item
      )));
    } catch (err) {
      setMessage(err.message || `${actionLabel}題目失敗`);
    } finally {
      setSaving(false);
    }
  }

  async function publishPendingBatch() {
    if (!lectureId || !pendingQuestions.length || saving) return;
    if (!window.confirm('確定發布最新一批待審核題目嗎？發布後會取代這個小節原本的 AI 題目。')) return;

    setSaving(true);
    setMessage('');
    try {
      const res = await fetch(`${API_URL}/teacher/lectures/${lectureId}/questions/publish-pending`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || '發布題目失敗');
      setMessage(`已發布 ${body.published_count || pendingQuestions.length} 題，學生現在可以看到新版題目。`);
      setEditorOpen(false);
      updateLectureQuestions(lectureId, currentQuestions => currentQuestions.map(question => {
        if (question.generation_batch_id === body.generation_batch_id) {
          return { ...question, review_status: 'published' };
        }
        if (question.review_status === 'pending') {
          return { ...question, review_status: 'unpublished' };
        }
        if (
          question.review_status === 'published'
          && ['ai', 'legacy'].includes(question.source_type)
        ) {
          return { ...question, review_status: 'unpublished' };
        }
        return question;
      }));
    } catch (err) {
      setMessage(err.message || '發布題目失敗');
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
          <SearchableCourseSelect
            courses={data.courses}
            value={courseId}
            onChange={nextCourseId => {
                const nextCourse = data.courses.find(item => String(item.id) === String(nextCourseId));
                const firstLectureId = nextCourse?.lectures?.[0]?.id ? String(nextCourse.lectures[0].id) : '';
                setCourseId(nextCourseId);
                changeLecture(firstLectureId);
            }}
          />
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
        <article className="teacher-panel" ref={questionListPanelRef}>
          <div className="panel-title">
            <div>
              <h3>{lecture?.title || '小節題目'}</h3>
              <p>{pendingQuestions.length} 題待審核 · {unpublishedQuestions.length} 題未發布 · {publishedQuestions.length} 題已發布</p>
            </div>
            <div className="question-review-toolbar">
              {pendingQuestions.length > 0 && <button type="button" className="question-save-button" onClick={publishPendingBatch} disabled={saving}>全部核准發布</button>}
              <button type="button" className="question-secondary-button" onClick={startCreate}>新增題目</button>
            </div>
          </div>

          {questions.length ? (
            <div className="question-review-list">
              {questions.map(question => (
                <div key={question.id} className={`question-review-item ${form.id === question.id ? 'active' : ''}`}>
                  <button type="button" onClick={() => startEdit(question)}>
                    <small>
                      <span className={`question-review-status ${question.review_status || 'published'}`}>
                        {question.review_status === 'pending' ? '待審核' : question.review_status === 'unpublished' ? '未發布' : '已發布'}
                      </span>
                      {formatTime(question.source_timestamp)} · 答案 {question.answer || '未設定'}
                    </small>
                    <strong>{question.question_text}</strong>
                    <span>{question.explanation || '尚未填寫解析'}</span>
                  </button>
                  <div className="question-review-actions">
                    <button type="button" className="question-secondary-button compact" onClick={() => startEdit(question)}>
                      修改
                    </button>
                    {question.review_status === 'published'
                      ? <button type="button" className="question-secondary-button compact" onClick={() => changePublicationStatus(question, 'unpublish')} disabled={saving}>取消發布</button>
                      : <button type="button" className="question-save-button compact" onClick={() => changePublicationStatus(question, 'publish')} disabled={saving}>{question.review_status === 'pending' ? '核准並發布' : '發布'}</button>}
                    {question.review_status === 'pending' && <button type="button" className="question-secondary-button compact" onClick={() => changePublicationStatus(question, 'unpublish')} disabled={saving}>設為未發布</button>}
                    <button type="button" className="question-delete-button" onClick={() => deleteQuestion(question)} disabled={saving}>刪除</button>
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
              onChange={event => changeOptions(renumberOptionPrefixes(event.target.value))}
              onKeyDown={handleOptionsKeyDown}
              rows={5}
            />
          </label>

          <div className="question-form-row">
            <label className="review-field">
              <span>正確答案</span>
              <select value={form.answer} disabled={!availableAnswers.length} onChange={event => setForm({ ...form, answer: event.target.value })}>
                {!availableAnswers.length && <option value="">請先輸入選項</option>}
                {availableAnswers.map(({ value, option }) => (
                  <option key={value} value={value}>{value}：{option.replace(/^[A-Z][.、)]\s*/i, '') || option}</option>
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
