import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

const API_URL = 'http://127.0.0.1:8000';

const STATUS_LABELS = {
  draft: '草稿',
  published: '已發布',
  archived: '已封存',
};

const AI_COMPONENTS = [
  ['summary', '摘要'],
  ['knowledge_points', '知識點'],
  ['mindmap', '心智圖'],
  ['questions', '課堂題目'],
];

const GENERATION_LABELS = {
  transcript: '逐字稿',
  summary: '摘要',
  knowledge_points: '知識點',
  mindmap: '心智圖',
  questions: '題目',
};

const PROCESS_LABELS = {
  pending: '等待處理',
  processing: '處理中',
  completed: '已完成',
  failed: '失敗',
};

const BACKUP_LABELS = {
  not_requested: '未要求備份',
  pending: '等待備份',
  processing: '備份中',
  completed: '已完成',
  failed: '備份失敗',
};

const UNSAVED_CHANGES_MESSAGE = '你有尚未儲存的變更，確定要離開嗎？';
const REPLACE_BACKUP_MESSAGE = '這個小節已經有影片備份。確定要重新備份並覆蓋現有版本嗎？';

function isYouTubeUrl(value) {
  return /(?:youtube\.com|youtu\.be)\//i.test(value || '');
}

function courseForm(course = {}) {
  return {
    title: course.title || '',
    description: course.description || '',
    status: course.status || 'draft',
    teacher_id: course.teacher_id ?? '',
  };
}

function lectureForm(lecture = {}) {
  return {
    title: lecture.title || '',
    media_url: lecture.media_url || '',
    is_visible: lecture.is_visible !== false,
    transcript_content: lecture.content_status?.transcript_content || '',
  };
}

function formsMatch(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function courseIdFromUrl() {
  return new URLSearchParams(window.location.search).get('course') || '';
}

function rememberCourseInUrl(courseId) {
  const url = new URL(window.location.href);
  if (courseId) url.searchParams.set('course', courseId);
  else url.searchParams.delete('course');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

export default function CourseManagement() {
  const token = localStorage.getItem('access_token');
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [data, setData] = useState(null);
  const [courseId, setCourseId] = useState('');
  const [form, setForm] = useState(courseForm());
  const [lectureForms, setLectureForms] = useState({});
  const [openTranscriptId, setOpenTranscriptId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const skipNextHistoryWarning = useRef(false);

  const selectedCourse = useMemo(
    () => data?.courses?.find(course => String(course.id) === String(courseId)),
    [courseId, data]
  );
  const hasActiveJobs = useMemo(
    () => (data?.courses || []).some(course =>
      (course.lectures || []).some(lecture =>
        ['pending', 'processing'].includes(lecture.backup_status)
        || Object.values(lecture.content_status?.generation_status || {}).some(
          status => status?.status === 'processing'
        )
      )
    ),
    [data]
  );
  const isCampus = data?.actor?.role === 'campus';
  const hasUnsavedChanges = useMemo(() => {
    if (!selectedCourse) return false;
    if (!formsMatch(form, courseForm(selectedCourse))) return true;
    return (selectedCourse.lectures || []).some(lecture =>
      !formsMatch(lectureForms[lecture.id] || lectureForm(), lectureForm(lecture))
    );
  }, [form, lectureForms, selectedCourse]);

  useEffect(() => {
    if (!hasUnsavedChanges) return undefined;

    const warnBeforeUnload = event => {
      event.preventDefault();
      event.returnValue = '';
    };
    const warnBeforeLinkNavigation = event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest?.('a[href]');
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      const destination = new URL(link.href, window.location.href);
      if (destination.href === window.location.href) return;
      if (!window.confirm(UNSAVED_CHANGES_MESSAGE)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const warnBeforeHistoryNavigation = () => {
      if (skipNextHistoryWarning.current) {
        skipNextHistoryWarning.current = false;
        return;
      }
      if (!window.confirm(UNSAVED_CHANGES_MESSAGE)) {
        skipNextHistoryWarning.current = true;
        window.history.forward();
      }
    };

    window.addEventListener('beforeunload', warnBeforeUnload);
    document.addEventListener('click', warnBeforeLinkNavigation, true);
    window.addEventListener('popstate', warnBeforeHistoryNavigation);
    return () => {
      window.removeEventListener('beforeunload', warnBeforeUnload);
      document.removeEventListener('click', warnBeforeLinkNavigation, true);
      window.removeEventListener('popstate', warnBeforeHistoryNavigation);
    };
  }, [hasUnsavedChanges]);

  async function load(preferredId = courseId) {
    if (!token) {
      setError('請先使用教師或校園平台端帳號登入。');
      setLoading(false);
      return;
    }
    const response = await fetch(`${API_URL}/teacher/course-management`, { headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || '無法取得課程管理資料');
    setData(body);
    const nextCourse = body.courses?.find(item => String(item.id) === String(preferredId)) || body.courses?.[0];
    const nextCourseId = nextCourse ? String(nextCourse.id) : '';
    setCourseId(nextCourseId);
    rememberCourseInUrl(nextCourseId);
    setForm(courseForm(nextCourse));
    setLectureForms(Object.fromEntries((nextCourse?.lectures || []).map(lecture => [lecture.id, lectureForm(lecture)])));
  }

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      try {
        await load(courseIdFromUrl());
      } catch (err) {
        if (!cancelled) setError(err.message || '課程管理載入失敗');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    initialize();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!token || !hasActiveJobs) return undefined;

    const intervalId = window.setInterval(async () => {
      try {
        const response = await fetch(`${API_URL}/teacher/course-management/job-statuses`, { headers });
        const body = await response.json().catch(() => ({}));
        if (response.ok) {
          const statuses = new Map(
            (body.lectures || []).map(lecture => [String(lecture.id), lecture])
          );
          setData(current => current ? {
            ...current,
            courses: (current.courses || []).map(course => ({
              ...course,
              lectures: (course.lectures || []).map(lecture => {
                const update = statuses.get(String(lecture.id));
                if (!update) return lecture;
                return {
                  ...lecture,
                  backup_status: update.backup_status,
                  backup_error: update.backup_error,
                  backup_updated_at: update.backup_updated_at,
                  content_status: {
                    ...lecture.content_status,
                    generation_status: update.generation_status || {},
                  },
                };
              }),
            })),
          } : current);
        }
      } catch (_) {
        // Keep the current screen usable; the next poll can recover naturally.
      }
    }, 8000);

    return () => window.clearInterval(intervalId);
  }, [hasActiveJobs, headers, token]);

  function chooseCourse(nextId) {
    if (String(nextId) === String(courseId)) return;
    if (hasUnsavedChanges && !window.confirm(UNSAVED_CHANGES_MESSAGE)) return;
    const course = data?.courses?.find(item => String(item.id) === String(nextId));
    setCourseId(nextId);
    rememberCourseInUrl(nextId);
    setForm(courseForm(course));
    setLectureForms(Object.fromEntries((course?.lectures || []).map(lecture => [lecture.id, lectureForm(lecture)])));
    setMessage('');
    setOpenTranscriptId(null);
  }

  async function saveCourse(event) {
    event.preventDefault();
    if (!selectedCourse || busyKey) return;
    setBusyKey('course');
    setMessage('');
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        status: form.status,
      };
      if (isCampus) payload.teacher_id = form.teacher_id === '' ? null : Number(form.teacher_id);
      const response = await fetch(`${API_URL}/teacher/course-management/courses/${selectedCourse.id}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || '課程儲存失敗');
      setMessage('課程資料已更新。');
      await load(selectedCourse.id);
    } catch (err) {
      setMessage(err.message || '課程儲存失敗');
    } finally {
      setBusyKey('');
    }
  }

  async function saveLecture(lectureId) {
    const lectureForm = lectureForms[lectureId];
    if (!lectureForm || busyKey) return;
    setBusyKey(`lecture-${lectureId}`);
    setMessage('');
    try {
      const response = await fetch(`${API_URL}/teacher/course-management/lectures/${lectureId}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: lectureForm.title.trim(),
          media_url: lectureForm.media_url.trim() || null,
          is_visible: lectureForm.is_visible,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || '小節儲存失敗');
      setMessage('小節資料已更新。');
      await load(selectedCourse.id);
    } catch (err) {
      setMessage(err.message || '小節儲存失敗');
    } finally {
      setBusyKey('');
    }
  }

  async function deleteLecture(lecture) {
    if (!lecture || busyKey) return;
    const expectedTitle = lecture.title || '未命名小節';
    const typedTitle = window.prompt(
      `刪除後，這個小節的教材、學生作答與觀看紀錄都會永久消失。\n\n請輸入小節名稱「${expectedTitle}」確認刪除：`
    );
    if (typedTitle === null) return;
    if (typedTitle.trim() !== expectedTitle) {
      setMessage('小節名稱不一致，已取消刪除。');
      return;
    }

    setBusyKey(`delete-lecture-${lecture.id}`);
    setMessage('');
    try {
      const response = await fetch(`${API_URL}/teacher/course-management/lectures/${lecture.id}`, {
        method: 'DELETE',
        headers,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || '小節刪除失敗');
      if (openTranscriptId === lecture.id) setOpenTranscriptId(null);
      await load(selectedCourse.id);
      setMessage(body.backup_cleanup_failed
        ? `「${expectedTitle}」已刪除，但影片備份檔清理失敗，請檢查 Storage。`
        : `「${expectedTitle}」及相關資料已永久刪除。`);
    } catch (err) {
      setMessage(err.message || '小節刪除失敗');
    } finally {
      setBusyKey('');
    }
  }

  async function saveTranscript(lectureId) {
    const content = lectureForms[lectureId]?.transcript_content?.trim();
    if (!content || busyKey) return;
    setBusyKey(`transcript-${lectureId}`);
    setMessage('');
    try {
      const response = await fetch(`${API_URL}/teacher/course-management/lectures/${lectureId}/transcript`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || '逐字稿儲存失敗');
      setMessage('逐字稿已更新。');
      await load(selectedCourse.id);
    } catch (err) {
      setMessage(err.message || '逐字稿儲存失敗');
    } finally {
      setBusyKey('');
    }
  }

  async function duplicateCourse() {
    if (!selectedCourse || busyKey || !window.confirm('要複製這門課的基本資料與小節架構嗎？AI 內容不會一起複製。')) return;
    setBusyKey('duplicate');
    setMessage('');
    try {
      const response = await fetch(`${API_URL}/teacher/course-management/courses/${selectedCourse.id}/duplicate`, {
        method: 'POST',
        headers,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || '複製課程失敗');
      setMessage(`已建立「${body.course?.title || '課程副本'}」。`);
      await load(body.course?.id);
    } catch (err) {
      setMessage(err.message || '複製課程失敗');
    } finally {
      setBusyKey('');
    }
  }

  async function deleteCourse() {
    if (!selectedCourse || busyKey) return;
    const expectedTitle = selectedCourse.title || '未命名課程';
    const typedTitle = window.prompt(
      `刪除後，這門課的小節、教材、學生作答、學習進度與學分紀錄都會永久消失。\n\n請輸入課程名稱「${expectedTitle}」確認刪除：`
    );
    if (typedTitle === null) return;
    if (typedTitle.trim() !== expectedTitle) {
      setMessage('課程名稱不一致，已取消刪除。');
      return;
    }

    setBusyKey('delete-course');
    setMessage('');
    try {
      const response = await fetch(`${API_URL}/teacher/course-management/courses/${selectedCourse.id}`, {
        method: 'DELETE',
        headers,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || '課程刪除失敗');
      setOpenTranscriptId(null);
      await load('');
      setMessage(body.backup_cleanup_failed
        ? `「${expectedTitle}」已刪除，但影片備份檔清理失敗，請檢查 Storage。`
        : `「${expectedTitle}」及相關資料已永久刪除。`);
    } catch (err) {
      setMessage(err.message || '課程刪除失敗');
    } finally {
      setBusyKey('');
    }
  }

  async function moveLecture(index, direction) {
    const lectures = [...(selectedCourse?.lectures || [])];
    const target = index + direction;
    if (target < 0 || target >= lectures.length || busyKey) return;
    [lectures[index], lectures[target]] = [lectures[target], lectures[index]];
    setBusyKey('order');
    try {
      const response = await fetch(`${API_URL}/teacher/course-management/courses/${selectedCourse.id}/lecture-order`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ lecture_ids: lectures.map(item => item.id) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || '排序更新失敗');
      await load(selectedCourse.id);
    } catch (err) {
      setMessage(err.message || '排序更新失敗');
    } finally {
      setBusyKey('');
    }
  }

  async function regenerate(lecture, component, label) {
    const warning = component === 'questions'
      ? '重新產生的題目會先進入審題中心，原本已發布題目會繼續供學生使用。要繼續嗎？'
      : component === 'knowledge_points'
        ? `重新產生${label}後，舊內容會停止顯示，但歷史資料會保留。要繼續嗎？`
        : `確定要重新產生${label}嗎？`;
    if (!window.confirm(warning) || busyKey) return;
    setBusyKey(`ai-${lecture.id}-${component}`);
    setMessage('');
    try {
      const response = await fetch(`${API_URL}/teacher/course-management/lectures/${lecture.id}/regenerate`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ components: [component] }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || `${label}重新產生失敗`);
      setMessage(component === 'questions'
        ? `${lecture.title}的新題目已產生，請前往審題中心核准發布。`
        : `${lecture.title}的${label}已重新產生。`);
      await load(selectedCourse.id);
    } catch (err) {
      setMessage(err.message || `${label}重新產生失敗`);
    } finally {
      setBusyKey('');
    }
  }

  async function retryFailed(lecture) {
    if (busyKey) return;
    setBusyKey(`retry-${lecture.id}`);
    setMessage('');
    try {
      const response = await fetch(`${API_URL}/teacher/course-management/lectures/${lecture.id}/retry-failed`, {
        method: 'POST',
        headers,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || '重新執行失敗項目失敗');
      setMessage(body.message || `${lecture.title}的失敗項目已重新執行。`);
      await load(selectedCourse.id);
    } catch (err) {
      setMessage(err.message || '重新執行失敗項目失敗');
    } finally {
      setBusyKey('');
    }
  }

  async function requestBackup(lecture) {
    if (busyKey) return;
    if (lecture.backup_status === 'completed' && !window.confirm(REPLACE_BACKUP_MESSAGE)) return;
    setBusyKey(`backup-${lecture.id}`);
    setMessage('');
    try {
      const response = await fetch(`${API_URL}/teacher/course-management/lectures/${lecture.id}/backup`, {
        method: 'POST',
        headers,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || '影片備份啟動失敗');
      setMessage(`${lecture.title}已排入影片備份。稍後重新整理可查看結果。`);
      await load(selectedCourse.id);
    } catch (err) {
      setMessage(err.message || '影片備份啟動失敗');
    } finally {
      setBusyKey('');
    }
  }

  if (loading) return <div className="teacher-state"><div className="teacher-loader" /><p>正在載入課程管理...</p></div>;
  if (error) return <div className="teacher-state"><h1>無法開啟課程管理</h1><p>{error}</p><Link to="/login" className="primary-link">前往登入</Link></div>;

  return (
    <div className="teacher-page course-management-page">
      <header className="teacher-hero">
        <div>
          <p className="eyebrow">Course management</p>
          <h1>{isCampus ? '平台課程管理' : '我的課程管理'}</h1>
          <p>{isCampus ? '管理平台上的所有課程，包括老師建立的課程、授課教師指派與發布狀態。' : '管理自己上傳或被指派授課的課程、安排小節並管理 AI 教材。'}</p>
        </div>
        <div className="teacher-filters">
          <label><span>課程</span><select value={courseId} onChange={event => chooseCourse(event.target.value)}>{(data?.courses || []).map(course => <option key={course.id} value={course.id}>{course.title}{course.assigned_teacher ? `｜${course.assigned_teacher.name || course.assigned_teacher.email}` : '｜尚未指派'}</option>)}</select></label>
          <Link
            className="question-secondary-button course-upload-link"
            to="/teacher/upload"
            state={{ courseId }}
          >
            新增課程或小節
          </Link>
        </div>
      </header>

      {message && <p className="question-review-message">{message}</p>}
      {!selectedCourse ? <div className="teacher-empty">目前沒有可管理的課程。</div> : <>
        <form className="teacher-panel course-settings-card" onSubmit={saveCourse}>
          <div className="panel-title">
            <div><h3>課程基本資料</h3><p>草稿不會出現在學生課程列表；封存後可保留歷史資料。</p></div>
            <span className={`course-status-badge status-${form.status}`}>{STATUS_LABELS[form.status]}</span>
          </div>
          <div className="settings-grid">
            <label className="review-field"><span>課程名稱</span><input required value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} /></label>
            <label className="review-field"><span>發布狀態</span><select value={form.status} onChange={event => setForm(current => ({ ...current, status: event.target.value }))}><option value="draft">草稿</option><option value="published">已發布</option><option value="archived">已封存</option></select></label>
            <label className="review-field"><span>上傳者</span><input readOnly value={selectedCourse.creator?.name || selectedCourse.creator?.email || '無法辨識'} /></label>
            {isCampus && <label className="review-field"><span>授課教師</span><select value={form.teacher_id} onChange={event => setForm(current => ({ ...current, teacher_id: event.target.value }))}><option value="">尚未指派</option>{(data.teachers || []).map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.name || teacher.email}</option>)}</select></label>}
          </div>
          <label className="review-field"><span>課程介紹</span><textarea rows={4} value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} placeholder="說明課程內容、學習目標與適合對象" /></label>
          <div className="course-management-actions"><button type="button" className="course-delete-button" onClick={deleteCourse} disabled={Boolean(busyKey)}>{busyKey === 'delete-course' ? '刪除中...' : '刪除課程'}</button><button type="button" className="question-secondary-button" onClick={duplicateCourse} disabled={Boolean(busyKey)}>{busyKey === 'duplicate' ? '複製中...' : '複製課程架構'}</button><Link className="question-secondary-button" to={`/course/${selectedCourse.id}`}>預覽學生畫面</Link><button className="question-save-button" type="submit" disabled={Boolean(busyKey)}>{busyKey === 'course' ? '儲存中...' : '儲存課程'}</button></div>
        </form>

        <section className="teacher-panel course-lecture-manager">
          <div className="panel-title"><div><h3>課程小節</h3><p>修改標題與影片、調整順序、控制顯示或重新產生 AI 內容。</p></div><span className="table-count">{selectedCourse.lectures?.length || 0} 個小節</span></div>
          <div className="managed-lecture-list">
            {(selectedCourse.lectures || []).map((lecture, index) => {
              const lectureForm = lectureForms[lecture.id] || {};
              const content = lecture.content_status || {};
              const generation = content.generation_status || {};
              const hasFailedGeneration = Object.values(generation).some(item => item.status === 'failed');
              return <article className="managed-lecture-card" key={lecture.id}>
                <div className="managed-lecture-order"><strong>{index + 1}</strong><button type="button" disabled={index === 0 || Boolean(busyKey)} onClick={() => moveLecture(index, -1)} aria-label={`上移 ${lecture.title}`}>↑</button><button type="button" disabled={index === selectedCourse.lectures.length - 1 || Boolean(busyKey)} onClick={() => moveLecture(index, 1)} aria-label={`下移 ${lecture.title}`}>↓</button></div>
                <div className="managed-lecture-main">
                  <div className="settings-grid">
                    <label className="review-field"><span>小節名稱</span><input value={lectureForm.title || ''} onChange={event => setLectureForms(current => ({ ...current, [lecture.id]: { ...current[lecture.id], title: event.target.value } }))} /></label>
                    <label className="review-field"><span>影片連結</span><input value={lectureForm.media_url || ''} onChange={event => setLectureForms(current => ({ ...current, [lecture.id]: { ...current[lecture.id], media_url: event.target.value } }))} /></label>
                  </div>
                  <div className="managed-content-status">
                    {Object.entries(GENERATION_LABELS).map(([key, label]) => {
                      const status = generation[key]?.status || 'pending';
                      return <span key={key} className={status === 'completed' ? 'ready' : status === 'failed' ? 'failed' : status === 'processing' ? 'processing' : ''} title={generation[key]?.error_message || ''}>{label}：{PROCESS_LABELS[status] || status}</span>;
                    })}
                    {content.questions_pending_review > 0 && <span className="processing">審題：{content.questions_pending_review} 題待審核</span>}
                    {content.questions_unpublished > 0 && <span>題目：{content.questions_unpublished} 題未發布</span>}
                    <span className={lecture.backup_status === 'completed' ? 'ready' : lecture.backup_status === 'failed' ? 'failed' : lecture.backup_status === 'processing' ? 'processing' : ''}>影片備份：{BACKUP_LABELS[lecture.backup_status || 'not_requested']}</span>
                  </div>
                  <div className="managed-lecture-actions">
                    <label className="visibility-toggle"><input type="checkbox" checked={lectureForm.is_visible !== false} onChange={event => setLectureForms(current => ({ ...current, [lecture.id]: { ...current[lecture.id], is_visible: event.target.checked } }))} /> 對學生顯示</label>
                    <Link className="question-secondary-button compact" to={`/course/${selectedCourse.id}/lecture/${lecture.id}`}>預覽</Link>
                    {content.questions_pending_review > 0 && <Link className="question-secondary-button compact" to={`/teacher/questions?lecture=${lecture.id}`}>前往審題</Link>}
                    {content.transcript && <button type="button" className="question-secondary-button compact" onClick={() => setOpenTranscriptId(current => current === lecture.id ? null : lecture.id)}>{openTranscriptId === lecture.id ? '收合逐字稿' : '編輯逐字稿'}</button>}
                    <button type="button" className="question-save-button compact" disabled={Boolean(busyKey)} onClick={() => saveLecture(lecture.id)}>{busyKey === `lecture-${lecture.id}` ? '儲存中...' : '儲存小節'}</button>
                    <button type="button" className="course-delete-button compact" disabled={Boolean(busyKey)} onClick={() => deleteLecture(lecture)}>{busyKey === `delete-lecture-${lecture.id}` ? '刪除中...' : '刪除小節'}</button>
                    {isYouTubeUrl(lecture.media_url) && <button type="button" className="question-secondary-button compact" disabled={Boolean(busyKey) || ['pending', 'processing'].includes(lecture.backup_status)} onClick={() => requestBackup(lecture)}>{busyKey === `backup-${lecture.id}` ? '啟動中...' : lecture.backup_status === 'completed' ? '重新備份' : '備份影片'}</button>}
                    {hasFailedGeneration && <button type="button" className="question-secondary-button compact" disabled={Boolean(busyKey)} onClick={() => retryFailed(lecture)}>{busyKey === `retry-${lecture.id}` ? '重試中...' : '重新執行失敗項目'}</button>}
                  </div>
                  {openTranscriptId === lecture.id && <div className="managed-transcript-editor"><label className="review-field"><span>逐字稿內容</span><textarea rows={10} value={lectureForm.transcript_content || ''} onChange={event => setLectureForms(current => ({ ...current, [lecture.id]: { ...current[lecture.id], transcript_content: event.target.value } }))} /><small>若內容包含（分:秒）時間標記，儲存後會保留為可供 AI 使用的時間片段。</small></label><button type="button" className="question-save-button compact" disabled={!lectureForm.transcript_content?.trim() || Boolean(busyKey)} onClick={() => saveTranscript(lecture.id)}>{busyKey === `transcript-${lecture.id}` ? '儲存中...' : '儲存逐字稿'}</button></div>}
                  <div className="managed-ai-actions"><span>重新產生：</span>{AI_COMPONENTS.map(([component, label]) => <button type="button" key={component} disabled={!content.transcript || Boolean(busyKey)} onClick={() => regenerate(lecture, component, label)}>{busyKey === `ai-${lecture.id}-${component}` ? '處理中...' : label}</button>)}</div>
                </div>
              </article>;
            })}
            {!selectedCourse.lectures?.length && <div className="teacher-empty compact">這門課目前沒有小節，請先新增課程影片。</div>}
          </div>
        </section>
      </>}
    </div>
  );
}
