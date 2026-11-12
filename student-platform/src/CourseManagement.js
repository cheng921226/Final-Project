import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import SearchableCourseSelect from './SearchableCourseSelect';
import { managementFetch as fetch } from './managementDataCache';

const API_URL = 'http://127.0.0.1:8000';

const STATUS_LABELS = {
  draft: '草稿',
  published: '已發布',
  archived: '已封存',
};
const STATUS_OPTIONS = Object.entries(STATUS_LABELS);

const AI_COMPONENTS = [
  ['transcript', '逐字稿'],
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

const STATUS_CLASSES = {
  pending: 'waiting',
  completed: 'ready',
  failed: 'failed',
  processing: 'processing',
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
  const [expandedLectureIds, setExpandedLectureIds] = useState(() => new Set());
  const [openTranscriptId, setOpenTranscriptId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');
  const [generationQueue, setGenerationQueue] = useState([]);
  const [pendingGeneration, setPendingGeneration] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [coursePickerFixed, setCoursePickerFixed] = useState(false);
  const coursePickerRef = useRef(null);
  const skipNextHistoryWarning = useRef(false);

  const selectedCourse = useMemo(
    () => data?.courses?.find(course => String(course.id) === String(courseId)),
    [courseId, data]
  );
  const hasActiveJobs = useMemo(
    () => Boolean(pendingGeneration) || (data?.courses || []).some(course =>
      (course.lectures || []).some(lecture =>
        ['pending', 'processing'].includes(lecture.backup_status)
        || Object.values(lecture.content_status?.generation_status || {}).some(
          status => status?.status === 'processing'
        )
      )
    ),
    [data, pendingGeneration]
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
    const picker = coursePickerRef.current;
    if (!picker) return undefined;

    const stickyStart = picker.getBoundingClientRect().top + window.scrollY - 82;
    const updatePosition = () => setCoursePickerFixed(window.scrollY >= stickyStart);
    updatePosition();
    window.addEventListener('scroll', updatePosition, { passive: true });
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition);
      window.removeEventListener('resize', updatePosition);
    };
  }, [data?.courses?.length, loading]);

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

  const load = useCallback(async (preferredId, { statusOnly = false } = {}) => {
    if (!token) {
      setError('請先使用教師或校園平台端帳號登入。');
      setLoading(false);
      return;
    }
    const response = await fetch(`${API_URL}/teacher/course-management`, { headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || '無法取得課程管理資料');
    setData(body);
    if (statusOnly) return body;
    const nextCourse = body.courses?.find(item => String(item.id) === String(preferredId)) || body.courses?.[0];
    const nextCourseId = nextCourse ? String(nextCourse.id) : '';
    setCourseId(nextCourseId);
    rememberCourseInUrl(nextCourseId);
    setForm(courseForm(nextCourse));
    setLectureForms(Object.fromEntries((nextCourse?.lectures || []).map(lecture => [lecture.id, lectureForm(lecture)])));
  }, [headers, token]);

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
  }, [load]);

  useEffect(() => {
    if (!token || !hasActiveJobs) return undefined;

    const intervalId = window.setInterval(async () => {
      try {
        const response = await fetch(`${API_URL}/teacher/course-management/job-statuses`, {
          headers,
          managementCache: false,
        });
        const body = await response.json().catch(() => ({}));
        if (response.ok) {
          const statuses = new Map(
            (body.lectures || []).map(lecture => [String(lecture.id), lecture])
          );
          setPendingGeneration(current => {
            if (!current) return current;
            const generation = statuses.get(String(current.lectureId))?.generation_status || {};
            // An old completed/failed status may arrive before the request starts.
            // Keep waiting until the server confirms it has begun processing.
            const components = current.components.filter(component => generation[component]?.status !== 'processing');
            return components.length ? { ...current, components } : null;
          });
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
                    // Polling only returns status rows that physically exist.
                    // Legacy lectures infer completed states from their saved
                    // content, so preserve those inferred values while merging
                    // newer background-job updates.
                    generation_status: {
                      ...(lecture.content_status?.generation_status || {}),
                      ...(update.generation_status || {}),
                    },
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
    if (String(nextId) === String(courseId)) return true;
    if (hasUnsavedChanges && !window.confirm(UNSAVED_CHANGES_MESSAGE)) return false;
    const course = data?.courses?.find(item => String(item.id) === String(nextId));
    setCourseId(nextId);
    rememberCourseInUrl(nextId);
    setForm(courseForm(course));
    setLectureForms(Object.fromEntries((course?.lectures || []).map(lecture => [lecture.id, lectureForm(lecture)])));
    setMessage('');
    setExpandedLectureIds(new Set());
    setOpenTranscriptId(null);
    return true;
  }

  function toggleLecture(lectureId) {
    setExpandedLectureIds(current => {
      const next = new Set(current);
      if (next.has(lectureId)) next.delete(lectureId);
      else next.add(lectureId);
      return next;
    });
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

  function queueRegeneration(lecture, component, label) {
    if (component !== 'transcript' && !lecture.content_status?.transcript) {
      window.alert(`這個小節沒有逐字稿，無法產生${label}。請先產生逐字稿。`);
      return;
    }

    const warning = component === 'questions'
      ? '重新產生的題目會先進入審題中心，原本已發布題目會繼續供學生使用。要繼續嗎？'
      : component === 'knowledge_points'
        ? `重新產生${label}後，舊內容會停止顯示，但歷史資料會保留。要繼續嗎？`
        : component === 'transcript'
          ? lecture.content_status?.transcript
            ? '重新產生逐字稿會覆蓋目前的逐字稿。要繼續嗎？'
            : '確定要從影片產生逐字稿嗎？'
          : `確定要重新產生${label}嗎？`;
    if (!window.confirm(warning)) return;
    setGenerationQueue(current => {
      if (current.some(job => job.lectureId === lecture.id && job.component === component)) return current;
      return [...current, {
        lectureId: lecture.id,
        lectureTitle: lecture.title,
        previousTranscript: lecture.content_status?.transcript_content || '',
        component,
        label,
      }];
    });
  }

  useEffect(() => {
    if (busyKey || !generationQueue.length) return;
    const [{ lectureId, lectureTitle, previousTranscript, component, label }] = generationQueue;
    setBusyKey(`ai-${lectureId}-${component}`);
    setPendingGeneration({ lectureId, components: [component] });
    setGenerationQueue(current => current.slice(1));

    async function run() {
      try {
        const response = await fetch(`${API_URL}/teacher/course-management/lectures/${lectureId}/regenerate`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ components: [component] }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.detail || `${label}重新產生失敗`);
        const latest = await load(undefined, { statusOnly: true });
        if (component === 'transcript') {
          const lecture = latest?.courses?.flatMap(course => course.lectures || []).find(item => item.id === lectureId);
          const transcript = lecture?.content_status?.transcript_content;
          if (typeof transcript === 'string') {
            setLectureForms(current => {
              const form = current[lectureId];
              if (!form || form.transcript_content !== previousTranscript) return current;
              return { ...current, [lectureId]: { ...form, transcript_content: transcript } };
            });
          }
        }
        setMessage(component === 'questions'
          ? `${lectureTitle}的新題目已產生，請前往審題中心核准發布。`
          : `${lectureTitle}的${label}已重新產生。`);
      } catch (err) {
        setMessage(err.message || `${label}重新產生失敗`);
      } finally {
        setPendingGeneration(null);
        setBusyKey('');
      }
    }

    run();
  }, [busyKey, generationQueue, headers, load]);

  async function retryFailed(lecture) {
    if (busyKey) return;
    setBusyKey(`retry-${lecture.id}`);
    setPendingGeneration({
      lectureId: lecture.id,
      components: Object.entries(lecture.content_status?.generation_status || {})
        .filter(([, item]) => item.status === 'failed')
        .map(([component]) => component),
    });
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
      setPendingGeneration(null);
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
        <div
          ref={coursePickerRef}
          className={`teacher-filters${coursePickerFixed ? ' is-fixed' : ''}`}
        >
          <SearchableCourseSelect
            courses={data?.courses || []}
            value={courseId}
            onChange={chooseCourse}
            optionLabel={course => `${course.title}${course.assigned_teacher ? `｜${course.assigned_teacher.name || course.assigned_teacher.email}` : '｜尚未指派'}`}
          />
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
            <div className="review-field">
              <span id="course-publication-status">發布狀態</span>
              <div
                className="course-status-tabs"
                role="group"
                aria-labelledby="course-publication-status"
                style={{ '--selected-status': STATUS_OPTIONS.findIndex(([status]) => status === form.status) }}
              >
                <span className="course-status-indicator" aria-hidden="true" />
                {STATUS_OPTIONS.map(([status, label]) => (
                  <button
                    key={status}
                    type="button"
                    aria-pressed={form.status === status}
                    onClick={() => setForm(current => ({ ...current, status }))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <label className="review-field"><span>上傳者</span><input readOnly value={selectedCourse.creator?.name || selectedCourse.creator?.email || '無法辨識'} /></label>
            {isCampus && <label className="review-field"><span>授課教師</span><select value={form.teacher_id} onChange={event => setForm(current => ({ ...current, teacher_id: event.target.value }))}><option value="">尚未指派</option>{(data.teachers || []).map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.name || teacher.email}</option>)}</select></label>}
          </div>
          <label className="review-field"><span>課程介紹</span><textarea rows={4} value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} placeholder="說明課程內容、學習目標與適合對象" /></label>
          <div className="course-management-actions"><button type="button" className="course-delete-button" onClick={deleteCourse} disabled={Boolean(busyKey)}>{busyKey === 'delete-course' ? '刪除中...' : '刪除課程'}</button><Link className="question-secondary-button" to={`/course/${selectedCourse.id}`}>預覽學生畫面</Link><button className="question-save-button" type="submit" disabled={Boolean(busyKey)}>{busyKey === 'course' ? '儲存中...' : '儲存課程'}</button></div>
        </form>

        <section className="teacher-panel course-lecture-manager">
          <div className="panel-title">
            <div>
              <h3>課程小節</h3>
              {selectedCourse.lectures?.length > 0 && <p>點選「逐、摘、知、心、題」狀態徽章，確認後即可產生或重新產生該項內容。</p>}
            </div>
            <span className="table-count">{selectedCourse.lectures?.length || 0} 個小節</span>
          </div>
          <div className="managed-lecture-list">
            {(selectedCourse.lectures || []).map((lecture, index) => {
              const lectureForm = lectureForms[lecture.id] || {};
              const content = lecture.content_status || {};
              const generation = content.generation_status || {};
              const hasFailedGeneration = Object.values(generation).some(item => item.status === 'failed');
              const expanded = expandedLectureIds.has(lecture.id);
              const detailsId = `managed-lecture-details-${lecture.id}`;
              const statuses = Object.entries(GENERATION_LABELS).map(([key, label]) => {
                const queued = generationQueue.some(job => job.lectureId === lecture.id && job.component === key);
                const isPending = queued || (pendingGeneration?.lectureId === lecture.id && pendingGeneration.components.includes(key));
                const status = isPending ? 'pending' : generation[key]?.status || 'pending';
                return {
                  key,
                  initial: label[0],
                  text: `${label}：${PROCESS_LABELS[status] || status}`,
                  status,
                  queued,
                  unavailable: key === 'transcript' && !isYouTubeUrl(lecture.media_url)
                    ? '只有 YouTube 小節可自動產生逐字稿'
                    : '',
                  busy: isPending || status === 'processing' || busyKey === `ai-${lecture.id}-${key}`,
                  error: isPending ? '' : generation[key]?.error_message,
                };
              });
              if (content.questions_pending_review > 0) {
                statuses.push({ key: 'review', initial: '審', text: `審題：${content.questions_pending_review} 題待審核`, status: 'processing' });
              }
              if (content.questions_unpublished > 0) {
                statuses.push({ key: 'unpublished', initial: '未', text: `題目：${content.questions_unpublished} 題未發布` });
              }
              const backupStatus = lecture.backup_status || 'not_requested';
              statuses.push({ key: 'backup', initial: '影', text: `影片備份：${BACKUP_LABELS[backupStatus]}`, status: backupStatus });
              function renderStatus(item, compact = false) {
                const action = AI_COMPONENTS.find(([component]) => component === item.key);
                const className = STATUS_CLASSES[item.status];
                const text = compact ? item.initial : item.text;
                if (!action) {
                  return <span key={item.key} className={className} title={compact ? item.text : item.error || ''}>{text}</span>;
                }

                const [component, label] = action;
                const hint = item.unavailable ? item.unavailable
                  : item.queued ? '已排入佇列'
                  : item.busy ? '請等待目前的操作完成'
                  : component !== 'transcript' && !content.transcript ? '需要先有逐字稿'
                  : `重新產生${label}`;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={className}
                    aria-label={compact ? item.text : undefined}
                    title={compact ? `${item.text}（${hint}）` : item.error || hint}
                    disabled={Boolean(item.unavailable) || item.busy}
                    onClick={() => queueRegeneration(lecture, component, label)}
                  >
                    {text}
                  </button>
                );
              }

              return <article className="managed-lecture-card" key={lecture.id}>
                <div className="managed-lecture-header">
                  <button
                    type="button"
                    className="managed-lecture-toggle"
                    aria-expanded={expanded}
                    aria-controls={detailsId}
                    aria-describedby={`${detailsId}-status`}
                    onClick={() => toggleLecture(lecture.id)}
                  >
                    <span className="managed-lecture-number" aria-hidden="true">{index + 1}</span>
                    <span className="managed-lecture-title">{lecture.title}</span>
                  </button>
                  <span id={`${detailsId}-status`} hidden>
                    {statuses.map(item => item.text).join('；')}
                  </span>
                  <div className="managed-content-status managed-lecture-badges">
                    {statuses.map(item => renderStatus(item, true))}
                  </div>
                </div>
                <div id={detailsId} className="managed-lecture-details" hidden={!expanded}>
                  <div className="managed-lecture-order"><button type="button" disabled={index === 0 || Boolean(busyKey)} onClick={() => moveLecture(index, -1)} aria-label={`上移 ${lecture.title}`}>↑</button><button type="button" disabled={index === selectedCourse.lectures.length - 1 || Boolean(busyKey)} onClick={() => moveLecture(index, 1)} aria-label={`下移 ${lecture.title}`}>↓</button></div>
                  <div className="managed-lecture-main">
                    <div className="settings-grid">
                      <label className="review-field"><span>小節名稱</span><input value={lectureForm.title || ''} onChange={event => setLectureForms(current => ({ ...current, [lecture.id]: { ...current[lecture.id], title: event.target.value } }))} /></label>
                      <label className="review-field"><span>影片連結</span><input value={lectureForm.media_url || ''} onChange={event => setLectureForms(current => ({ ...current, [lecture.id]: { ...current[lecture.id], media_url: event.target.value } }))} /></label>
                    </div>
                    <div className="managed-lecture-status-panel">
                      <p>點選下方狀態徽章，確認後可產生或重新產生對應內容。</p>
                      <div className="managed-content-status">
                        {statuses.map(item => renderStatus(item))}
                      </div>
                    </div>
                    <div className="managed-lecture-actions">
                      <label className="visibility-toggle"><input type="checkbox" checked={lectureForm.is_visible !== false} onChange={event => setLectureForms(current => ({ ...current, [lecture.id]: { ...current[lecture.id], is_visible: event.target.checked } }))} /> 對學生顯示</label>
                      <Link className="question-secondary-button compact" to={`/course/${selectedCourse.id}/lecture/${lecture.id}`}>預覽</Link>
                      <Link className="question-secondary-button compact" to={`/teacher/questions?lecture=${lecture.id}`}>前往審題</Link>
                      {content.transcript && <button type="button" className="question-secondary-button compact" onClick={() => setOpenTranscriptId(current => current === lecture.id ? null : lecture.id)}>{openTranscriptId === lecture.id ? '收合逐字稿' : '編輯逐字稿'}</button>}
                      <button type="button" className="question-save-button compact" disabled={Boolean(busyKey)} onClick={() => saveLecture(lecture.id)}>{busyKey === `lecture-${lecture.id}` ? '儲存中...' : '儲存小節'}</button>
                      <button type="button" className="course-delete-button compact" disabled={Boolean(busyKey)} onClick={() => deleteLecture(lecture)}>{busyKey === `delete-lecture-${lecture.id}` ? '刪除中...' : '刪除小節'}</button>
                      {isYouTubeUrl(lecture.media_url) && <button type="button" className="question-secondary-button compact" disabled={Boolean(busyKey) || ['pending', 'processing'].includes(lecture.backup_status)} onClick={() => requestBackup(lecture)}>{busyKey === `backup-${lecture.id}` ? '啟動中...' : lecture.backup_status === 'completed' ? '重新備份' : '備份影片'}</button>}
                      {hasFailedGeneration && <button type="button" className="question-secondary-button compact" disabled={Boolean(busyKey)} onClick={() => retryFailed(lecture)}>{busyKey === `retry-${lecture.id}` ? '重試中...' : '重新執行失敗項目'}</button>}
                    </div>
                    {openTranscriptId === lecture.id && <div className="managed-transcript-editor"><label className="review-field"><span>逐字稿內容</span><textarea rows={10} value={lectureForm.transcript_content || ''} onChange={event => setLectureForms(current => ({ ...current, [lecture.id]: { ...current[lecture.id], transcript_content: event.target.value } }))} /><small>若內容包含（分:秒）時間標記，儲存後會保留為可供 AI 使用的時間片段。</small></label><button type="button" className="question-save-button compact" disabled={!lectureForm.transcript_content?.trim() || Boolean(busyKey)} onClick={() => saveTranscript(lecture.id)}>{busyKey === `transcript-${lecture.id}` ? '儲存中...' : '儲存逐字稿'}</button></div>}
                  </div>
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
