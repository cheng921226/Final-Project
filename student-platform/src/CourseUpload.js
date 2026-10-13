import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

const API_URL = 'http://127.0.0.1:8000';

function courseOptionLabel(course) {
  const title = course.title || course.course_name || `課程 ${course.id}`;
  const teacher = course.assigned_teacher?.name
    || course.assigned_teacher?.email
    || '尚未指派';
  return `${title}｜${teacher}`;
}

function courseTitle(course) {
  return course.title || course.course_name || `課程 ${course.id}`;
}

export default function CourseUpload() {
  const token = localStorage.getItem('access_token');
  const [courses, setCourses] = useState([]);
  const [teacherId, setTeacherId] = useState(null);
  const [courseMode, setCourseMode] = useState('existing');
  const [courseId, setCourseId] = useState('');
  const [courseSearch, setCourseSearch] = useState('');
  const [courseMenuOpen, setCourseMenuOpen] = useState(false);
  const [activeCourseIndex, setActiveCourseIndex] = useState(0);
  const [newCourseTitle, setNewCourseTitle] = useState('');
  const [lectureTitle, setLectureTitle] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [modelSize, setModelSize] = useState('tiny');
  const [backupVideo, setBackupVideo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!token) {
      setError('請先使用教師或校園平台端帳號登入。');
      setLoading(false);
      return;
    }

    async function loadInitialData() {
      try {
        const [courseRes, idRes, roleRes] = await Promise.all([
          fetch(`${API_URL}/teacher/course-management`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${API_URL}/id`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${API_URL}/role`, { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        if (!roleRes.ok) throw new Error('無法確認帳號身分。');
        const role = await roleRes.json();
        if (!['teacher', 'campus'].includes(role.role)) {
          throw new Error('這個頁面只有教師或校園平台端帳號可以使用。');
        }
        if (!idRes.ok) throw new Error('無法取得老師資料。');
        if (!courseRes.ok) throw new Error('無法取得課程列表。');

        const idData = await idRes.json();
        const courseData = await courseRes.json();
        setTeacherId(idData.id);
        const ownCourses = courseData.courses || [];
        setCourses(ownCourses);
        setCourseId('');
        setCourseSearch('');
      } catch (err) {
        setError(err.message || '載入上傳資料失敗');
      } finally {
        setLoading(false);
      }
    }

    loadInitialData();
  }, [token]);

  const courseOptions = useMemo(() => {
    const keyword = courseSearch.trim().toLocaleLowerCase('zh-TW');
    return courses
      .filter(course => !keyword || courseTitle(course).toLocaleLowerCase('zh-TW').includes(keyword))
      .map(course => ({
        course,
        label: courseOptionLabel(course),
      }));
  }, [courseSearch, courses]);

  function searchCourse(value) {
    setCourseSearch(value);
    setCourseId('');
    setActiveCourseIndex(0);
    setCourseMenuOpen(true);
  }

  function selectCourse(course) {
    setCourseId(String(course.id));
    setCourseSearch(courseTitle(course));
    setCourseMenuOpen(false);
  }

  function handleCourseSearchKeyDown(event) {
    if (!courseMenuOpen && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      setCourseMenuOpen(true);
      return;
    }
    if (!courseOptions.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveCourseIndex(current => (current + 1) % courseOptions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveCourseIndex(current => (current - 1 + courseOptions.length) % courseOptions.length);
    } else if (event.key === 'Enter' && courseMenuOpen) {
      event.preventDefault();
      selectCourse(courseOptions[Math.min(activeCourseIndex, courseOptions.length - 1)].course);
    } else if (event.key === 'Escape') {
      setCourseMenuOpen(false);
    }
  }

  const canSubmit = useMemo(() => (
    lectureTitle.trim()
    && youtubeUrl.trim()
    && (courseMode === 'new' ? newCourseTitle.trim() : courseId)
    && !processing
  ), [courseId, courseMode, lectureTitle, newCourseTitle, processing, youtubeUrl]);

  async function createCourseIfNeeded() {
    if (courseMode === 'existing') return Number(courseId);

    const res = await fetch(`${API_URL}/courses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        title: newCourseTitle.trim(),
        teacher_id: teacherId,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || '新增課程失敗');
    }
    const course = await res.json();
    return course.id;
  }

  async function submitLecture(event) {
    event.preventDefault();
    if (!canSubmit) return;

    setProcessing(true);
    setError('');
    setResult(null);
    try {
      const targetCourseId = await createCourseIfNeeded();
      const res = await fetch(`${API_URL}/lectures`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: lectureTitle.trim(),
          media_url: youtubeUrl.trim(),
          course_id: targetCourseId,
          status: 'uploaded',
          auto_process: true,
          language: 'zh',
          model_size: modelSize,
          skip_existing_transcript: true,
          skip_existing_ai: true,
          backup_video: backupVideo,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.detail?.code === 'DUPLICATE_LECTURE' && body.detail?.lecture) {
          setResult({ duplicate: true, ...body.detail.lecture });
          throw new Error(body.detail.message);
        }
        const message = typeof body.detail === 'object'
          ? body.detail.message || JSON.stringify(body.detail)
          : body.detail;
        throw new Error(message || '新增小節或 AI 生成失敗');
      }
      setResult(body);
      setLectureTitle('');
      setYoutubeUrl('');
      setBackupVideo(false);
      if (courseMode === 'new') {
        setNewCourseTitle('');
        setCourseMode('existing');
      }
    } catch (err) {
      setError(err.message || '上傳課程失敗');
    } finally {
      setProcessing(false);
    }
  }

  if (loading) {
    return <div className="teacher-state"><div className="teacher-loader" /><p>正在準備上傳頁...</p></div>;
  }

  if (error && !courses.length && !teacherId) {
    return (
      <div className="teacher-state">
        <span className="teacher-state-icon">!</span>
        <h1>無法開啟上傳課程</h1>
        <p>{error}</p>
        <Link to="/login" className="primary-link">前往登入</Link>
      </div>
    );
  }

  return (
    <div className="teacher-page upload-page">
      <header className="teacher-hero">
        <div>
          <p className="eyebrow">Course upload</p>
          <h1>上傳課程</h1>
          <p>輸入 YouTube 連結後，後端會建立小節並自動產生逐字稿、摘要、知識點、心智圖與題目。</p>
        </div>
      </header>

      <form className="teacher-panel upload-form" onSubmit={submitLecture}>
        <div className="settings-switches segmented">
          <label><input type="radio" name="courseMode" checked={courseMode === 'existing'} onChange={() => setCourseMode('existing')} /> 選擇既有課程</label>
          <label><input type="radio" name="courseMode" checked={courseMode === 'new'} onChange={() => setCourseMode('new')} /> 建立新課程</label>
        </div>

        {courseMode === 'existing' ? (
          <div
            className="review-field searchable-course-field"
            onBlur={event => {
              if (!event.currentTarget.contains(event.relatedTarget)) setCourseMenuOpen(false);
            }}
          >
            <label htmlFor="course-search"><span>課程</span></label>
            <input
              id="course-search"
              type="search"
              role="combobox"
              aria-expanded={courseMenuOpen}
              aria-controls="course-search-results"
              aria-autocomplete="list"
              value={courseSearch}
              onFocus={() => setCourseMenuOpen(true)}
              onChange={event => searchCourse(event.target.value)}
              onKeyDown={handleCourseSearchKeyDown}
              placeholder="輸入課程名稱"
              autoComplete="off"
            />
            {courseMenuOpen && (
              <div id="course-search-results" className="course-search-results" role="listbox">
                {courseOptions.length ? courseOptions.map(({ course, label }, index) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={String(course.id) === String(courseId)}
                    className={index === activeCourseIndex ? 'active' : ''}
                    key={course.id}
                    onMouseEnter={() => setActiveCourseIndex(index)}
                    onClick={() => selectCourse(course)}
                  >
                    {label}
                  </button>
                )) : <p>找不到符合的課程</p>}
              </div>
            )}
          </div>
        ) : (
          <label className="review-field">
            <span>新課程名稱</span>
            <input value={newCourseTitle} onChange={event => setNewCourseTitle(event.target.value)} placeholder="例如：資料結構" />
          </label>
        )}

        <div className="settings-grid">
          <label className="review-field">
            <span>小節名稱</span>
            <input value={lectureTitle} onChange={event => setLectureTitle(event.target.value)} placeholder="例如：陣列與鏈結串列" />
          </label>
          <label className="review-field">
            <span>模型大小</span>
            <select value={modelSize} onChange={event => setModelSize(event.target.value)}>
              <option value="tiny">tiny：測試最快</option>
              <option value="base">base：品質較穩</option>
              <option value="small">small：較慢但更準</option>
            </select>
          </label>
        </div>

        <label className="review-field">
          <span>YouTube 連結</span>
          <input value={youtubeUrl} onChange={event => setYoutubeUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=..." />
        </label>

        <label className="visibility-toggle upload-backup-toggle">
          <input
            type="checkbox"
            checked={backupVideo}
            onChange={event => setBackupVideo(event.target.checked)}
          />
          下載並備份影片
          <small>備份會獨立處理；即使備份失敗，也不會中斷逐字稿與 AI 教材生成。</small>
        </label>

        {error && <p className="auth-error">{error}</p>}
        <div className="question-editor-actions">
          <button className="question-save-button" type="submit" disabled={!canSubmit}>
            {processing ? '正在產生 AI 資料...' : '建立並自動生成'}
          </button>
        </div>
      </form>

      {result?.duplicate ? (
        <section className="teacher-panel upload-result">
          <div className="panel-title"><div><h3>影片已存在</h3><p>此影片已存在於目前課程中，請直接前往原本小節重試失敗內容。</p></div></div>
          <Link className="primary-link inline-action" to={`/course/${result.course_id}/lecture/${result.id}`}>前往現有小節</Link>
        </section>
      ) : result && (
        <section className="teacher-panel upload-result">
          <div className="panel-title">
            <div>
              <h3>處理完成</h3>
              <p>資料已建立，AI pipeline 回傳狀態：{result.pipeline?.status || result.status}</p>
            </div>
          </div>
          <div className="achievement-meta">
            <span>小節 ID：{result.id}</span>
            <span>狀態：{result.status}</span>
            <span>逐字稿：{result.pipeline?.transcription?.saved_to_db ? '已寫入' : '使用既有資料或未寫入'}</span>
            <span>影片備份：{result.backup_status === 'pending' ? '已排入處理' : '未要求'}</span>
          </div>
          <Link className="primary-link inline-action" to={`/course/${result.course_id}/lecture/${result.id}`}>前往小節</Link>
        </section>
      )}
    </div>
  );
}
