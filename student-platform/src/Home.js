import React, { useCallback, useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import LearningArtwork from './LearningArtwork';

const STATUS_LABELS = { published: '已發布', draft: '草稿', archived: '已封存' };

const API_URL = 'http://127.0.0.1:8000';
const COURSE_CACHE_TTL_MS = 60_000;
const courseListCache = new Map();

function Home({ token }) {
  const outletContext = useOutletContext();
  const user = outletContext?.user;
  const isTeacher = user?.role === 'teacher';
  const isCampus = user?.role === 'campus';
  const canViewStatus = Boolean(user && user.role !== 'student');
  const cacheIdentity = user?.email || user?.id || token || 'anonymous';
  const cacheKey = `${user?.role || 'unknown'}:${cacheIdentity}`;
  const cachedCourseList = courseListCache.get(cacheKey);
  const [courses, setCourses] = useState([]);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(!cachedCourseList);
  const [error, setError] = useState(null);

  const loadCourses = useCallback(async (searchKeyword = '', signal) => {
    const query = searchKeyword.trim();
    const publicUrl = `${API_URL}/courses${query ? `?keyword=${encodeURIComponent(query)}` : ''}`;
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    let publicCourses = [];
    let managedCourses = [];

    if (!isCampus) {
      const response = await fetch(publicUrl, { headers, signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      publicCourses = await response.json();
    }

    if (isTeacher || isCampus) {
      const response = await fetch(`${API_URL}/teacher/course-management`, {
        headers,
        signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const managementData = await response.json();
      managedCourses = managementData.courses || [];
      const actorId = managementData.actor?.id;
      managedCourses = managedCourses.map(item => ({
        ...item,
        canAnalyze: isCampus || (isTeacher && String(item.teacher_id) === String(actorId)),
      }));
    }

    const coursesById = new Map();
    publicCourses.forEach(item => {
      coursesById.set(String(item.id), { ...item, canAnalyze: false });
    });
    managedCourses.forEach(item => {
      coursesById.set(String(item.id), {
        ...item,
        teacher_name: item.assigned_teacher?.name || item.creator?.name || item.teacher_name,
      });
    });

    const normalizedKeyword = query.toLocaleLowerCase('zh-TW');
    return [...coursesById.values()]
      .filter(item => !normalizedKeyword || [
        item.title,
        item.course_name,
        item.teacher_name,
        item.teacher,
      ].some(value => String(value || '').toLocaleLowerCase('zh-TW').includes(normalizedKeyword)))
      .map(item => ({
        id: item.id?.toString() ?? item.course_name ?? item.title ?? 'unknown',
        title: item.course_name ?? item.title ?? '未命名課程',
        teacher: item.teacher ?? item.teacher_name ?? (item.teacher_id ? `講師 ${item.teacher_id}` : '未知講師'),
        status: item.status ?? '未設定狀態',
        canAnalyze: item.canAnalyze,
      }));
  }, [isCampus, isTeacher, token]);

  useEffect(() => {
    const controller = new AbortController();
    const cached = courseListCache.get(cacheKey);
    if (cached) {
      setCourses(cached.courses);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);
    if (cached && Date.now() - cached.fetchedAt < COURSE_CACHE_TTL_MS) {
      return () => controller.abort();
    }

    loadCourses('', controller.signal)
      .then(result => {
        courseListCache.set(cacheKey, { courses: result, fetchedAt: Date.now() });
        if (!controller.signal.aborted) setCourses(result);
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
  }, [cacheKey, loadCourses]);

  const searchCourses = async () => {
    try {
      setLoading(true);
      setError(null);
      setCourses(await loadCourses(keyword));
    } catch (err) {
      setError(err.message || '搜尋失敗');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-wrap home-page">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero-copy">
          <p className="eyebrow"><span className="eyebrow-dot" /> YOUR NEXT CHAPTER</p>
          <h1 id="home-title">讓每一份好奇，<br />成為<em>前進的力量。</em></h1>
          <p className="home-description">探索知識，連結想法。讓 AI 陪你釐清每個觀念，<br className="desktop-break" />以自己的步調，走出更清晰的學習路徑。</p>
          <a className="hero-explore" href="#course-library">探索課程 <span aria-hidden="true">↗</span></a>
        </div>
        <LearningArtwork />
      </section>
      <div className="learning-features" aria-label="平台學習特色">
        <div><span className="feature-symbol" aria-hidden="true">01</span><span>課程影片<small>循序漸進，掌握核心觀念</small></span></div>
        <div><span className="feature-symbol" aria-hidden="true">02</span><span>知識脈絡<small>摘要與心智圖，連結所學</small></span></div>
        <div><span className="feature-symbol" aria-hidden="true">03</span><span>AI 學習陪伴<small>即時提問，讓理解更深入</small></span></div>
      </div>

      <section id="course-library" className="course-library" aria-labelledby="library-title">
        <div className="library-toolbar">
          <div className="section-heading">
            <p className="eyebrow">THE COURSE COLLECTION</p>
            <h2 id="library-title">{token ? "我的學習空間" : "探索所有課程"}<span className="course-count">{courses.length}</span></h2>
            <p>下一個新發現，從這裡開始。</p>
          </div>
        <div className="search-panel">
          <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") searchCourses();
            }}
            placeholder="搜尋課程名稱、講師或知識點"
            aria-label="搜尋課程"
          />
          <button
            onClick={searchCourses}>搜尋
          </button>
        </div>
        </div>
        {error && courses.length > 0 && <div className="empty-card home-state home-error" role="alert"><strong>課程清單更新失敗，以下顯示最近載入的資料</strong><p>{error}</p></div>}
        {loading && !courses.length ? (
          <div className="empty-card home-state" role="status"><div className="teacher-loader" /><p>正在載入課程資料...</p></div>
        ) : error && !courses.length ? (
          <div className="empty-card home-state home-error" role="alert"><strong>暫時無法取得課程</strong><p>{error}</p></div>
        ) : courses.length === 0 ? (
          <div className="empty-card home-state"><strong>目前沒有符合的課程</strong><p>試試其他關鍵字，探索更多學習內容。</p></div>
        ) : (
          <div className="course-grid">
            {courses.map((course, index) => (
              <div className={`course-link cover-theme-${index % 4}`} key={course.id}>
                <div className="course-card">
                  <Link className="course-card-main" to={`/course/${course.id}`}>
                    <div className="course-cover">
                      <span className="cover-category">AI 輔助課程</span>
                      <div className="cover-art" aria-hidden="true"><i /><i /><i /><i /></div>
                      <span className="cover-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                      <span className="cover-caption" aria-hidden="true">EXPAND YOUR HORIZONS</span>
                    </div>
                    <div className="course-card-body">
                      <h3>{course.title}</h3>
                      <p className="course-meta"><span className="instructor-icon" aria-hidden="true">{course.teacher.charAt(0)}</span>{course.teacher}</p>
                    </div>
                  </Link>
                  <div className="course-card-footer">
                    {canViewStatus && <span className={`status-pill status-${course.status}`}>{STATUS_LABELS[course.status] || course.status}</span>}
                    {course.canAnalyze && <Link className="course-analysis-link" to={`/teacher?course=${encodeURIComponent(course.id)}`}>課程分析</Link>}
                    <Link className="course-enter" to={`/course/${course.id}`}>查看課程 <span aria-hidden="true">↗</span></Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <footer className="home-footer"><span>AI 輔助線上學習平台</span><span>保持好奇，持續前行。<span aria-hidden="true"> ↗</span></span></footer>
    </div>
  );
}

export default Home;
