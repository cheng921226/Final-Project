import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';

const API_URL = 'http://127.0.0.1:8000';
const COURSE_DETAIL_CACHE_TTL_MS = 60_000;
const courseDetailCache = new Map();

function CourseDetail() {
  const { id } = useParams();
  const token = localStorage.getItem('access_token');
  const cacheKey = `${id}:${token || 'anonymous'}`;
  const cachedCourseDetail = courseDetailCache.get(cacheKey);
  const [lectures, setLectures] = useState(cachedCourseDetail?.lectures || []);
  const [progressMap, setProgressMap] = useState(cachedCourseDetail?.progressMap || {});
  const [finalAssessment, setFinalAssessment] = useState(cachedCourseDetail?.finalAssessment || null);
  const [loading, setLoading] = useState(!cachedCourseDetail);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    async function fetchLectures() {
      try {
        const token = localStorage.getItem('access_token');
        const authOptions = token
          ? { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }
          : null;
        const [res, assessmentRes, progressRes] = await Promise.all([
          fetch(`${API_URL}/courses/${id}/lectures`, { signal: controller.signal }),
          authOptions
            ? fetch(`${API_URL}/courses/${id}/final-assessment`, authOptions)
            : Promise.resolve(null),
          authOptions
            ? fetch(`${API_URL}/courses/${id}/video-progresses`, authOptions)
            : Promise.resolve(null),
        ]);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const lectureList = Array.isArray(data) ? data : [];
        let nextProgressMap = {};
        let nextFinalAssessment = null;
        if (!token) {
          nextProgressMap = {};
        } else if (progressRes?.ok) {
          const rows = await progressRes.json();
          nextProgressMap = Object.fromEntries(
            (rows || []).map(progress => [progress.lecture_id, progress])
          );
        }
        if (assessmentRes?.ok) nextFinalAssessment = await assessmentRes.json();

        const courseDetail = {
          lectures: lectureList,
          progressMap: nextProgressMap,
          finalAssessment: nextFinalAssessment,
          fetchedAt: Date.now(),
        };
        courseDetailCache.set(cacheKey, courseDetail);
        if (!controller.signal.aborted) {
          setLectures(courseDetail.lectures);
          setProgressMap(courseDetail.progressMap);
          setFinalAssessment(courseDetail.finalAssessment);
          setError(null);
        }
      } catch (err) {
        if (err.name !== 'AbortError' && !controller.signal.aborted) {
          setError(err.message || '取得小節列表失敗');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    const cached = courseDetailCache.get(cacheKey);
    if (cached) {
      setLectures(cached.lectures);
      setProgressMap(cached.progressMap);
      setFinalAssessment(cached.finalAssessment);
      setLoading(false);
      setError(null);
      if (Date.now() - cached.fetchedAt < COURSE_DETAIL_CACHE_TTL_MS) {
        return () => controller.abort();
      }
    } else {
      setLectures([]);
      setProgressMap({});
      setFinalAssessment(null);
      setLoading(true);
      setError(null);
    }

    fetchLectures();
    return () => controller.abort();
  }, [cacheKey, id, token]);

  function getProgressDisplay(lecture) {
    const p = progressMap[lecture.id];
    if (!p) return null;

    const { watched_seconds, completed } = p;
    const duration = Number(lecture.duration_seconds);
    if (!watched_seconds || !duration) return { percent: 0, completed: !!completed };

    const percent = Math.min(Math.round((watched_seconds / duration) * 100), 100);
    return { percent, completed: !!completed };
  }

  return (
    <div className="detail-wrap">
      <header className="detail-heading">
        <Link to="/" className="back-link">← 返回所有課程</Link>
        <h1>課程學習地圖</h1>
        <p>按照自己的步調學習，每一小節都會自動保存觀看進度。</p>
      </header>

      <main>
        {error && lectures.length > 0 && (
          <div className="empty-card" role="alert">
            課程內容更新失敗，以下顯示最近載入的資料：{error}
          </div>
        )}
        {loading && !lectures.length ? (
          <div className="empty-card">正在整理課程內容...</div>
        ) : error && !lectures.length ? (
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
                          <p className="lecture-subtitle">
                            {lecture.status === 'failed' ? '影片上傳失敗' : '影片已上傳'}
                          </p>
                        </div>
                      </div>

                      <div className="lecture-state">
                        {progress ? (
                          <div>
                            <div className="progress-copy">
                              {progress.completed ? `已完成 · ${progress.percent}%` : `${progress.percent}%`}
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

            {finalAssessment && (
              <Link to={`/course/${id}/final-assessment`}>
                <div className={`lecture-card final-assessment-entry ${finalAssessment.state}`}>
                  <div className="lecture-info">
                    <span className="lecture-number final">✓</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="lecture-title">課程最終測驗</h3>
                        {finalAssessment.state === 'passed' && <span className="achievement-status certified">已完成</span>}
                      </div>
                      <p className="lecture-subtitle">
                        {finalAssessment.state === 'locked' && '完成課程內容後解鎖'}
                        {finalAssessment.state === 'unconfigured' && '教師尚未完成學分設定'}
                        {finalAssessment.state === 'not_ready' && '教師正在準備正式測驗'}
                        {finalAssessment.state === 'ready' && `已解鎖 · 通過標準 ${finalAssessment.settings.passing_score} 分`}
                        {finalAssessment.state === 'in_progress' && '測驗進行中'}
                        {finalAssessment.state === 'cooldown' && '等待重新測驗開放'}
                        {finalAssessment.state === 'passed' && '已通過並取得課程學分'}
                      </p>
                    </div>
                  </div>
                  <div className="lecture-state"><span className="card-arrow">→</span></div>
                </div>
              </Link>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default CourseDetail;
