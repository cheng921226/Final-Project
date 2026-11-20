import React, { useEffect, useMemo, useRef, useState } from 'react';
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

function formatPercent(value, fractionDigits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '尚無資料';
  }
  return `${Number((Number(value) * 100).toFixed(fractionDigits))}%`;
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
  const [retestLoading, setRetestLoading] = useState(false);
  const [retestSession, setRetestSession] = useState(null);
  const [retestQuestions, setRetestQuestions] = useState([]);
  const [retestAnswers, setRetestAnswers] = useState({});
  const [retestSubmitting, setRetestSubmitting] = useState(false);
  const [retestMessage, setRetestMessage] = useState('');
  const [retestResults, setRetestResults] = useState([]);
  const [practiceMastery, setPracticeMastery] = useState(null);
  const [wrongFilter, setWrongFilter] = useState('pending');
  const headingRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    async function fetchCourses() {
      setCourseLoading(true);
      setError('');
      try {
        const res = await fetch(`${API_URL}/courses`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: controller.signal,
        });
        if (!res.ok) throw new Error('無法取得課程清單');
        const data = await res.json();
        if (!controller.signal.aborted) {
          setCourses(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        if (!controller.signal.aborted) setError(err.message || '課程清單載入失敗');
      } finally {
        if (!controller.signal.aborted) setCourseLoading(false);
      }
    }

    fetchCourses();
    return () => controller.abort();
  }, [token]);

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
    if (!courseId) return;
    const controller = new AbortController();
    async function fetchReview() {
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
          signal: controller.signal,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (controller.signal.aborted) return;
          if ([401, 403, 404].includes(res.status)) setReviewData(null);
          throw new Error(typeof body.detail === 'string' ? body.detail : '無法取得複習資料');
        }
        const data = await res.json();
        if (controller.signal.aborted) return;
        setReviewData(data);
        setPracticeMastery(current => current && current.after === undefined
          ? { ...current, after: data.assessment?.mastery_rate ?? null }
          : current);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err.message || '複習資料載入失敗');
      } finally {
        if (!controller.signal.aborted) setReviewLoading(false);
      }
    }

    fetchReview();
    return () => controller.abort();
  }, [courseId, token, refreshKey]);

  const selectedCourse = useMemo(
    () => courses.find(course => String(course.id) === String(courseId)),
    [courses, courseId]
  );

  const courseTitle = selectedCourse?.title || selectedCourse?.course_name || reviewData?.title || '課程複習';

  const assessment = reviewData?.assessment;
  const wrongQuestions = reviewData?.wrong_questions || [];
  const pendingWrong = wrongQuestions.filter(item => item.retest_status !== 'mastered');
  const visibleWrong = wrongFilter === 'pending' ? pendingWrong : wrongQuestions;
  const answeredCount = Object.keys(retestAnswers).length;

  function clearRetest() {
    setRetestSession(null);
    setRetestQuestions([]);
    setRetestAnswers({});
  }

  function selectCourse(id) {
    setCourseId(id);
    setReviewData(null);
    setReviewLoading(Boolean(id && token));
    setError('');
    setResetMessage('');
    clearRetest();
    setRetestMessage('');
    setRetestResults([]);
    setPracticeMastery(null);
    setWrongFilter('pending');
    headingRef.current?.focus();
  }

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
      clearRetest();
      setRetestResults([]);
      setPracticeMastery(null);
      setRetestMessage('');
      setRefreshKey(key => key + 1);
    } catch (err) {
      setResetMessage(err.message || '重置測驗失敗');
    } finally {
      setResetting(false);
    }
  }

  async function startRetest() {
    if (!token || !courseId || retestLoading) return;
    setRetestLoading(true);
    setRetestMessage('');
    setRetestResults([]);
    setPracticeMastery(null);
    try {
      const res = await fetch(`${API_URL}/courses/${courseId}/review/retest/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || '無法開始重新測驗');
      }
      setRetestSession(data.session || null);
      setRetestQuestions(data.questions || []);
      setRetestAnswers({});
    } catch (err) {
      setRetestMessage(err.message || '開始重新測驗失敗');
    } finally {
      setRetestLoading(false);
    }
  }

  async function submitRetest() {
    if (!token || !retestSession?.id || retestSubmitting) return;
    if (retestQuestions.some(question => !retestAnswers[question.question_id])) {
      setRetestMessage('請完成所有題目後再送出。');
      return;
    }
    setRetestSubmitting(true);
    setRetestMessage('');
    try {
      const res = await fetch(`${API_URL}/review/retest-sessions/${retestSession.id}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          answers: retestQuestions.map(question => ({
            question_id: question.question_id,
            selected_answer: retestAnswers[question.question_id],
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409) {
          clearRetest();
          setRefreshKey(key => key + 1);
        }
        throw new Error(typeof data.detail === 'string' ? data.detail : '提交補充練習失敗');
      }
      const resultsById = new Map((data.results || []).map(result => [result.question_id, result]));
      setRetestResults(retestQuestions.flatMap(question => {
        const result = resultsById.get(question.question_id);
        return result ? [{ ...question, ...result }] : [];
      }));
      setPracticeMastery({ before: assessment?.mastery_rate ?? null });
      setRetestMessage(`補充練習正確率 ${formatPercent(data.retest_accuracy)}`);
      clearRetest();
      setRefreshKey(key => key + 1);
    } catch (err) {
      setRetestMessage(err.message || '提交重新測驗失敗');
    } finally {
      setRetestSubmitting(false);
    }
  }

  return (
    <div className="review-page">
      <header className="review-hero">
        <div>
          <Link to="/" className="back-link">← 返回首頁</Link>
          <p className="eyebrow">Review mode</p>
          <h1 ref={headingRef} tabIndex={-1}>個人化課程複習</h1>
          <p>依照你在整門課的錯題、作答紀錄與課程內容，整理推薦知識點、錯題回顧與重新測驗。</p>
        </div>

        {courseId && (
          <div className="review-course-actions">
            <button
              type="button"
              className="question-secondary-button"
              disabled={resetting || retestLoading || retestSubmitting}
              onClick={() => selectCourse('')}
            >
              更換課程
            </button>
            {userProfile?.email === 'teststudent@example.com' && (
              <button
                type="button"
                onClick={resetDemoCourseAttempts}
                disabled={resetting || retestLoading || retestSubmitting}
                className="review-reset-button"
              >
                {resetting ? '重置中...' : '重置本課測驗'}
              </button>
            )}
            {resetMessage && <small className="review-reset-message">{resetMessage}</small>}
          </div>
        )}
      </header>

      {courseLoading ? (
        <div className="empty-card">正在載入課程清單...</div>
      ) : error && !reviewData ? (
        <div className="empty-card" role="alert">
          {error}
          {courseId && <button type="button" className="question-secondary-button" onClick={() => setRefreshKey(key => key + 1)}>重試</button>}
        </div>
      ) : !courseId ? (
        <section aria-labelledby="review-course-title">
          <div className="section-heading">
            <h2 id="review-course-title">選擇課程</h2>
          </div>
          {courses.length ? (
            <div className="course-grid">
              {courses.map((course, index) => (
                <button
                  key={course.id}
                  type="button"
                  className={`course-link course-card review-course-card cover-theme-${index % 4}`}
                  aria-labelledby={`review-course-${course.id}`}
                  onClick={() => selectCourse(String(course.id))}
                >
                  <span className="course-cover" aria-hidden="true">
                    <i className="cover-art"><i /><i /><i /><i /></i>
                  </span>
                  <span className="course-card-body">
                    <strong id={`review-course-${course.id}`}>
                      {course.title || course.course_name || `課程 ${course.id}`}
                    </strong>
                    {course.teacher_name && <span className="course-meta">{course.teacher_name}</span>}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-card">目前沒有可複習的課程。</div>
          )}
        </section>
      ) : reviewLoading && !reviewData ? (
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
              <span>掌握率</span>
              <strong>{formatPercent(assessment?.mastery_rate, 2)}</strong>
              {assessment?.mastery_question_count > 0 && (
                <span>{assessment.mastered_questions}／{assessment.mastery_question_count} 題已掌握</span>
              )}
            </div>
            <div className="review-stat warning">
              <span>待訂正錯題</span>
              <strong>{reviewData.stats?.pending_wrong_count ?? pendingWrong.length}</strong>
            </div>
            <div className="review-stat primary">
              <span>待作答</span>
              <strong>{reviewData.stats?.unanswered_count ?? 0}</strong>
            </div>
          </section>

          <section className="review-panel review-practice-panel" aria-labelledby="review-practice-title">
            <div className="panel-title">
              <div>
                <h3 id="review-practice-title">下一步練習</h3>
                <p>{assessment?.mastery_question_count
                  ? `掌握目標 ${formatPercent(assessment.pass_threshold)}${assessment.passed ? '，已達標' : ''}。練習結果用於學習回饋。`
                  : '這門課目前沒有已發布的課堂題目。'}</p>
              </div>
              <div className="review-practice-actions">
                {reviewData.next_lecture_id && (
                  <Link className="question-secondary-button" to={`/course/${courseId}/lecture/${reviewData.next_lecture_id}#classroom-practice-title`}>
                    回課堂練習
                  </Link>
                )}
                {assessment?.needs_retest && !retestSession && (
                  <button type="button" className="question-save-button" onClick={startRetest} disabled={resetting || retestLoading || reviewLoading}>
                    {retestLoading ? '準備中…' : '開始補充練習'}
                  </button>
                )}
              </div>
            </div>
            {retestSession && (
              <div className="retest-panel">
                <p role="status">已作答 {answeredCount}／{retestQuestions.length} 題</p>
                <div className="review-question-list">
                  {retestQuestions.map(question => (
                    <fieldset key={question.question_id} className="review-question">
                      <legend>{question.question_text}</legend>
                      <div className="review-options retest-options">
                        {getQuestionOptions(question).map((option, index) => {
                          const value = String.fromCharCode(65 + index);
                          return (
                            <label key={value}>
                              <input
                                type="radio"
                                name={`retest-${question.question_id}`}
                                value={value}
                                disabled={retestSubmitting}
                                checked={retestAnswers[question.question_id] === value}
                                onChange={() => setRetestAnswers(current => ({
                                  ...current,
                                  [question.question_id]: value,
                                }))}
                              />
                              <span>{value}. {String(option).replace(/^[A-Z][.、:)）]\s*/i, '')}</span>
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  ))}
                </div>
                <div className="question-editor-actions">
                  <button type="button" className="question-save-button" onClick={submitRetest}
                    disabled={resetting || retestSubmitting || answeredCount !== retestQuestions.length}>
                    {retestSubmitting ? '送出中…' : '送出補充練習'}
                  </button>
                </div>
              </div>
            )}
            {retestMessage && <p role="status" className="review-practice-feedback">{retestMessage}</p>}
            {practiceMastery?.before != null && practiceMastery.after != null && (
              <p role="status">
                練習前掌握率 {formatPercent(practiceMastery.before, 2)} → 送出後 {formatPercent(practiceMastery.after, 2)}
              </p>
            )}
            {error && (
              <div role="alert">
                <p>{error}</p>
                <button type="button" className="question-secondary-button" onClick={() => setRefreshKey(key => key + 1)}>
                  重新讀取複習進度
                </button>
              </div>
            )}
            {retestResults.length > 0 && (
              <div className="review-question-list">
                {retestResults.map(result => (
                  <article key={result.question_id} className="review-question">
                    <strong>{result.is_correct ? '答對' : '答錯'} · {result.question_text}</strong>
                    <p>你的答案：{result.selected_answer} ／ 正確答案：{result.correct_answer}</p>
                    {result.explanation && <p>{result.explanation}</p>}
                  </article>
                ))}
              </div>
            )}
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
                      <div className="review-item-heading">
                        <strong>{point.title}</strong>
                        {point.lecture_id != null && point.start_time != null
                        && point.start_time !== '' && Number.isFinite(Number(point.start_time))
                        && Number(point.start_time) >= 0 && (
                          <Link
                            className="review-watch-segment fx-34"
                            to={`/course/${courseId}/lecture/${point.lecture_id}?t=${Number(point.start_time)}`}
                            aria-label={`前往：${point.title}`}
                          >
                            <span className="btn-label">前往</span>
                          </Link>
                        )}
                      </div>
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
                </div>
                <label className="review-field">
                  <span>顯示錯題</span>
                  <select value={wrongFilter} onChange={event => setWrongFilter(event.target.value)}>
                    <option value="pending">待訂正（{pendingWrong.length}）</option>
                    <option value="all">全部（{wrongQuestions.length}）</option>
                  </select>
                </label>
              </div>

              {visibleWrong.length ? (
                <div className="review-question-list">
                  {visibleWrong.map(item => (
                    <div key={item.question_id} className="review-question wrong">
                      <div>
                        <small>{lectureTitle(item.lecture)} {formatTime(item.source_timestamp) && `· ${formatTime(item.source_timestamp)}`}</small>
                        <strong>{item.question_text}</strong>
                        <p>首次作答：{item.selected_answer || '未記錄'} ／ 正確答案：{item.correct_answer || '未記錄'}</p>
                        {item.retest_status === 'mastered' && <p>補練後已掌握</p>}
                        {item.retest_status === 'needs_reinforcement' && <p>補練後仍需加強</p>}
                        {item.explanation && <p>{item.explanation}</p>}
                      </div>
                      {item.lecture_id && (
                        <Link to={`/course/${courseId}/lecture/${item.lecture_id}`}>回小節</Link>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="review-success">{wrongQuestions.length ? '目前沒有待訂正的錯題。' : '目前沒有錯題紀錄。'}</p>
              )}
            </article>
          </section>
        </>
      )}
    </div>
  );
}

export default ReviewMode;
