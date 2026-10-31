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
  const [sourceMode, setSourceMode] = useState('youtube');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [videoFile, setVideoFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [modelSize, setModelSize] = useState('small');
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
    && (sourceMode === 'youtube' ? youtubeUrl.trim() : videoFile)
    && (courseMode === 'new' ? newCourseTitle.trim() : courseId)
    && !processing
  ), [courseId, courseMode, lectureTitle, newCourseTitle, processing, sourceMode, videoFile, youtubeUrl]);

  function uploadLocalVideo(targetCourseId) {
    const form = new FormData();
    form.append('title', lectureTitle.trim());
    form.append('course_id', String(targetCourseId));
    form.append('file', videoFile);
    form.append('language', 'zh');
    form.append('model_size', modelSize);
    form.append('auto_process', 'true');

    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('POST', `${API_URL}/lectures/upload`);
      request.setRequestHeader('Authorization', `Bearer ${token}`);
      request.upload.onprogress = event => {
        if (event.lengthComputable) {
          setUploadProgress(Math.round((event.loaded / event.total) * 100));
        }
      };
      request.onerror = () => reject(new Error('無法連線至後端，影片上傳失敗'));
      request.onload = () => {
        let body = {};
        try { body = JSON.parse(request.responseText || '{}'); } catch { }
        if (request.status >= 200 && request.status < 300) {
          resolve(body);
          return;
        }
        const detail = body.detail;
        const message = typeof detail === 'object'
          ? detail.message || JSON.stringify(detail)
          : detail;
        reject(new Error(message || '本機影片上傳失敗'));
      };
      request.send(form);
    });
  }

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
    setUploadProgress(0);
    setError('');
    setResult(null);
    try {
      const targetCourseId = await createCourseIfNeeded();
      if (sourceMode === 'upload') {
        const body = await uploadLocalVideo(targetCourseId);
        setResult({ ...body, course_id: body.course_id ?? targetCourseId });
        setLectureTitle('');
        setVideoFile(null);
        setUploadProgress(100);
        if (courseMode === 'new') {
          setNewCourseTitle('');
          setCourseMode('existing');
        }
        return;
      }
      const submitPayload = async overwriteExisting => {
        const response = await fetch(`${API_URL}/lectures`, {
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
            overwrite_existing: overwriteExisting,
          }),
        });
        return { response, body: await response.json().catch(() => ({})) };
      };

      let { response: res, body } = await submitPayload(false);
      if (!res.ok) {
        if (body.detail?.code === 'DUPLICATE_LECTURE' && body.detail?.lecture) {
          setResult({ duplicate: true, ...body.detail.lecture });
          const shouldOverwrite = window.confirm(
            `「${body.detail.lecture.title}」使用相同影片。要覆蓋原有小節嗎？\n\n已完成的教材與學生學習紀錄會保留，只會更新小節資料並重新處理缺少或失敗的內容。`
          );
          if (!shouldOverwrite) return;
          ({ response: res, body } = await submitPayload(true));
        }
      }
      if (!res.ok) {
        const message = typeof body.detail === 'object'
          ? body.detail.message || JSON.stringify(body.detail)
          : body.detail;
        throw new Error(message || '新增小節或 AI 生成失敗');
      }
      setResult({ ...body, course_id: body.course_id ?? targetCourseId });
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
          <p>選擇 YouTube 或本機影片，後端會共用同一套流程產生逐字稿、摘要、知識點、心智圖與題目。</p>
        </div>
      </header>

      <form className="teacher-panel upload-form" onSubmit={submitLecture}>
        <div className="settings-switches segmented">
          <label><input type="radio" name="courseMode" checked={courseMode === 'existing'} onChange={() => setCourseMode('existing')} /> 選擇既有課程</label>
          <label><input type="radio" name="courseMode" checked={courseMode === 'new'} onChange={() => setCourseMode('new')} /> 建立新課程</label>
        </div>

        <div className="settings-switches segmented upload-source-switch" aria-label="影片來源">
          <label><input type="radio" name="sourceMode" checked={sourceMode === 'youtube'} onChange={() => setSourceMode('youtube')} /> YouTube 連結</label>
          <label><input type="radio" name="sourceMode" checked={sourceMode === 'upload'} onChange={() => setSourceMode('upload')} /> 本機影片</label>
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
              <option value="small">small：較慢但更準（預設）</option>
              <option value="tiny">tiny：測試最快</option>
              <option value="base">base：品質較穩</option>
            </select>
          </label>
        </div>

        {sourceMode === 'youtube' ? (
          <>
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
          </>
        ) : (
          <label className="review-field upload-file-field">
            <span>影片檔案</span>
            <input
              type="file"
              accept="video/mp4,video/webm,.mp4,.webm"
              onChange={event => setVideoFile(event.target.files?.[0] || null)}
            />
            <small>支援 MP4、WebM；目前單檔上限 48 MB。</small>
          </label>
        )}

        {sourceMode === 'upload' && processing && (
          <div className="upload-progress" aria-live="polite">
            <div className="upload-progress-label"><span>影片上傳進度</span><strong>{uploadProgress}%</strong></div>
            <div className="upload-progress-track"><span style={{ width: `${uploadProgress}%` }} /></div>
          </div>
        )}

        {error && <p className="auth-error">{error}</p>}
        <div className="question-editor-actions">
          <button className="question-save-button" type="submit" disabled={!canSubmit}>
            {processing ? (sourceMode === 'upload' && uploadProgress < 100 ? '正在上傳影片...' : '正在建立教材...') : '建立並自動生成'}
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
              <h3>{result.overwritten ? '原有小節已覆蓋' : result.pipeline?.status === 'processing' ? '教材正在背景產生' : '處理完成'}</h3>
              <p>{result.pipeline?.message || `AI pipeline 回傳狀態：${result.pipeline?.status || result.status}`}</p>
            </div>
          </div>
          <div className="achievement-meta">
            <span>小節 ID：{result.id}</span>
            <span>狀態：{result.status}</span>
            <span>逐字稿：{result.pipeline?.status === 'processing' ? '處理中' : result.pipeline?.transcription?.saved_to_db ? '已寫入' : '使用既有資料或未寫入'}</span>
            <span>影片來源：{result.media_source === 'upload' ? '本機上傳' : 'YouTube'}</span>
            {result.media_source !== 'upload' && <span>影片備份：{result.backup_status === 'pending' ? '已排入處理' : '未要求'}</span>}
          </div>
          <Link className="primary-link inline-action" to={`/course/${result.course_id}/lecture/${result.id}`}>前往小節</Link>
          <Link className="secondary-button inline-action" to={`/teacher/courses?course=${result.course_id}`}>前往課程管理查看進度</Link>
        </section>
      )}
    </div>
  );
}
