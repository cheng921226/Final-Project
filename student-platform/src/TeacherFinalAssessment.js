import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

const API_URL = 'http://127.0.0.1:8000';
const EMPTY_FORM = {
  id: null,
  question_text: '',
  options_text: 'A. \nB. \nC. \nD. ',
  answer: 'A',
  explanation: '',
  knowledge_point_id: '',
  is_active: true,
};

function errorText(body, fallback) {
  if (typeof body?.detail === 'string') return body.detail;
  if (body?.detail?.message) return body.detail.message;
  return fallback;
}

function optionsToText(options) {
  return (Array.isArray(options) ? options : []).join('\n');
}

function formatTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
}

function sourceLabel(source) {
  return { ai: 'AI 生成', manual: '手動新增', in_lecture: '課堂跳題' }[source] || source;
}

export default function TeacherFinalAssessment() {
  const token = localStorage.getItem('access_token');
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState('');
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [importOpen, setImportOpen] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [candidateLectures, setCandidateLectures] = useState([]);
  const [candidateLectureId, setCandidateLectureId] = useState('');
  const [candidateSort, setCandidateSort] = useState('accuracy_asc');
  const [selectedIds, setSelectedIds] = useState([]);

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  async function loadCourses(preferredCourseId = courseId) {
    if (!token) {
      setError('請先使用教師或校園平台端帳號登入。');
      setLoading(false);
      return;
    }
    const res = await fetch(`${API_URL}/teacher/final-assessments`, { headers });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(errorText(body, '無法取得正式測驗資料。'));
    const nextCourses = body.courses || [];
    setCourses(nextCourses);
    const nextId = nextCourses.some(item => String(item.id) === String(preferredCourseId))
      ? String(preferredCourseId)
      : nextCourses[0]?.id ? String(nextCourses[0].id) : '';
    setCourseId(nextId);
    return nextId;
  }

  async function loadDetail(targetCourseId, bankVersion = '') {
    if (!targetCourseId) {
      setDetail(null);
      return;
    }
    const query = bankVersion ? `?bank_version=${bankVersion}` : '';
    const res = await fetch(`${API_URL}/teacher/courses/${targetCourseId}/final-assessment${query}`, { headers });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(errorText(body, '無法取得題庫。'));
    setDetail(body);
  }

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setLoading(true);
      setError('');
      try {
        const nextId = await loadCourses('');
        if (!cancelled && nextId) await loadDetail(nextId);
      } catch (err) {
        if (!cancelled) setError(err.message || '正式測驗資料載入失敗');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function refresh(bankVersion = '') {
    await Promise.all([loadCourses(courseId), loadDetail(courseId, bankVersion)]);
  }

  async function selectCourse(nextId) {
    setCourseId(nextId);
    setEditorOpen(false);
    setMessage('');
    setLoading(true);
    try {
      await loadDetail(nextId);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function generateQuestions() {
    if (!courseId || busy) return;
    if (!window.confirm('產生新版本後，新學生測驗會使用新題庫。要繼續嗎？')) return;
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch(`${API_URL}/teacher/courses/${courseId}/final-assessment/generate`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_count: detail?.course?.final_question_count || 10 }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorText(body, 'AI 生成失敗'));
      setMessage(`已建立第 ${body.bank_version} 版，共 ${body.question_count} 題。`);
      await refresh();
    } catch (err) {
      setMessage(err.message || 'AI 生成失敗');
    } finally {
      setBusy(false);
    }
  }

  function startCreate() {
    setForm(EMPTY_FORM);
    setEditorOpen(true);
  }

  function startEdit(question) {
    setForm({
      id: question.id,
      question_text: question.question_text || '',
      options_text: optionsToText(question.options_json),
      answer: question.answer || 'A',
      explanation: question.explanation || '',
      knowledge_point_id: question.knowledge_point_id ? String(question.knowledge_point_id) : '',
      is_active: Boolean(question.is_active),
    });
    setEditorOpen(true);
    window.scrollTo({ top: 220, behavior: 'smooth' });
  }

  async function saveQuestion(event) {
    event.preventDefault();
    if (busy) return;
    const payload = {
      question_text: form.question_text.trim(),
      options_json: form.options_text.split('\n').map(item => item.trim()).filter(Boolean),
      answer: form.answer,
      explanation: form.explanation.trim() || null,
      knowledge_point_id: form.knowledge_point_id ? Number(form.knowledge_point_id) : null,
      is_active: form.is_active,
    };
    setBusy(true);
    setMessage('');
    try {
      const url = form.id
        ? `${API_URL}/teacher/final-assessment/questions/${form.id}`
        : `${API_URL}/teacher/courses/${courseId}/final-assessment/questions`;
      const res = await fetch(url, {
        method: form.id ? 'PATCH' : 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorText(body, '儲存題目失敗'));
      setMessage(form.id ? '題目已更新。' : '題目已新增。');
      setEditorOpen(false);
      await refresh(detail?.selected_version);
    } catch (err) {
      setMessage(err.message || '儲存題目失敗');
    } finally {
      setBusy(false);
    }
  }

  async function disableQuestion(question) {
    if (!window.confirm('確定要停用這題嗎？歷史作答不會被刪除。')) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/teacher/final-assessment/questions/${question.id}`, {
        method: 'DELETE', headers,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorText(body, '停用題目失敗'));
      setMessage('題目已停用。');
      await refresh(detail?.selected_version);
    } catch (err) {
      setMessage(err.message || '停用題目失敗');
    } finally {
      setBusy(false);
    }
  }

  async function loadCandidates(nextLectureId = candidateLectureId, nextSort = candidateSort) {
    const params = new URLSearchParams({ sort: nextSort });
    if (nextLectureId) params.set('lecture_id', nextLectureId);
    const res = await fetch(`${API_URL}/teacher/courses/${courseId}/in-lecture-questions?${params}`, { headers });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(errorText(body, '無法取得課堂題目'));
    setCandidates(body.questions || []);
    setCandidateLectures(body.lectures || []);
  }

  async function openImport() {
    setBusy(true);
    setSelectedIds([]);
    setCandidateLectureId('');
    setCandidateSort('accuracy_asc');
    try {
      await loadCandidates('', 'accuracy_asc');
      setImportOpen(true);
    } catch (err) {
      setMessage(err.message || '無法開啟課堂題目');
    } finally {
      setBusy(false);
    }
  }

  async function changeCandidateFilter(nextLectureId, nextSort) {
    setCandidateLectureId(nextLectureId);
    setCandidateSort(nextSort);
    setBusy(true);
    try {
      await loadCandidates(nextLectureId, nextSort);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  function toggleCandidate(id) {
    setSelectedIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }

  async function importQuestions() {
    if (!selectedIds.length || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/teacher/courses/${courseId}/final-assessment/questions/from-in-lecture`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_ids: selectedIds }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorText(body, '加入正式測驗失敗'));
      setMessage(`已將 ${body.question_count} 題加入正式測驗。`);
      setImportOpen(false);
      await refresh();
    } catch (err) {
      setMessage(err.message || '加入正式測驗失敗');
    } finally {
      setBusy(false);
    }
  }

  if (loading && !detail) return <div className="teacher-state"><div className="teacher-loader" /><p>正在載入正式測驗...</p></div>;
  if (error) return <div className="teacher-state"><h1>無法開啟正式測驗</h1><p>{error}</p><Link to="/login" className="primary-link">前往登入</Link></div>;
  if (!courses.length) return <div className="teacher-state"><h1>尚無可管理課程</h1></div>;

  return (
    <div className="teacher-page final-management-page">
      <header className="teacher-hero">
        <div><p className="eyebrow">Final assessment</p><h1>最終測驗</h1><p>管理整門課的正式題庫、版本與題目來源。</p></div>
        <div className="teacher-filters"><label><span>課程</span><select value={courseId} onChange={event => selectCourse(event.target.value)}>{courses.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label></div>
      </header>

      {message && <p className="question-review-message">{message}</p>}

      <section className="final-status-strip">
        <div><span>建立狀態</span><strong>{detail?.has_final_assessment ? '已建立' : '尚未建立'}</strong></div>
        <div><span>目前版本</span><strong>{detail?.current_version ? `v${detail.current_version}` : '無'}</strong></div>
        <div><span>題目 / 啟用</span><strong>{detail?.question_count || 0} / {detail?.active_question_count || 0}</strong></div>
        <div><span>及格分數</span><strong>{detail?.course?.passing_score ?? 70}</strong></div>
        <div><span>每次題數</span><strong>{detail?.course?.final_question_count ?? 10}</strong></div>
      </section>

      <div className="final-management-toolbar">
        <div className="final-primary-actions">
          <button type="button" className="question-save-button" onClick={generateQuestions} disabled={busy}>{busy ? '處理中...' : 'AI 生成最終測驗'}</button>
          <button type="button" className="question-secondary-button" onClick={startCreate} disabled={!detail?.is_current_version}>＋新增題目</button>
          <button type="button" className="question-secondary-button" onClick={openImport} disabled={busy || !detail?.is_current_version}>從課堂跳題加入</button>
        </div>
        {!!detail?.versions?.length && <label className="final-version-select"><span>查看版本</span><select value={detail.selected_version} onChange={event => loadDetail(courseId, event.target.value)}>{detail.versions.map(version => <option key={version.bank_version} value={version.bank_version}>v{version.bank_version}（{version.question_count} 題）</option>)}</select></label>}
      </div>

      {editorOpen && <form className="teacher-panel final-question-editor" onSubmit={saveQuestion}>
        <div className="panel-title"><div><h3>{form.id ? '修改正式測驗題目' : '手動新增題目'}</h3><p>正式測驗題目不需要影片時間點。</p></div></div>
        <label className="review-field"><span>題目</span><textarea rows="3" value={form.question_text} onChange={event => setForm({ ...form, question_text: event.target.value })} /></label>
        <label className="review-field"><span>選項，每行一個</span><textarea rows="5" value={form.options_text} onChange={event => setForm({ ...form, options_text: event.target.value })} /></label>
        <div className="question-form-row">
          <label className="review-field"><span>正確答案</span><select value={form.answer} onChange={event => setForm({ ...form, answer: event.target.value })}>{['A', 'B', 'C', 'D', 'E'].map(answer => <option key={answer}>{answer}</option>)}</select></label>
          <label className="review-field"><span>對應知識點</span><select value={form.knowledge_point_id} onChange={event => setForm({ ...form, knowledge_point_id: event.target.value })}><option value="">不指定</option>{(detail?.knowledge_points || []).map(point => <option key={point.id} value={point.id}>{point.lecture_title} / {point.title}</option>)}</select></label>
        </div>
        <label className="review-field"><span>解析</span><textarea rows="3" value={form.explanation} onChange={event => setForm({ ...form, explanation: event.target.value })} /></label>
        <label className="final-active-toggle"><input type="checkbox" checked={form.is_active} onChange={event => setForm({ ...form, is_active: event.target.checked })} />啟用這題</label>
        <div className="question-editor-actions"><button type="button" className="question-secondary-button" onClick={() => setEditorOpen(false)}>取消</button><button type="submit" className="question-save-button" disabled={busy}>{busy ? '儲存中...' : '儲存題目'}</button></div>
      </form>}

      <section className="teacher-panel final-question-bank">
        <div className="panel-title"><div><h3>v{detail?.selected_version || 1} 題庫</h3><p>停用題目不會刪除過去學生的作答紀錄。</p></div></div>
        {detail?.questions?.length ? <div className="final-question-list">{detail.questions.map((question, index) => <article key={question.id} className={`final-question-row ${question.is_active ? '' : 'is-disabled'}`}>
          <div className="final-question-number">{index + 1}</div>
          <div className="final-question-content"><div className="final-question-meta"><span>{sourceLabel(question.source_type)}</span><span>{question.is_active ? '啟用中' : '已停用'}</span>{question.source_question_id && <span>原題 #{question.source_question_id}</span>}</div><h4>{question.question_text}</h4><ol>{(question.options_json || []).map((option, optionIndex) => <li key={optionIndex}>{option}</li>)}</ol><p><strong>答案：{question.answer}</strong> {question.explanation || '尚未填寫解析'}</p></div>
          <div className="final-question-actions">{detail.is_current_version ? <><button type="button" className="question-secondary-button compact" onClick={() => startEdit(question)}>修改</button>{question.is_active && <button type="button" className="question-delete-button" onClick={() => disableQuestion(question)}>停用</button>}</> : <span className="final-readonly-label">歷史版本唯讀</span>}</div>
        </article>)}</div> : <div className="teacher-empty compact">這個版本還沒有題目。</div>}
      </section>

      {importOpen && <div className="final-import-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setImportOpen(false); }}><section className="final-import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div className="panel-title"><div><h2 id="import-title">從課堂跳題加入</h2><p>題目會複製成獨立的正式測驗快照。</p></div><button type="button" className="question-secondary-button compact" onClick={() => setImportOpen(false)}>關閉</button></div>
        <div className="final-import-filters"><label><span>小節</span><select value={candidateLectureId} onChange={event => changeCandidateFilter(event.target.value, candidateSort)}><option value="">全部小節</option>{candidateLectures.map(lecture => <option key={lecture.id} value={lecture.id}>{lecture.title}</option>)}</select></label><label><span>排序方式</span><select value={candidateSort} onChange={event => changeCandidateFilter(candidateLectureId, event.target.value)}><option value="accuracy_asc">正確率：低 → 高</option><option value="accuracy_desc">正確率：高 → 低</option><option value="timeline_asc">影片時間點：前 → 後</option><option value="timeline_desc">影片時間點：後 → 前</option></select></label></div>
        <div className="final-candidate-list">{candidates.map(question => <label key={question.id} className="final-candidate-row"><input type="checkbox" checked={selectedIds.includes(question.id)} onChange={() => toggleCandidate(question.id)} /><div><strong>{question.question_text}</strong><p>{question.lecture_title} · {formatTime(question.source_timestamp)} · 答案 {question.correct_answer}</p><div className="final-candidate-stats"><span>正確率 {question.accuracy}%</span><span>作答 {question.attempt_count} 人次</span>{question.knowledge_point?.title && <span>{question.knowledge_point.title}</span>}</div></div></label>)}{!candidates.length && <div className="teacher-empty compact">目前沒有可加入的課堂跳題。</div>}</div>
        <footer className="final-import-footer"><strong>已選擇 {selectedIds.length} 題</strong><div><button type="button" className="question-secondary-button" onClick={() => setImportOpen(false)}>取消</button><button type="button" className="question-save-button" onClick={importQuestions} disabled={!selectedIds.length || busy}>加入最終測驗</button></div></footer>
      </section></div>}
    </div>
  );
}
