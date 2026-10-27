import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import LearningArtwork from './LearningArtwork';

const STATUS_LABELS = { published: '已發布', draft: '草稿', archived: '已封存' };

const API_URL = 'http://127.0.0.1:8000';

function Home({ token }) {
  const [courses, setCourses] = useState([]);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    async function fetchCourses() {
      try {
        const response = await fetch(`${API_URL}/courses`, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          setCourses(data.map(item => ({
            id: item.id?.toString() ?? item.course_name ?? item.title ?? 'unknown',
            title: item.course_name ?? item.title ?? '未命名課程',
            teacher: item.teacher ?? item.teacher_name ?? (item.teacher_id ? `講師 ${item.teacher_id}` : '未知講師'),
            status: item.status ?? '未設定狀態',
          })));
        }
      } catch (err) {
        if (err.name !== 'AbortError') setError(err.message || '取得課程失敗');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    fetchCourses();
    return () => controller.abort();
  }, [token]);

  const searchCourses = async () => {
    try {
      setLoading(true);

      const res = await fetch(
        `${API_URL}/courses?keyword=${keyword}`
      );

      if (!res.ok) {
        throw new Error("搜尋失敗");
      }

      const data = await res.json();

      setCourses(
        data.map(item => ({
          id: item.id?.toString() ?? item.course_name ?? item.title ?? 'unknown',
          title: item.course_name ?? item.title ?? '未命名課程',
          teacher: item.teacher ?? item.teacher_name ?? '未知講師',
          status: item.status ?? '未設定狀態',
        }))
      );

    } catch (err) {
      setError(err.message);
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
        {loading ? (
          <div className="empty-card home-state" role="status"><div className="teacher-loader" /><p>正在載入課程資料...</p></div>
        ) : error ? (
          <div className="empty-card home-state home-error" role="alert"><strong>暫時無法取得課程</strong><p>{error}</p></div>
        ) : courses.length === 0 ? (
          <div className="empty-card home-state"><strong>目前沒有符合的課程</strong><p>試試其他關鍵字，探索更多學習內容。</p></div>
        ) : (
          <div className="course-grid">
            {courses.map((course, index) => (
              <Link className={`course-link cover-theme-${index % 4}`} to={`/course/${course.id}`} key={course.id}>
                <div className="course-card">
                  <div className="course-cover">
                    <span className="cover-category">AI 輔助課程</span>
                    <div className="cover-art" aria-hidden="true"><i /><i /><i /><i /></div>
                    <span className="cover-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                    <span className="cover-caption" aria-hidden="true">EXPAND YOUR HORIZONS</span>
                  </div>
                  <div className="course-card-body">
                    <h3>{course.title}</h3>
                    <p className="course-meta"><span className="instructor-icon" aria-hidden="true">{course.teacher.charAt(0)}</span>{course.teacher}</p>
                    <div className="course-card-footer"><span className="status-pill">{STATUS_LABELS[course.status] || course.status}</span><span className="course-enter">查看課程 <span aria-hidden="true">↗</span></span></div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
      <footer className="home-footer"><span>AI 輔助線上學習平台</span><span>保持好奇，持續前行。<span aria-hidden="true"> ↗</span></span></footer>
    </div>
  );
}

export default Home;
