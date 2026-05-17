import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MindMap } from '@ant-design/graphs';

const API_URL = 'http://127.0.0.1:8000';

function CourseDetail() {
  const { id } = useParams();
  const [summary, setSummary] = useState('');
  const [knowledgePoints, setKnowledgePoints] = useState([]);
  const [videoUrl, setVideoUrl] = useState('');
  const [mindmap, setMindmap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchCourseData() {
      try {
        // 取得課程資料（含影片網址）
        const lectureRes = await fetch(`${API_URL}/lectures/${id}`);
        if (lectureRes.ok) {
          const lectureData = await lectureRes.json();
          const raw = lectureData[0]?.media_url;
          if (raw) {
            try {
              const videoId = new URL(raw).searchParams.get('v');
              if (videoId) setVideoUrl(`https://www.youtube.com/embed/${videoId}`);
            } catch (e) {
              // 若網址格式有問題就略過
            }
          }
        }

        // 取得知識點
        const kpRes = await fetch(`${API_URL}/lectures/${id}/knowledge_points`);
        if (kpRes.ok) {
          const kpData = await kpRes.json();
          if (Array.isArray(kpData) && kpData.length > 0) {
            setKnowledgePoints(kpData);
          }
        }

        // 取得摘要
        const summaryRes = await fetch(`${API_URL}/lectures/${id}/summaries`);
        if (summaryRes.ok) {
          const summaryData = await summaryRes.json();
          if (summaryData?.summary_text) {
            try {
              const parsed = JSON.parse(summaryData.summary_text);
              setSummary(parsed.summary ?? summaryData.summary_text);
            } catch {
              setSummary(summaryData.summary_text);
            }
          }
        }

        // 取得心智圖
        const mmRes = await fetch(`${API_URL}/lectures/${id}/mindmaps`);
        if (mmRes.ok) {
          const mmData = await mmRes.json();
          if (mmData?.[0]?.mindmap_json?.mind_map) {
            setMindmap(mmData[0].mindmap_json.mind_map);
          }
        }
      } catch (err) {
        setError(err.message || '取得課程資料失敗');
      } finally {
        setLoading(false);
      }
    }
    fetchCourseData();
  }, [id]);

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <header className="max-w-7xl mx-auto mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">AI 輔助學習系統</h1>
          <p className="text-slate-500">課程：{id}</p>
        </div>
        <div className="bg-white px-4 py-2 rounded-full shadow-sm text-sm font-medium">
          使用者：Jun-Cheng
        </div>
      </header>

      <main className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* 影片播放區 */}
        <div className="lg:col-span-3 space-y-4">
          <div className="aspect-video bg-black rounded-2xl shadow-xl overflow-hidden border-4 border-white">
            {videoUrl ? (
              <iframe
                width="100%" height="100%"
                src={videoUrl}
                title="Course Video" frameBorder="0" allowFullScreen
              ></iframe>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-400">
                {loading ? '載入影片中...' : '無影片資料'}
              </div>
            )}
          </div>

          {/* 課程知識點 */}
          <div className="bg-white p-6 rounded-2xl shadow-sm">
            <h2 className="text-xl font-bold mb-4 flex items-center">
              <span className="bg-blue-100 text-blue-600 p-1 rounded mr-2">📚</span>
              課程知識點
            </h2>
            {loading ? (
              <p className="text-slate-500">正在載入知識點...</p>
            ) : error ? (
              <p className="text-red-500 text-sm">{error}</p>
            ) : (
              <div className="grid gap-3">
                {knowledgePoints.map((p, i) => (
                  <div key={i} className="p-4 bg-slate-50 rounded-xl border border-slate-100 hover:border-blue-300 transition-colors">
                    <h3 className="font-bold text-blue-700">{p.title}</h3>
                    <p className="text-slate-600 text-sm">{p.description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 心智圖 */}
          <div className="bg-white p-6 rounded-2xl shadow-sm">
            <h2 className="text-xl font-bold mb-4 flex items-center">
              <span className="bg-purple-100 text-purple-600 p-1 rounded mr-2">🗺️</span>
              心智圖
            </h2>
            {loading ? (
              <p className="text-slate-500">正在載入心智圖...</p>
            ) : mindmap ? (
              <MindMap data={mindmap} style={{ height: 400 }} />
            ) : (
              <p className="text-slate-400 text-sm">無心智圖資料</p>
            )}
          </div>
        </div>

        {/* 側邊欄：摘要與 AI 助教 */}
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border-t-4 border-blue-500">
            <h3 className="text-lg font-bold mb-2 flex items-center text-slate-800">
              ✨ AI 內容摘要
            </h3>
            <p className="text-slate-600 text-sm leading-relaxed">
              {summary}
            </p>
          </div>

          <div className="bg-slate-900 p-6 rounded-2xl shadow-lg text-white">
            <h3 className="text-lg font-bold mb-4 flex items-center">
              💬 AI 課程助教
            </h3>
            <div className="h-40 bg-slate-800 rounded-xl p-3 text-xs mb-4 overflow-y-auto">
              <div className="bg-slate-700 p-2 rounded mb-2">助教：你好，我是你的 AI 學習夥伴。</div>
              <div className="bg-blue-600 p-2 rounded ml-4 mb-2">學生：什麼是機器學習？</div>
              <div className="bg-slate-700 p-2 rounded">助教：機器學習是 AI 的一種方法，讓電腦從資料中學習規律。</div>
            </div>
            <div className="flex gap-2">
              <input className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs focus:outline-none" placeholder="輸入問題..." />
              <button className="bg-blue-500 hover:bg-blue-400 px-3 py-2 rounded-lg text-xs font-bold">送出</button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default CourseDetail;