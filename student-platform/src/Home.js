import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

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
    <div className="page-wrap">
      <section>
        <div className="search-panel">
          <span className="search-icon" aria-hidden="true">⌕</span>
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
      </section>

      <section>
        <div className="section-heading">
          <h2>{token ? "我的學習空間" : "探索所有課程"}</h2>
          <span>{courses.length > 0 ? `${courses.length} 門課程` : '找到適合你的學習內容'}</span>
        </div>
        {loading ? (
          <p className="text-slate-500">正在載入課程資料...</p>
        ) : error ? (
          <p className="text-red-500">{error}</p>
        ) : (
          <div className="course-grid">
            {courses.map(course => (
              <Link to={`/course/${course.id}`} key={course.id}>
                <div className="course-card">
                  <div className="course-cover"><span>AI 輔助課程</span></div>
                  <div className="course-card-body">
                    <h3>{course.title}</h3>
                    <p className="course-meta">{course.teacher}</p>
                    <span className="status-pill">{course.status}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default Home;
