import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import Tree from 'react-d3-tree';

const API_URL = 'http://127.0.0.1:8000';
const STUDENT_ID = 2; // 暫時寫死，之後登入功能完成後替換

function convertToD3Tree(node) {
  if (!node) return null;
  return {
    name: node.title,
    attributes: node.description ? { description: node.description } : undefined,
    children: node.children?.length > 0 ? node.children.map(convertToD3Tree) : undefined,
  };
}

function timeToSeconds(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

async function logEvent(lectureId, eventType, eventData) {
  try {
    await fetch(`${API_URL}/learning_events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_id: STUDENT_ID,
        lecture_id: parseInt(lectureId),
        event_type: eventType,
        event_data: eventData,
      }),
    });
  } catch (e) {
    // 靜默失敗，不影響使用者體驗
  }
}

function LectureDetail() {
  const { id, lectureId } = useParams();
  const [summary, setSummary] = useState('');
  const [knowledgePoints, setKnowledgePoints] = useState([]);
  const [videoId, setVideoId] = useState('');
  const [mindmap, setMindmap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const treeContainerRef = useRef(null);

  // YouTube IFrame API
  const playerRef = useRef(null);
  const playerContainerRef = useRef(null);
  const playerReadyRef = useRef(false);

  // 學習事件追蹤
  const lastPositionRef = useRef(0);
  const pauseCountRef = useRef(0);
  const watchedSegmentsRef = useRef([]); // [{start, end}]
  const segmentStartRef = useRef(0);
  const totalDurationRef = useRef(0);
  const trackingIntervalRef = useRef(null);

  // 聊天室
  const [chatMessages, setChatMessages] = useState([
    { role: 'assistant', text: '你好，我是你的 AI 學習夥伴。有任何問題都可以問我！' }
  ]);
  const [chatInput, setChatInput] = useState('');

  // 載入課程資料
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const lectureRes = await fetch(`${API_URL}/lectures/${lectureId}`);
        if (lectureRes.ok) {
          const lectureData = await lectureRes.json();
          const raw = lectureData[0]?.media_url;
          if (raw) {
            try {
              const vid = new URL(raw).searchParams.get('v');
              if (vid) setVideoId(vid);
            } catch (e) {}
          }
        }

        const kpRes = await fetch(`${API_URL}/lectures/${lectureId}/knowledge_points`);
        if (kpRes.ok) {
          const kpData = await kpRes.json();
          if (Array.isArray(kpData)) setKnowledgePoints(kpData);
        }

        const summaryRes = await fetch(`${API_URL}/lectures/${lectureId}/summaries`);
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

        const mmRes = await fetch(`${API_URL}/lectures/${lectureId}/mindmaps`);
        if (mmRes.ok) {
          const mmData = await mmRes.json();
          if (mmData?.[0]?.mindmap_json?.mind_map) {
            setMindmap(convertToD3Tree(mmData[0].mindmap_json.mind_map));
          }
        }
      } catch (err) {
        setError(err.message || '取得資料失敗');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [lectureId]);

  // 初始化 YouTube IFrame API
  useEffect(() => {
    if (!videoId) return;

    function initPlayer() {
      if (!window.YT || !window.YT.Player) return;
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }

      playerRef.current = new window.YT.Player('yt-player', {
        videoId: videoId,
        playerVars: { rel: 0, modestbranding: 1 },
        events: {
          onReady: (event) => {
            playerReadyRef.current = true;
            totalDurationRef.current = event.target.getDuration();

            // 開始定期追蹤播放位置（每 2 秒）
            trackingIntervalRef.current = setInterval(() => {
              if (!playerRef.current || !playerReadyRef.current) return;
              const state = playerRef.current.getPlayerState();
              if (state === window.YT.PlayerState.PLAYING) {
                const currentTime = playerRef.current.getCurrentTime();
                lastPositionRef.current = currentTime;
              }
            }, 2000);
          },
          onStateChange: (event) => {
            const state = event.data;
            const currentTime = playerRef.current?.getCurrentTime() || 0;

            if (state === window.YT.PlayerState.PLAYING) {
              segmentStartRef.current = currentTime;
            }

            if (state === window.YT.PlayerState.PAUSED) {
              // 記錄暫停
              pauseCountRef.current += 1;
              logEvent(lectureId, 'pause', {
                timestamp: Math.floor(currentTime),
                pause_count: pauseCountRef.current,
              });

              // 記錄已觀看片段
              if (segmentStartRef.current < currentTime) {
                watchedSegmentsRef.current.push({
                  start: Math.floor(segmentStartRef.current),
                  end: Math.floor(currentTime),
                });
              }
            }

            if (state === window.YT.PlayerState.ENDED) {
              const duration = totalDurationRef.current || 1;
              const watchedSeconds = watchedSegmentsRef.current.reduce(
                (acc, seg) => acc + (seg.end - seg.start), 0
              );
              const completed = watchedSeconds / duration >= 0.9;

              logEvent(lectureId, 'watch_progress', {
                last_position: Math.floor(currentTime),
                watched_seconds: watchedSeconds,
                total_duration: Math.floor(duration),
                completed,
              });
            }
          },
        },
      });
    }

    if (window.YT && window.YT.Player) {
      initPlayer();
    } else {
      window.onYouTubeIframeAPIReady = initPlayer;
      if (!document.getElementById('yt-api-script')) {
        const tag = document.createElement('script');
        tag.id = 'yt-api-script';
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);
      }
    }

    return () => {
      // 離開頁面時記錄最後觀看位置
      if (playerRef.current && playerReadyRef.current) {
        const currentTime = playerRef.current.getCurrentTime() || 0;
        const duration = totalDurationRef.current || 1;
        const watchedSeconds = watchedSegmentsRef.current.reduce(
          (acc, seg) => acc + (seg.end - seg.start), 0
        );
        logEvent(lectureId, 'watch_progress', {
          last_position: Math.floor(currentTime),
          watched_seconds: watchedSeconds,
          total_duration: Math.floor(duration),
          completed: watchedSeconds / duration >= 0.9,
        });
      }
      if (trackingIntervalRef.current) clearInterval(trackingIntervalRef.current);
    };
  }, [videoId, lectureId]);

  // 點知識點 → 跳到對應時間
  function seekToKnowledgePoint(startTime) {
    if (!playerRef.current || !playerReadyRef.current) return;
    const seconds = timeToSeconds(startTime);

    // 記錄 seek 事件
    const currentTime = playerRef.current.getCurrentTime() || 0;
    logEvent(lectureId, 'seek', {
      from: Math.floor(currentTime),
      to: seconds,
      triggered_by: 'knowledge_point',
    });

    playerRef.current.seekTo(seconds, true);
    playerRef.current.playVideo();
  }

  // AI 助教提問（記錄當前時間戳）
  function handleAskQuestion() {
    if (!chatInput.trim()) return;
    const currentTime = playerRef.current?.getCurrentTime() || 0;

    // 記錄提問事件
    logEvent(lectureId, 'question_asked', {
      timestamp: Math.floor(currentTime),
      question: chatInput.trim(),
    });

    setChatMessages(prev => [
      ...prev,
      { role: 'user', text: chatInput.trim() },
      { role: 'assistant', text: '（AI 回覆功能開發中...）' },
    ]);
    setChatInput('');
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <header className="max-w-7xl mx-auto mb-6 flex justify-between items-center">
        <div>
          <Link to={`/course/${id}`} className="text-blue-500 text-sm hover:underline">← 返回小節列表</Link>
          <h1 className="text-2xl font-bold text-slate-800 mt-1">AI 輔助學習系統</h1>
          <p className="text-slate-500 text-sm">小節：{lectureId}</p>
        </div>
        <div className="bg-white px-4 py-2 rounded-full shadow-sm text-sm font-medium">
          使用者：Jun-Cheng
        </div>
      </header>

      <main className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* 左側主區 */}
        <div className="lg:col-span-3 space-y-4">
          {/* 影片 */}
          <div className="aspect-video bg-black rounded-2xl shadow-xl overflow-hidden border-4 border-white">
            {videoId ? (
              <div id="yt-player" style={{ width: '100%', height: '100%' }} />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-400">
                {loading ? '載入影片中...' : '無影片資料'}
              </div>
            )}
          </div>

          {/* 知識點 */}
          <div className="bg-white p-6 rounded-2xl shadow-sm">
            <h2 className="text-xl font-bold mb-4 flex items-center">
              <span className="bg-blue-100 text-blue-600 p-1 rounded mr-2">📚</span>
              課程知識點
              <span className="ml-2 text-sm font-normal text-slate-400">點擊可跳至對應時間</span>
            </h2>
            {loading ? (
              <p className="text-slate-500">正在載入知識點...</p>
            ) : error ? (
              <p className="text-red-500 text-sm">{error}</p>
            ) : knowledgePoints.length === 0 ? (
              <p className="text-slate-400 text-sm">無知識點資料</p>
            ) : (
              <div className="grid gap-3">
                {knowledgePoints.map((p, i) => (
                  <div
                    key={i}
                    onClick={() => seekToKnowledgePoint(p.start_time)}
                    className="p-4 bg-slate-50 rounded-xl border border-slate-100 hover:border-blue-400 hover:bg-blue-50 transition-colors cursor-pointer group"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="font-bold text-blue-700 group-hover:text-blue-600">{p.title}</h3>
                      {p.start_time && (
                        <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-mono">
                          ▶ {p.start_time}
                        </span>
                      )}
                    </div>
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
                        x="-60" y="-18" width="120" height="36" rx="8"
                        fill={nodeDatum.children ? '#dbeafe' : '#f1f5f9'}
                        stroke={nodeDatum.children ? '#3b82f6' : '#cbd5e1'}
                        strokeWidth="1.5"
                      />
                      <text
                        textAnchor="middle" dominantBaseline="middle"
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

        {/* 右側欄 */}
        <div className="space-y-6">
          {/* 摘要 */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border-t-4 border-blue-500">
            <h3 className="text-lg font-bold mb-2 text-slate-800">✨ AI 內容摘要</h3>
            <p className="text-slate-600 text-sm leading-relaxed">
              {loading ? '載入中...' : summary || '無摘要資料'}
            </p>
          </div>

          {/* AI 助教 */}
          <div className="bg-slate-900 p-6 rounded-2xl shadow-lg text-white">
            <h3 className="text-lg font-bold mb-4">💬 AI 課程助教</h3>
            <div className="h-48 bg-slate-800 rounded-xl p-3 text-xs mb-4 overflow-y-auto space-y-2">
              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`p-2 rounded ${msg.role === 'assistant' ? 'bg-slate-700' : 'bg-blue-600 ml-4'}`}
                >
                  {msg.text}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs focus:outline-none"
                placeholder="輸入問題..."
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAskQuestion()}
              />
              <button
                onClick={handleAskQuestion}
                className="bg-blue-500 hover:bg-blue-400 px-3 py-2 rounded-lg text-xs font-bold"
              >
                送出
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default LectureDetail;