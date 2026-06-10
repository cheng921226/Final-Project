import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';

const API_URL = 'http://127.0.0.1:8000';
const STUDENT_ID = 2; // 暫時寫死，登入功能完成後替換

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
        const progressResults = await Promise.all(
          lectureList.map(async (lecture) => {
            try {
              const pRes = await fetch(
                `${API_URL}/video_progresses/${lecture.id}?student_id=${STUDENT_ID}`
              );
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
    <div className="min-h-screen bg-slate-50 p-8">
      <header className="max-w-4xl mx-auto mb-8 flex justify-between items-center">
        <div>
          <Link to="/" className="text-blue-500 text-sm hover:underline">← 返回課程列表</Link>
          <h1 className="text-2xl font-bold text-slate-800 mt-1">課程小節</h1>
          <p className="text-slate-500 text-sm">選擇你要學習的小節</p>
        </div>
        <div className="bg-white px-4 py-2 rounded-full shadow-sm text-sm font-medium">
          使用者：Jun-Cheng
        </div>
      </header>

      <main className="max-w-4xl mx-auto">
        {loading ? (
          <p className="text-slate-500">正在載入小節列表...</p>
        ) : error ? (
          <p className="text-red-500">{error}</p>
        ) : lectures.length === 0 ? (
          <p className="text-slate-500">尚無小節資料</p>
        ) : (
          <div className="grid gap-4">
            {lectures.map((lecture, index) => {
              const progress = getProgressDisplay(lecture);
              return (
                <Link to={`/course/${id}/lecture/${lecture.id}`} key={lecture.id}>
                  <div className="bg-white p-5 rounded-2xl shadow-sm hover:shadow-md border border-slate-100 hover:border-blue-300 transition-all group">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        {/* 編號 */}
                        <span className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 font-bold flex items-center justify-center text-sm flex-shrink-0">
                          {index + 1}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-slate-800 group-hover:text-blue-600 transition-colors">
                              {lecture.course_name ?? lecture.title ?? `第 ${index + 1} 小節`}
                            </h3>
                            {/* 完成勾勾 */}
                            {progress?.completed && (
                              <span className="flex items-center justify-center w-5 h-5 bg-green-100 rounded-full flex-shrink-0" title="已完成">
                                <svg className="w-3 h-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              </span>
                            )}
                          </div>
                          <p className="text-slate-500 text-sm">{lecture.status ?? ''}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 flex-shrink-0">
                        {/* 進度顯示 */}
                        {progress ? (
                          <div className="flex flex-col items-end gap-1">
                            <span className={`text-xs font-semibold ${progress.completed ? 'text-green-600' : 'text-slate-500'}`}>
                              {progress.completed ? '已完成' : `${progress.percent}%`}
                            </span>
                            {/* 進度條 */}
                            <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${progress.completed ? 'bg-green-500' : 'bg-blue-400'}`}
                                style={{ width: `${progress.percent}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-300">尚未觀看</span>
                        )}
                        <span className="text-slate-300 group-hover:text-blue-400 transition-colors text-lg">→</span>
                      </div>
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