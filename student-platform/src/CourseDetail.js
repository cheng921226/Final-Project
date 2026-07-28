import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';

const API_URL = 'http://127.0.0.1:8000';

function CourseDetail() {
  const { id } = useParams();
  const [lectures, setLectures] = useState([]);
  const [progressMap, setProgressMap] = useState({}); // { lectureId: { watched_seconds, completed } }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchLectures() {
      try {
        const res = await fetch(`${API_URL}/courses/${id}/lectures`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const lectureList = Array.isArray(data) ? data : [];
        setLectures(lectureList);

        // 撈每個小節的觀看進度
        const token = localStorage.getItem('access_token');
        if (!token) {
          setProgressMap({});
          return;
        }
        const progressResults = await Promise.all(
          lectureList.map(async (lecture) => {
            try {
              const pRes = await fetch(`${API_URL}/video_progresses/${lecture.id}`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (!pRes.ok) return { id: lecture.id, data: null };
              const pData = await pRes.json();
              return { id: lecture.id, data: pData };
            } catch {
              return { id: lecture.id, data: null };
            }
          })
        );

        // 整理成 { lectureId: progressData } 的格式
        const map = {};
        progressResults.forEach(({ id: lectureId, data }) => {
          if (data) map[lectureId] = data;
        });
        setProgressMap(map);
      } catch (err) {
        setError(err.message || '取得小節列表失敗');
      } finally {
        setLoading(false);
      }
    }
    fetchLectures();
  }, [id]);

  function getProgressPercent(lecture) {
    const p = progressMap[lecture.id];
    if (!p || !p.watched_seconds) return 0;
    // 用 watched_seconds / last_position 估算，或直接看 completed
    // 如果有 total_duration 更準，這裡用 watched_seconds 跟 last_position 的比
    // 但資料庫沒存 total_duration，用 completed 判斷是否 >= 80%
    return p.watched_seconds;
  }

  function getProgressDisplay(lecture) {
    const p = progressMap[lecture.id];
    if (!p) return null;

    const { watched_seconds, completed, last_position } = p;

    // 用 last_position 當作影片總長的估算基礎
    // 若已完成直接顯示 100%，否則用 watched_seconds / last_position
    if (completed) {
      return { percent: 100, completed: true };
    }

    if (!watched_seconds || !last_position) return { percent: 0, completed: false };

    // watched_seconds 通常 <= last_position，用這個比值估算進度
    const percent = Math.min(Math.round((watched_seconds / last_position) * 100), 99);
    return { percent, completed: false };
  }

  return (
    <div className="detail-wrap">
      <header className="detail-heading">
        <Link to="/" className="back-link">← 返回所有課程</Link>
        <h1>課程學習地圖</h1>
        <p>按照自己的步調學習，每一小節都會自動保存觀看進度。</p>
      </header>

      <main>
        {loading ? (
          <div className="empty-card">正在整理課程內容...</div>
        ) : error ? (
          <div className="empty-card">暫時無法取得課程內容：{error}</div>
        ) : lectures.length === 0 ? (
          <div className="empty-card">這門課程目前還沒有小節內容。</div>
        ) : (
          <div className="lecture-list">
            {lectures.map((lecture, index) => {
              const progress = getProgressDisplay(lecture);
              return (
                <Link to={`/course/${id}/lecture/${lecture.id}`} key={lecture.id}>
                  <div className="lecture-card">
                      <div className="lecture-info">
                        <span className="lecture-number">
                          {index + 1}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="lecture-title">
                              {lecture.course_name ?? lecture.title ?? `第 ${index + 1} 小節`}
                            </h3>
                            {progress?.completed && (
                              <span className="flex items-center justify-center w-5 h-5 bg-green-100 rounded-full flex-shrink-0" title="已完成">
                                <svg className="w-3 h-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              </span>
                            )}
                          </div>
                          <p className="lecture-subtitle">{lecture.status || `第 ${index + 1} 個學習單元`}</p>
                        </div>
                      </div>

                      <div className="lecture-state">
                        {progress ? (
                          <div>
                            <div className="progress-copy">
                              {progress.completed ? '已完成' : `${progress.percent}%`}
                            </div>
                            <div className="progress-track">
                              <div
                                className={`progress-fill ${progress.completed ? 'done' : ''}`}
                                style={{ width: `${progress.percent}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          <span className="progress-copy">尚未觀看</span>
                        )}
                        <span className="card-arrow">→</span>
                      </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

export default CourseDetail;
