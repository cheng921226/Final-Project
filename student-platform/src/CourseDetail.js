import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import Tree from 'react-d3-tree';

const API_URL = 'http://127.0.0.1:8000';

// 將資料庫的 mind_map 格式轉成 react-d3-tree 需要的格式
function convertToD3Tree(node) {
  if (!node) return null;
  return {
    name: node.title,
    attributes: node.description ? { description: node.description } : undefined,
    children: node.children?.length > 0
      ? node.children.map(convertToD3Tree)
      : undefined,
  };
}

function CourseDetail() {
  const { id } = useParams();
  const [summary, setSummary] = useState('');
  const [knowledgePoints, setKnowledgePoints] = useState([]);
  const [videoUrl, setVideoUrl] = useState('');
  const [mindmap, setMindmap] = useState(null);
  const [lectures, setLectures] = useState([]);
  const [selectedLectureId, setSelectedLectureId] = useState(null);
  const [selectedLecture, setSelectedLecture] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const treeContainerRef = useRef(null);

  useEffect(() => {
    async function fetchLectureList() {
      setLoading(true);
      setError(null);
      try {
        const listRes = await fetch(`${API_URL}/courses/${id}/lectures`);
        if (!listRes.ok) {
          throw new Error(`HTTP ${listRes.status}`);
        }
        const listData = await listRes.json();
        if (Array.isArray(listData)) {
          setLectures(listData);
          const firstLectureId = listData[0]?.id;
          setSelectedLectureId(firstLectureId ?? null);
          setSelectedLecture(listData[0] ?? null);
        } else {
          setLectures([]);
          setSelectedLectureId(null);
          setSelectedLecture(null);
        }
      } catch (err) {
        setError(err.message || '取得課程章節列表失敗');
      } finally {
        setLoading(false);
      }
    }

    fetchLectureList();
  }, [id]);

  useEffect(() => {
    if (!selectedLectureId) {
      return;
    }

    async function fetchSelectedLectureData() {
      setLoading(true);
      setError(null);
      setSummary('');
      setKnowledgePoints([]);
      setMindmap(null);
      setVideoUrl('');

      try {
        const lectureRes = await fetch(`${API_URL}/lectures/${selectedLectureId}`);
        if (lectureRes.ok) {
          const lectureData = await lectureRes.json();
          const raw = lectureData[0]?.media_url;
          if (raw) {
            try {
              const videoId = new URL(raw).searchParams.get('v');
              if (videoId) {
                setVideoUrl(`https://www.youtube.com/embed/${videoId}`);
              }
            } catch (e) {
              // 若網址格式有問題就略過
            }
          }
        }

        const kpRes = await fetch(`${API_URL}/lectures/${selectedLectureId}/knowledge_points`);
        if (kpRes.ok) {
          const kpData = await kpRes.json();
          if (Array.isArray(kpData)) {
            setKnowledgePoints(kpData);
          }
        }

        const summaryRes = await fetch(`${API_URL}/lectures/${selectedLectureId}/summaries`);
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

        const mmRes = await fetch(`${API_URL}/lectures/${selectedLectureId}/mindmaps`);
        if (mmRes.ok) {
          const mmData = await mmRes.json();
          if (mmData?.[0]?.mindmap_json?.mind_map) {
            setMindmap(convertToD3Tree(mmData[0].mindmap_json.mind_map));
          }
        }
      } catch (err) {
        setError(err.message || '取得小節資料失敗');
      } finally {
        setLoading(false);
      }
    }

    fetchSelectedLectureData();
  }, [selectedLectureId]);

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
          <div className="bg-white p-6 rounded-2xl shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold">影片章節</h2>
                <p className="text-slate-500 text-sm">選擇你要觀看的小節，頁面會自動載入該小節的摘要、知識點與心智圖。</p>
              </div>
              <span className="text-sm text-slate-500">共 {lectures.length} 個小節</span>
            </div>
            {loading && lectures.length === 0 ? (
              <p className="text-slate-500">正在載入小節列表...</p>
            ) : error && lectures.length === 0 ? (
              <p className="text-red-500">{error}</p>
            ) : lectures.length === 0 ? (
              <p className="text-slate-500">尚無小節資料</p>
            ) : (
              <div className="grid gap-3">
                {lectures.map((lecture, index) => {
                  const lectureTitle = lecture.title || lecture.name || `第 ${index + 1} 小節`;
                  const isActive = lecture.id === selectedLectureId;
                  return (
                    <button
                      key={lecture.id}
                      type="button"
                      onClick={() => {
                        setSelectedLectureId(lecture.id);
                        setSelectedLecture(lecture);
                      }}
                      className={`w-full text-left p-4 rounded-2xl border transition-all ${isActive ? 'border-blue-500 bg-blue-50 shadow-sm' : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-slate-100'}`}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="font-semibold text-slate-800">{lectureTitle}</p>
                          {lecture.description ? (
                            <p className="text-sm text-slate-500 mt-1 line-clamp-2">{lecture.description}</p>
                          ) : null}
                        </div>
                        <span className={`text-xs px-2 py-1 rounded-full ${isActive ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                          小節 {index + 1}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

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
              <div ref={treeContainerRef} style={{ width: '100%', height: '450px' }}>
                <Tree
                  data={mindmap}
                  orientation="horizontal"
                  pathFunc="step"
                  translate={{ x: 120, y: 225 }}
                  nodeSize={{ x: 200, y: 60 }}
                  separation={{ siblings: 1.2, nonSiblings: 1.5 }}
                  renderCustomNodeElement={({ nodeDatum }) => (
                    <g>
                      <rect
                        x="-60" y="-18"
                        width="120" height="36"
                        rx="8"
                        fill={nodeDatum.children ? '#dbeafe' : '#f1f5f9'}
                        stroke={nodeDatum.children ? '#3b82f6' : '#cbd5e1'}
                        strokeWidth="1.5"
                      />
                      <text
                        textAnchor="middle"
                        dominantBaseline="middle"
                        style={{ fontSize: '12px', fill: '#1e3a5f', fontWeight: nodeDatum.children ? 'bold' : 'normal' }}
                      >
                        {nodeDatum.name}
                      </text>
                    </g>
                  )}
                />
              </div>
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