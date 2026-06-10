import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import Tree from 'react-d3-tree';

const API_URL = 'http://127.0.0.1:8000';
const STUDENT_ID = 2;
const COMPLETION_THRESHOLD = 0.8;

// =====================================================================
// 工具函式
// =====================================================================

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

function mergeSegments(segments) {
  if (segments.length === 0) return [];
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const merged = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end) {
      last.end = Math.max(last.end, sorted[i].end);
    } else {
      merged.push({ ...sorted[i] });
    }
  }
  return merged;
}

function calcWatchedSeconds(mergedSegments) {
  return mergedSegments.reduce((acc, seg) => acc + (seg.end - seg.start), 0);
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
  } catch (e) { }
}

async function saveProgress(lectureId, lastPosition, watchedSeconds, totalDuration) {
  const completed = totalDuration > 0 && watchedSeconds / totalDuration >= COMPLETION_THRESHOLD;
  try {
    await fetch(`${API_URL}/video_progresses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_id: STUDENT_ID,
        lecture_id: parseInt(lectureId),
        last_position: Math.floor(lastPosition),
        watched_seconds: Math.floor(watchedSeconds),
        completed,
      }),
    });
  } catch (e) { }
}

// =====================================================================
// 主元件
// =====================================================================

function LectureDetail() {
  const { id, lectureId } = useParams();
  const [summary, setSummary] = useState('');
  const [knowledgePoints, setKnowledgePoints] = useState([]);
  const [videoId, setVideoId] = useState('');
  const [mindmap, setMindmap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('summary');
  const [activeKp, setActiveKp] = useState(null);
  const treeContainerRef = useRef(null);

  const playerRef = useRef(null);
  const playerReadyRef = useRef(false);
  const pauseCountRef = useRef(0);
  const segmentStartRef = useRef(0);
  const totalDurationRef = useRef(0);
  const watchedSegmentsRef = useRef([]);  // 本次session的片段
  const prevWatchedSecondsRef = useRef(0); // 資料庫裡的累積舊值
  const trackingIntervalRef = useRef(null);
  const saveIntervalRef = useRef(null);

  const [chatMessages, setChatMessages] = useState([
    { role: 'assistant', text: '你好！我是你的 AI 學習夥伴 😊 有任何課程問題都可以問我！' }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef(null);

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
            } catch (e) { }
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

  useEffect(() => {
    if (!videoId) return;

    // 計算本次 session 新增的秒數 + 舊的累積值
    function getTotalWatched() {
      const merged = mergeSegments(watchedSegmentsRef.current);
      const thisSession = calcWatchedSeconds(merged);
      return prevWatchedSecondsRef.current + thisSession;
    }

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
          onReady: async (event) => {
            playerReadyRef.current = true;
            totalDurationRef.current = event.target.getDuration();

            // 抓上次進度
            try {
              const res = await fetch(
                `${API_URL}/video_progresses/${lectureId}?student_id=${STUDENT_ID}`
              );
              if (res.ok) {
                const data = await res.json();
                // 續播到上次位置
                if (data?.last_position > 0) {
                  event.target.seekTo(data.last_position, true);
                }
                // 繼承資料庫的累積觀看秒數
                if (data?.watched_seconds > 0) {
                  prevWatchedSecondsRef.current = data.watched_seconds;
                }
              }
            } catch (e) { }

            // 每 2 秒記錄播放片段
            trackingIntervalRef.current = setInterval(() => {
              if (!playerRef.current || !playerReadyRef.current) return;
              const state = playerRef.current.getPlayerState();
              if (state === window.YT.PlayerState.PLAYING) {
                const currentTime = playerRef.current.getCurrentTime();
                watchedSegmentsRef.current.push({
                  start: Math.max(0, currentTime - 2),
                  end: currentTime,
                });
              }
            }, 2000);

            // 每 30 秒自動存一次進度
            saveIntervalRef.current = setInterval(() => {
              const lastPosition = playerRef.current?.getCurrentTime?.() || 0;
              saveProgress(lectureId, lastPosition, getTotalWatched(), totalDurationRef.current);
            }, 30000);
          },

          onStateChange: (event) => {
            const state = event.data;
            const currentTime = playerRef.current?.getCurrentTime() || 0;

            if (state === window.YT.PlayerState.PLAYING) {
              segmentStartRef.current = currentTime;
            }

            if (state === window.YT.PlayerState.PAUSED) {
              if (segmentStartRef.current < currentTime) {
                watchedSegmentsRef.current.push({
                  start: segmentStartRef.current,
                  end: currentTime,
                });
              }
              pauseCountRef.current += 1;
              logEvent(lectureId, 'pause', {
                timestamp: Math.floor(currentTime),
                pause_count: pauseCountRef.current,
              });
              // 暫停時存進度（舊值 + 本次）
              saveProgress(lectureId, currentTime, getTotalWatched(), totalDurationRef.current);
            }

            if (state === window.YT.PlayerState.ENDED) {
              if (segmentStartRef.current < currentTime) {
                watchedSegmentsRef.current.push({
                  start: segmentStartRef.current,
                  end: currentTime,
                });
              }
              const totalWatched = getTotalWatched();
              saveProgress(lectureId, currentTime, totalWatched, totalDurationRef.current);
              logEvent(lectureId, 'watch_progress', {
                last_position: Math.floor(currentTime),
                watched_seconds: Math.floor(totalWatched),
                total_duration: Math.floor(totalDurationRef.current),
                completed: totalWatched / totalDurationRef.current >= COMPLETION_THRESHOLD,
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
      const segments = watchedSegmentsRef.current;
      const prevWatched = prevWatchedSecondsRef.current;
      if (playerRef.current && playerReadyRef.current) {
        const currentTime = playerRef.current.getCurrentTime() || 0;
        if (segmentStartRef.current < currentTime) {
          segments.push({ start: segmentStartRef.current, end: currentTime });
        }
        const merged = mergeSegments(segments);
        const totalWatched = prevWatched + calcWatchedSeconds(merged);
        saveProgress(lectureId, currentTime, totalWatched, totalDurationRef.current);
      }
      if (trackingIntervalRef.current) clearInterval(trackingIntervalRef.current);
      if (saveIntervalRef.current) clearInterval(saveIntervalRef.current);
    };
  }, [videoId, lectureId]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  function seekToKnowledgePoint(startTime, index) {
    if (!playerRef.current || !playerReadyRef.current) return;
    const seconds = timeToSeconds(startTime);
    const currentTime = playerRef.current.getCurrentTime() || 0;
    if (segmentStartRef.current < currentTime) {
      watchedSegmentsRef.current.push({ start: segmentStartRef.current, end: currentTime });
    }
    logEvent(lectureId, 'seek', {
      from: Math.floor(currentTime),
      to: seconds,
      triggered_by: 'knowledge_point',
    });
    playerRef.current.seekTo(seconds, true);
    playerRef.current.playVideo();
    segmentStartRef.current = seconds;
    setActiveKp(index);
  }

  async function handleAskQuestion() {
    if (!chatInput.trim() || chatLoading) return;
    const question = chatInput.trim();
    const currentTime = playerRef.current?.getCurrentTime
      ? Math.floor(playerRef.current.getCurrentTime()) : 0;

    logEvent(lectureId, 'question_asked', { timestamp: currentTime, question });
    setChatMessages(prev => [...prev, { role: 'user', text: question }]);
    setChatInput('');
    setChatLoading(true);

    try {
      const res = await fetch(`${API_URL}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lecture_id: parseInt(lectureId),
          question,
          video_timestamp: currentTime,
          chat_history: chatMessages.slice(-6),
        }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setChatMessages(prev => [...prev, { role: 'assistant', text: data.answer || '（助教無法回應）' }]);
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant', text: '抱歉，助教暫時無法回應，請稍後再試 🙏' }]);
    } finally {
      setChatLoading(false);
    }
  }

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-slate-100">

      {/* Header */}
      <header className="flex-shrink-0 bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <Link to={`/course/${id}`} className="text-blue-500 text-sm hover:underline">← 返回</Link>
          <div>
            <h1 className="text-lg font-bold text-slate-800">AI 輔助學習系統</h1>
            <p className="text-slate-400 text-xs">小節 {lectureId}</p>
          </div>
        </div>
      </header>

      {/* 三欄主體 */}
      <div className="flex flex-1 overflow-hidden">

        {/* 左側：知識點清單 */}
        <aside className="w-56 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col">
          <div className="flex-shrink-0 px-4 py-3 border-b border-slate-100">
            <h2 className="font-bold text-slate-700 text-sm">📚 知識點</h2>
            <p className="text-xs text-slate-400 mt-0.5">點擊跳至影片時間點</p>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {loading ? (
              <p className="text-slate-400 text-xs p-2">載入中...</p>
            ) : knowledgePoints.length === 0 ? (
              <p className="text-slate-400 text-xs p-2">無知識點資料</p>
            ) : (
              knowledgePoints.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => seekToKnowledgePoint(p.start_time, i)}
                  className={`w-full text-left p-3 rounded-xl border transition-all group ${activeKp === i
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-slate-100 bg-slate-50 hover:border-blue-300 hover:bg-blue-50'
                    }`}
                >
                  <div className="flex items-start justify-between gap-1 mb-1">
                    <span className={`text-xs font-bold leading-tight ${activeKp === i ? 'text-blue-600' : 'text-slate-700 group-hover:text-blue-600'
                      }`}>
                      {p.title}
                    </span>
                    {p.start_time && (
                      <span className="text-xs text-blue-400 font-mono flex-shrink-0">▶{p.start_time}</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">{p.description}</p>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* 中間：影片 + Tab 面板 */}
        <main className="flex-1 overflow-y-auto flex flex-col p-4 gap-4 min-w-0">
          <div className="flex-shrink-0 aspect-video bg-black rounded-2xl shadow-lg overflow-hidden">
            {videoId ? (
              <div id="yt-player" style={{ width: '100%', height: '100%' }} />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">
                {loading ? '載入影片中...' : '無影片資料'}
              </div>
            )}
          </div>

          <div className="flex-shrink-0 bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="flex border-b border-slate-100">
              {[
                { key: 'summary', label: '✨ AI 摘要' },
                { key: 'mindmap', label: '🗺️ 心智圖' },
              ].map(tab => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.key
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                    }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="p-5">
              {activeTab === 'summary' && (
                <p className="text-slate-600 text-sm leading-relaxed">
                  {loading ? '載入中...' : summary || '無摘要資料'}
                </p>
              )}
              {activeTab === 'mindmap' && (
                loading ? (
                  <p className="text-slate-400 text-sm">正在載入心智圖...</p>
                ) : mindmap ? (
                  <div ref={treeContainerRef} style={{ width: '100%', height: '380px' }}>
                    <Tree
                      data={mindmap}
                      orientation="horizontal"
                      pathFunc="step"
                      translate={{ x: 120, y: 190 }}
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
                )
              )}
            </div>
          </div>
        </main>

        {/* 右側：AI 助教 */}
        <aside className="w-80 flex-shrink-0 bg-slate-900 flex flex-col">
          <div className="flex-shrink-0 px-5 py-4 border-b border-slate-700">
            <h2 className="font-bold text-white text-sm">💬 AI 課程助教</h2>
            <p className="text-slate-400 text-xs mt-0.5">針對課程內容即時提問</p>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {chatMessages.map((msg, i) => (
              <div
                key={i}
                className={`text-xs leading-relaxed rounded-xl p-3 ${msg.role === 'assistant'
                    ? 'bg-slate-700 text-slate-100'
                    : 'bg-blue-600 text-white ml-4'
                  }`}
              >
                {msg.text}
              </div>
            ))}
            {chatLoading && (
              <div className="bg-slate-700 text-slate-400 text-xs rounded-xl p-3 animate-pulse">
                助教思考中...
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>
          <div className="flex-shrink-0 p-4 border-t border-slate-700">
            <div className="flex gap-2">
              <input
                className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
                placeholder="輸入課程相關問題..."
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAskQuestion()}
                disabled={chatLoading}
              />
              <button
                onClick={handleAskQuestion}
                disabled={chatLoading || !chatInput.trim()}
                className="bg-blue-500 hover:bg-blue-400 disabled:bg-slate-600 px-3 py-2 rounded-lg text-xs font-bold text-white transition"
              >
                送出
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default LectureDetail;