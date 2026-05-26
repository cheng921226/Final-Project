import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';

const API_URL = 'http://127.0.0.1:8000';

function CourseDetail() {
  const { id } = useParams();
  const [lectures, setLectures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchLectures() {
      try {
        const res = await fetch(`${API_URL}/courses/${id}/lectures`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setLectures(Array.isArray(data) ? data : []);
      } catch (err) {
        setError(err.message || '取得小節列表失敗');
      } finally {
        setLoading(false);
      }
    }
    fetchLectures();
  }, [id]);

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
            {lectures.map((lecture, index) => (
              <Link
                to={`/course/${id}/lecture/${lecture.id}`}
                key={lecture.id}
              >
                <div className="bg-white p-5 rounded-2xl shadow-sm hover:shadow-md border border-slate-100 hover:border-blue-300 transition-all flex items-center justify-between group">
                  <div className="flex items-center gap-4">
                    <span className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 font-bold flex items-center justify-center text-sm flex-shrink-0">
                      {index + 1}
                    </span>
                    <div>
                      <h3 className="font-bold text-slate-800 group-hover:text-blue-600 transition-colors">
                        {lecture.course_name ?? lecture.title ?? `第 ${index + 1} 小節`}
                      </h3>
                      <p className="text-slate-500 text-sm">
                        {lecture.status ?? ''}
                      </p>
                    </div>
                  </div>
                  <span className="text-slate-300 group-hover:text-blue-400 transition-colors text-lg">→</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export default CourseDetail;