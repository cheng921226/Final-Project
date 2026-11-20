import React, { useCallback, useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import CourseSearchBar from './CourseSearchBar';

const STATUS_LABELS = { published: '已發布', draft: '草稿', archived: '已封存' };

const API_URL = 'http://127.0.0.1:8000';
const COURSE_CACHE_TTL_MS = 60_000;
const courseListCache = new Map();

function normalizeCourse(course) {
  return {
    id: String(course.id),
    title: course.course_name ?? course.title ?? '未命名課程',
    teacher: course.teacher ?? course.teacher_name ?? (course.teacher_id ? `講師 ${course.teacher_id}` : '未知講師'),
    status: course.status ?? '未設定狀態',
    canAnalyze: Boolean(course.canAnalyze),
  };
}

function Home({ token }) {
  const outletContext = useOutletContext();
  const user = token ? outletContext?.user : null;
  const waitingForUser = Boolean(token && !user);
  const cacheIdentity = user?.email || user?.id || token || 'anonymous';
  const cacheKey = `${user?.role || 'unknown'}:${cacheIdentity}`;

  return <HomeCourseCatalog key={cacheKey} token={token} user={user} waitingForUser={waitingForUser} cacheKey={cacheKey} />;
}

function HomeCourseCatalog({ token, user, waitingForUser, cacheKey }) {
  const isTeacher = user?.role === 'teacher';
  const isCampus = user?.role === 'campus';
  const canViewStatus = Boolean(user && user.role !== 'student');
  const cachedCourseList = courseListCache.get(cacheKey);
  const [catalog, setCatalog] = useState(() => cachedCourseList?.catalog);
  const [view, setView] = useState(token ? 'mine' : 'all');
  const [keyword, setKeyword] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(!cachedCourseList);
  const [error, setError] = useState(null);

  const loadCourses = useCallback(async signal => {
    async function fetchCourses(path, authenticated = false) {
      const headers = authenticated ? { Authorization: `Bearer ${token}` } : {};
      const response = await fetch(`${API_URL}${path}`, { headers, signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }

    const [all, personal] = await Promise.all([
      fetchCourses('/courses'),
      isTeacher || isCampus
        ? fetchCourses('/teacher/course-management', true)
        : token ? fetchCourses('/courses', true) : null,
    ]);
    const actorId = personal?.actor?.id;
    const managed = (personal?.courses || []).map(course => ({
      ...course,
      canAnalyze: isCampus || (actorId != null && String(course.teacher_id) === String(actorId)),
      teacher_name: course.assigned_teacher?.name || course.creator?.name || course.teacher_name,
    }));

    return {
      all: all.map(normalizeCourse),
      mine: (Array.isArray(personal) ? personal : managed).map(normalizeCourse),
    };
  }, [isCampus, isTeacher, token]);

  useEffect(() => {
    if (waitingForUser) return undefined;
    const controller = new AbortController();
    const cached = courseListCache.get(cacheKey);
    if (cached) {
      setCatalog(cached.catalog);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);
    if (cached && Date.now() - cached.fetchedAt < COURSE_CACHE_TTL_MS) {
      return () => controller.abort();
    }

    loadCourses(controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        courseListCache.set(cacheKey, { catalog: result, fetchedAt: Date.now() });
        setCatalog(result);
      })
      .catch(err => {
        if (err.name !== 'AbortError' && !controller.signal.aborted) {
          setError(err.message || '取得課程失敗');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [cacheKey, loadCourses, waitingForUser]);

  const loginRequired = view === 'mine' && !token;
  const enrolledIds = new Set(catalog?.mine.map(course => course.id));
  const courses = (catalog?.[view] || []).filter(course =>
    [course.title, course.teacher].some(text => text.toLocaleLowerCase('zh-TW').includes(search))
  );

  return (
    <div className="page-wrap home-page">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero-copy">
          <h1 id="home-title">照自己的步調，<br />把課程學懂。</h1>
          <p className="home-description">看影片、整理重點，有問題就問 AI 助教。</p>
          <a className="hero-explore" href="#course-library" onClick={() => setView('all')}>瀏覽課程 <span aria-hidden="true">↓</span></a>
        </div>
      </section>

      <section id="course-library" className="course-library" aria-labelledby="library-title">
        <div className="home-catalog-switch" role="group" aria-label="課程清單">
          <button type="button" aria-pressed={view === 'all'} onClick={() => setView('all')}>所有課程</button>
          <button type="button" aria-pressed={view === 'mine'} onClick={() => setView('mine')}>我的學習空間</button>
        </div>
        <div className="library-toolbar">
          <div className="section-heading">
            <h2 id="library-title">
              {view === 'all' ? '所有課程' : '我的學習空間'}
              {!loginRequired && (!loading || courses.length > 0) && <span className="course-count">{courses.length}</span>}
            </h2>
          </div>
          {!loginRequired && (
            <CourseSearchBar
              value={keyword}
              onChange={setKeyword}
              onSearch={setSearch}
              placeholder="搜尋課程名稱或講師"
              disabled={waitingForUser}
            />
          )}
        </div>
        {loginRequired ? (
          <div className="empty-card home-state">
            <p>登入後即可查看你的課程。</p>
            <Link className="primary-link" to="/login">前往登入</Link>
          </div>
        ) : (
          <>
            {error && courses.length > 0 && <div className="empty-card home-state home-error" role="alert"><strong>課程清單更新失敗，以下顯示最近載入的資料</strong><p>{error}</p></div>}
            {loading && !courses.length ? (
              <div className="empty-card home-state" role="status"><div className="teacher-loader" /><p>正在載入課程資料...</p></div>
            ) : error && !courses.length ? (
              <div className="empty-card home-state home-error" role="alert"><strong>暫時無法取得課程</strong><p>{error}</p></div>
            ) : courses.length === 0 ? (
              <div className="empty-card home-state"><strong>{search ? '目前沒有符合的課程' : view === 'mine' ? '目前還沒有你的課程' : '目前沒有已發布的課程'}</strong></div>
            ) : (
              <div className="course-grid">
                {courses.map((course, index) => {
                  const canOpen = user?.role !== 'student' || enrolledIds.has(course.id);
                  const cardContent = (
                    <>
                      <div className="course-cover">
                        <div className="cover-art" aria-hidden="true"><i /><i /><i /><i /></div>
                      </div>
                      <div className="course-card-body">
                        <h3>{course.title}</h3>
                        <p className="course-meta"><span className="instructor-icon" aria-hidden="true">{course.teacher.charAt(0)}</span>{course.teacher}</p>
                      </div>
                    </>
                  );
                  return (
                    <div className={`course-link cover-theme-${index % 4}`} key={course.id}>
                      <div className="course-card">
                        {canOpen
                          ? <Link className="course-card-main" to={`/course/${course.id}`}>{cardContent}</Link>
                          : <div className="course-card-main">{cardContent}</div>}
                        <div className="course-card-footer">
                          {user?.role === 'student' && canOpen && (
                            <Link className="course-review-link" to={`/review?course=${encodeURIComponent(course.id)}`}>複習中心</Link>
                          )}
                          {view === 'mine' && canViewStatus && <span className={`status-pill status-${course.status}`}>{STATUS_LABELS[course.status] || course.status}</span>}
                          {course.canAnalyze && <Link className="course-analysis-link" to={`/teacher?course=${encodeURIComponent(course.id)}`}>課程分析</Link>}
                          {canOpen
                            ? <Link className="course-enter" to={`/course/${course.id}`}>查看課程 <span aria-hidden="true">↗</span></Link>
                            : <span className="course-enrollment-label">尚未選修</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>
      <footer className="home-footer"><span>AI 輔助線上學習平台</span></footer>
    </div>
  );
}

export default Home;
