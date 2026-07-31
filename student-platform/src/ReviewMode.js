import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

const API_URL = 'http://127.0.0.1:8000';

function formatTime(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) {
    return '';
  }
  const total = Math.max(0, Math.floor(Number(seconds)));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function getQuestionOptions(question) {
  const raw = question?.options_json;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') {
    return Object.entries(raw).map(([key, value]) => `${key}. ${value}`);
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed).map(([key, value]) => `${key}. ${value}`);
    }
  } catch {
    return [];
  }
  return [];
}

function lectureTitle(lecture) {
  return lecture?.title || lecture?.course_name || '未命名小節';
}

function ReviewMode() {
  const token = localStorage.getItem('access_token');
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState('');
  const [courseLoading, setCourseLoading] = useState(true);
  const [reviewData, setReviewData] = useState(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [userProfile, setUserProfile] = useState(null);
  const [resetting, setResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchCourses() {
      setCourseLoading(true);
      setError('');
      try {
        const res = await fetch(`${API_URL}/courses`);
        if (!res.ok) throw new Error('無法取得課程清單');
        const data = await res.json();
        const courseList = Array.isArray(data) ? data : [];
        setCourses(courseList);
        if (courseList.length > 0) {
          setCourseId(String(courseList[0].id));
        }
      } catch (err) {
        setError(err.message || '課程清單載入失敗');
      } finally {
        setCourseLoading(false);
      }
    }

    fetchCourses();
  }, []);

  useEffect(() => {
    async function fetchUserProfile() {
      if (!token) {
        setUserProfile(null);
        return;
      }

      try {
        const res = await fetch(`${API_URL}/name`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          setUserProfile(null);
          return;
        }
        const data = await res.json();
        setUserProfile(data);
      } catch {
        setUserProfile(null);
      }
    }

    fetchUserProfile();
  }, [token]);

  useEffect(() => {
    async function fetchReview() {
      if (!courseId) {
        setReviewData(null);
        return;
      }
      if (!token) {
        setReviewData(null);
        setError('請先登入，系統才能根據你的作答紀錄產生複習模式。');
        return;
      }

      setReviewLoading(true);
      setError('');
      try {
        const res = await fetch(`${API_URL}/courses/${courseId}/review`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            throw new Error('請重新登入後再查看複習模式。');
          }
          throw new Error('無法取得複習資料');
        }
        const data = await res.json();
        setReviewData(data);
      } catch (err) {
        setReviewData(null);
        setError(err.message || '複習資料載入失敗');
      } finally {
        setReviewLoading(false);
      }
    }

    fetchReview();
  }, [courseId, token, refreshKey]);

  const selectedCourse = useMemo(
    () => courses.find(course => String(course.id) === String(courseId)),
    [courses, courseId]
  );

  const courseTitle = selectedCourse?.title || selectedCourse?.course_name || reviewData?.title || '課程複習';

  async function resetDemoCourseAttempts() {
    if (!token || !courseId || resetting) return;
    setResetting(true);
    setResetMessage('');

    try {
      const res = await fetch(`${API_URL}/courses/${courseId}/question-attempts`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || '重置測驗失敗');
      }
      const data = await res.json();
      setResetMessage(`已重置 ${data.deleted_count ?? 0} 筆作答紀錄。`);
      setRefreshKey(key => key + 1);
    } catch (err) {
      setResetMessage(err.message || '重置測驗失敗');
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="review-page">
      <header className="review-hero">
        <div>
          <Link to="/" className="back-link">← 返回首頁</Link>
          <p className="eyebrow">Review mode</p>
          <h1>個人化課程複習</h1>
          <p>依照你在整門課的錯題、作答紀錄與課程內容，整理推薦知識點、錯題回顧與模擬題。</p>
        </div>

        <label className="review-course-picker">
          <span>選擇課程</span>
          <select
            value={courseId}
            onChange={(event) => setCourseId(event.target.value)}
            disabled={courseLoading || courses.length === 0}
          >
            {courses.map(course => (
              <option key={course.id} value={course.id}>
                {course.title || course.course_name || `課程 ${course.id}`}
              </option>
            ))}
          </select>
          {userProfile?.email === 'teststudent@example.com' && (
            <button
              type="button"
              onClick={resetDemoCourseAttempts}
              disabled={resetting || !courseId}
              className="review-reset-button"
            >
              {resetting ? '重置中...' : '重置本課測驗'}
            </button>
          )}
          {resetMessage && (
            <small className="review-reset-message">{resetMessage}</small>
          )}
        </label>
      </header>

      {courseLoading ? (
        <div className="empty-card">正在載入課程清單...</div>
      ) : error ? (
        <div className="empty-card">{error}</div>
      ) : reviewLoading ? (
        <div className="empty-card">正在整理 {courseTitle} 的複習內容...</div>
      ) : !reviewData ? (
        <div className="empty-card">尚無複習資料</div>
      ) : (
        <>
          <section className="review-overview">
            <div>
              <p>目前課程</p>
              <h2>{courseTitle}</h2>
              <span>{reviewData.stats?.lecture_count ?? 0} 個小節 · {reviewData.stats?.question_count ?? 0} 題可練習</span>
            </div>
            <div className="review-stat">
              <span>作答紀錄</span>
              <strong>{reviewData.stats?.attempt_count ?? 0}</strong>
            </div>
            <div className="review-stat warning">
              <span>待訂正錯題</span>
              <strong>{reviewData.stats?.wrong_count ?? 0}</strong>
            </div>
            <div className="review-stat primary">
              <span>推薦知識點</span>
              <strong>{reviewData.stats?.recommended_count ?? 0}</strong>
            </div>
          </section>

          <section className="review-grid">
            <article className="review-panel">
              <div className="panel-title">
                <div>
                  <h3>推薦複習知識點</h3>
                  <p>優先看錯題相關概念，沒有錯題時會列出課程主要知識點。</p>
                </div>
              </div>

              {(reviewData.recommended_knowledge_points || []).length === 0 ? (
                <p className="teacher-empty compact">目前沒有可推薦的知識點。</p>
              ) : (
                <div className="review-list">
                  {reviewData.recommended_knowledge_points.map(point => (
                    <div key={`${point.lecture_id}-${point.id}`} className="review-item">
                      <small>{lectureTitle(point.lecture)}</small>
                      <strong>{point.title}</strong>
                      <p>{point.description}</p>
                      <em>{point.reason}</em>
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="review-panel">
              <div className="panel-title">
                <div>
                  <h3>重點整理</h3>
                  <p>把整門課的摘要合併成複習提示。</p>
                </div>
              </div>
              <div className="review-summary-box">
                <strong>{reviewData.summary_review?.suggestion}</strong>
                {reviewData.summary_review?.summary ? (
                  <p>{reviewData.summary_review.summary}</p>
                ) : (
                  <p>這門課目前還沒有摘要資料。</p>
                )}
              </div>
            </article>
          </section>

          <section className="review-grid review-grid-wide">
            <article className="review-panel">
              <div className="panel-title">
                <div>
                  <h3>錯題回顧</h3>
                  <p>只整理你目前最後一次作答仍錯的題目。</p>
                </div>
                <span className="table-count">{reviewData.wrong_questions?.length ?? 0} 題</span>
              </div>

              {(reviewData.wrong_questions || []).length === 0 ? (
                <p className="review-success">目前沒有未訂正錯題，可以直接做下方模擬題確認理解。</p>
              ) : (
                <div className="review-question-list">
                  {reviewData.wrong_questions.map(item => (
                    <div key={item.question_id} className="review-question wrong">
                      <div>
                        <small>{lectureTitle(item.lecture)} {formatTime(item.source_timestamp) && `· ${formatTime(item.source_timestamp)}`}</small>
                        <strong>{item.question_text}</strong>
                        <p>你的答案：{item.selected_answer || '未記錄'} / 正確答案：{item.correct_answer || '未記錄'}</p>
                        {item.explanation && <p>{item.explanation}</p>}
                      </div>
                      {item.lecture_id && (
                        <Link to={`/course/${courseId}/lecture/${item.lecture_id}`}>回小節</Link>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </article>
          </section>

          <section className="review-grid review-grid-wide">
            <article className="review-panel">
              <div className="panel-title">
                <div>
                  <h3>模擬題練習</h3>
                  <p>優先列出尚未作答的題目，若都答過則列出課程題目供複習。</p>
                </div>
                <span className="table-count">{reviewData.mock_questions?.length ?? 0} 題</span>
              </div>

              {(reviewData.mock_questions || []).length === 0 ? (
                <p className="teacher-empty compact">這門課目前沒有題目資料。</p>
              ) : (
                <div className="review-question-list">
                  {reviewData.mock_questions.map(item => (
                    <div key={item.question_id} className="review-question">
                      <small>{lectureTitle(item.lecture)} {formatTime(item.source_timestamp) && `· ${formatTime(item.source_timestamp)}`}</small>
                      <strong>{item.question_text}</strong>
                      <div className="review-options">
                        {getQuestionOptions(item).map(option => (
                          <span key={`${item.question_id}-${option}`}>{option}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </section>
        </>
      )}
    </div>
  );
}

export default ReviewMode;
