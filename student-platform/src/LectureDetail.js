import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Transformer } from 'markmap-lib';
import { Markmap } from 'markmap-view';

const API_URL = 'http://127.0.0.1:8000';
const COMPLETION_THRESHOLD = 0.8;

// =====================================================================
// 工具函式
// =====================================================================

function convertLegacyMindmapToMarkdown(node, depth = 1) {
  if (!node) return '';
  const heading = depth <= 2
    ? `${'#'.repeat(depth)} ${node.title || '未命名節點'}`
    : `${'  '.repeat(depth - 3)}- ${node.title || '未命名節點'}`;
  const description = node.description
    ? `\n${'  '.repeat(Math.max(depth - 2, 0))}- ${node.description}`
    : '';
  const children = (node.children || [])
    .map(child => convertLegacyMindmapToMarkdown(child, depth + 1))
    .filter(Boolean)
    .join('\n');
  return [heading + description, children].filter(Boolean).join('\n');
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
  const token = localStorage.getItem('access_token');
  if (!token) return;
  try {
    await fetch(`${API_URL}/learning_events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        lecture_id: parseInt(lectureId),
        event_type: eventType,
        event_data: eventData,
      }),
    });
  } catch (e) { }
}

async function fetchTimedQuestions(lectureId) {
  const questionRes = await fetch(`${API_URL}/lectures/${lectureId}/questions`);
  if (!questionRes.ok) {
    throw new Error('無法載入題目資料');
  }

  const questionData = await questionRes.json();
  if (!Array.isArray(questionData)) return [];

  return questionData
    .filter(q => q.source_timestamp !== null && q.source_timestamp !== undefined)
    .sort((a, b) => Number(a.source_timestamp) - Number(b.source_timestamp));
}

async function saveProgress(lectureId, lastPosition, watchedSeconds, totalDuration) {
  const token = localStorage.getItem('access_token');
  if (!token) return;
  const completed = totalDuration > 0 && watchedSeconds / totalDuration >= COMPLETION_THRESHOLD;
  try {
    await fetch(`${API_URL}/video_progresses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
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
  const token = localStorage.getItem('access_token');
  const [summary, setSummary] = useState('');
  const [knowledgePoints, setKnowledgePoints] = useState([]);
  const [videoId, setVideoId] = useState('');
  const [mindmapMarkdown, setMindmapMarkdown] = useState('');
  const [notes, setNotes] = useState([]);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('summary');
  const [activeKp, setActiveKp] = useState(null);
  const [userName, setUserName] = useState(token ? '' : '尚未登入');
  const [userProfile, setUserProfile] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [activeQuestion, setActiveQuestion] = useState(null);
  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [questionFeedback, setQuestionFeedback] = useState(null);
  const [questionSubmitting, setQuestionSubmitting] = useState(false);
  const [resettingQuestions, setResettingQuestions] = useState(false);
  const [resetMessage, setResetMessage] = useState('');

  // 進度顯示用 state
  const [watchedPercent, setWatchedPercent] = useState(0);
  const [isCompleted, setIsCompleted] = useState(false);

  const mindmapSvgRef = useRef(null);
  const playerRef = useRef(null);
  const playerReadyRef = useRef(false);
  const pauseCountRef = useRef(0);
  const suppressNextPauseEventRef = useRef(false);
  const segmentStartRef = useRef(0);
  const totalDurationRef = useRef(0);
  const watchedSegmentsRef = useRef([]);
  const prevWatchedSecondsRef = useRef(0); // 資料庫累積舊值
  const lastObservedTimeRef = useRef(null);
  const lastObservedAtRef = useRef(null);
  const lastPlayerStateRef = useRef(null);
  const ignoreSeekUntilRef = useRef(0);
  const trackingIntervalRef = useRef(null);
  const saveIntervalRef = useRef(null);
  const questionsRef = useRef([]);
  const activeQuestionRef = useRef(null);
  const shownQuestionIdsRef = useRef(new Set());

  const [chatMessages, setChatMessages] = useState([]);
  const [chatInitialized, setChatInitialized] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef(null);

  const getPlayerCurrentTime = useCallback((fallback = 0) => {
    const player = playerRef.current;
    if (!player || typeof player.getCurrentTime !== 'function') return fallback;

    try {
      return player.getCurrentTime() || 0;
    } catch {
      // The YouTube player can be destroyed while React is cleaning up an effect.
      return fallback;
    }
  }, []);

  // 更新進度顯示
  function updateProgressDisplay(totalWatched, totalDuration) {
    if (!totalDuration) return;
    const percent = Math.min(Math.round((totalWatched / totalDuration) * 100), 100);
    setWatchedPercent(percent);
    setIsCompleted(totalWatched / totalDuration >= COMPLETION_THRESHOLD);
  }

  const showTimedQuestion = useCallback((question, currentTime) => {
    if (!question || activeQuestionRef.current) return;

    shownQuestionIdsRef.current.add(question.id);
    activeQuestionRef.current = question;
    setActiveQuestion(question);
    setSelectedAnswer('');
    setQuestionFeedback(null);
    // This pause is caused by the timed-question system, not by the student.
    suppressNextPauseEventRef.current = true;
    playerRef.current?.pauseVideo?.();
    logEvent(lectureId, 'question_popup', {
      question_id: question.id,
      timestamp: Math.floor(currentTime),
    });
  }, [lectureId]);

  const maybeShowTimedQuestion = useCallback((currentTime) => {
    if (activeQuestionRef.current) return;

    const nextQuestion = questionsRef.current.find(question => {
      const triggerTime = Number(question.source_timestamp);
      return (
        Number.isFinite(triggerTime) &&
        currentTime >= triggerTime &&
        !shownQuestionIdsRef.current.has(question.id)
      );
    });

    if (!nextQuestion) return;
    showTimedQuestion(nextQuestion, currentTime);
  }, [showTimedQuestion]);

  // 新增筆記
  async function createNote() {
    if (!token) {
      alert('請先登入');
      return;
    }

    if (!noteContent.trim()) {
      alert('請輸入筆記內容');
      return;
    }

    try {
      const res = await fetch(
        `${API_URL}/lectures/${lectureId}/notes`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            title: noteTitle.trim() || null,
            content: noteContent.trim(),
            video_timestamp: Math.floor(getPlayerCurrentTime()),
          }),
        }
      );

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || '新增筆記失敗');
      }

      const createdNote = await res.json();

      setNotes(prev => [createdNote, ...prev]);
      setNoteTitle('');
      setNoteContent('');
      setShowNoteInput(false);
    } catch (err) {
      alert(err.message || '新增筆記失敗，請稍後再試');
    }
  }

  // 修改筆記
  async function updateNote(noteId, title, content) {
    if (!token) {
      alert('請先登入');
      return;
    }

    if (!content.trim()) {
      alert('筆記內容不可為空白');
      return;
    }

    try {
      const res = await fetch(
        `${API_URL}/notes/${noteId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            title: title.trim() || null,
            content: content.trim(),
          }),
        }
      );

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || '修改筆記失敗');
      }

      const updatedNote = await res.json();

      setNotes(prev =>
        prev.map(note => note.id === noteId ? updatedNote : note)
      );
      setEditingNoteId(null);
    } catch (err) {
      alert(err.message || '修改筆記失敗，請稍後再試');
    }
  }

  // 刪除筆記
  async function deleteNote(noteId) {
    if (!token) {
      alert('請先登入');
      return;
    }

    const confirmed = window.confirm('確定要刪除此筆記嗎？');

    if (!confirmed) {
      return;
    }

    try {
      const res = await fetch(
        `${API_URL}/notes/${noteId}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || '刪除筆記失敗');
      }

      setNotes(prev =>
        prev.filter(note => note.id !== noteId)
      );

    } catch (err) {
      alert(err.message || '刪除筆記失敗，請稍後再試');
    }
  }

  // 依登入 token 取得目前使用者名稱。
  useEffect(() => {
    if (!token) {
      setUserName('尚未登入');
      setUserProfile(null);
      return;
    }

    fetch(`${API_URL}/name`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => {
        if (!res.ok) throw new Error('無法取得使用者名稱');
        return res.json();
      })
      .then(data => {
        setUserProfile(data);
        setUserName(data?.name || data?.email || '使用者');
      })
      .catch(() => {
        setUserProfile(null);
        setUserName('尚未登入');
      });
  }, [token]);

  useEffect(() => {
    questionsRef.current = questions;
    if (!playerRef.current || !playerReadyRef.current) return;
    const currentTime = getPlayerCurrentTime();
    maybeShowTimedQuestion(currentTime);
  }, [questions, maybeShowTimedQuestion, getPlayerCurrentTime]);

  useEffect(() => {
    activeQuestionRef.current = activeQuestion;
  }, [activeQuestion]);

  // 載入課程資料（同時撈觀看進度，確保 prevWatchedSecondsRef 在播放前就設好）
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        let pendingQuestions = [];
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
          const mindmapJson = mmData?.[0]?.mindmap_json;
          if (mindmapJson?.markdown) {
            setMindmapMarkdown(mindmapJson.markdown);
          } else if (mindmapJson?.mind_map) {
            setMindmapMarkdown(convertLegacyMindmapToMarkdown(mindmapJson.mind_map));
          } else {
            setMindmapMarkdown('');
          }
        }

        pendingQuestions = await fetchTimedQuestions(lectureId);

        // 提早撈觀看進度，確保在 onReady 前就設好 prevWatchedSecondsRef
        const progressRes = token
          ? await fetch(`${API_URL}/video_progresses/${lectureId}`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          : null;
        if (progressRes?.ok) {
          const progressData = await progressRes.json();
          if (progressData?.watched_seconds > 0) {
            prevWatchedSecondsRef.current = progressData.watched_seconds;
          }
          if (progressData?.completed) {
            setIsCompleted(true);
            setWatchedPercent(100);
          }
        }

        const attemptsRes = token
          ? await fetch(`${API_URL}/lectures/${lectureId}/question-attempts`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          : null;
        if (attemptsRes?.ok) {
          const attempts = await attemptsRes.json();
          shownQuestionIdsRef.current = new Set(
            (attempts || []).map(attempt => attempt.question_id)
          );
        } else {
          shownQuestionIdsRef.current = new Set();
        }

        const chatRes = token
          ? await fetch(`${API_URL}/lectures/${lectureId}/chats`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          : null;

        if (chatRes?.ok) {
          const chatData = await chatRes.json();

          const messages = [];

          chatData.messages.forEach(chat => {
            messages.push({
              role: "user",
              text: chat.question,
            });

            messages.push({
              role: "assistant",
              text: chat.answer,
            });
          });

          setChatMessages(messages);
        } else {
          setChatMessages([]);
        }

        setChatInitialized(true);

        setQuestions(pendingQuestions);
      } catch (err) {
        setError(err.message || '取得資料失敗');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [lectureId, token]);

  // 將後端產生的 Markdown 轉換成可縮放、拖曳的 Markmap。
  useEffect(() => {
    if (activeTab !== 'mindmap' || !mindmapMarkdown || !mindmapSvgRef.current) return;

    const transformer = new Transformer();
    const { root } = transformer.transform(mindmapMarkdown);
    const markmap = Markmap.create(
      mindmapSvgRef.current,
      {
        autoFit: true,
        duration: 300,
        initialExpandLevel: 3,
        maxWidth: 260,
        paddingX: 16,
      },
      root
    );

    markmap.fit();
    return () => markmap.destroy?.();
  }, [activeTab, mindmapMarkdown]);

  useEffect(() => {
    if (!token || !lectureId) return;

    const fetchNotes = async () => {
      try {
        const res = await fetch(
          `${API_URL}/lectures/${lectureId}/notes`,
          {
            headers: {
              Authorization: `Bearer ${token}`
            }
          }
        );

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          console.error('取得筆記失敗：', res.status, errorData);
          throw new Error(errorData.detail || '取得筆記失敗');
        }

        const data = await res.json();
        setNotes(data);

      } catch (error) {
        console.error(error);
      }
    };

    fetchNotes();

  }, [lectureId, token]);

  // 初始化 YouTube IFrame API
  useEffect(() => {
    if (!videoId) return;

    function observePlaybackPosition(currentTime, currentState) {
      const now = Date.now();
      const previousTime = lastObservedTimeRef.current;
      const previousAt = lastObservedAtRef.current;
      const previousState = lastPlayerStateRef.current;

      if (
        previousTime !== null &&
        previousAt !== null &&
        now >= ignoreSeekUntilRef.current
      ) {
        const elapsedSeconds = (now - previousAt) / 1000;
        const expectedAdvance =
          previousState === window.YT.PlayerState.PLAYING ? elapsedSeconds : 0;
        const expectedTime = previousTime + expectedAdvance;

        // A sizeable discontinuity from the expected playback position means
        // the student used YouTube's own timeline controls.
        if (Math.abs(currentTime - expectedTime) >= 3) {
          logEvent(lectureId, 'seek', {
            from: Math.floor(expectedTime),
            to: Math.floor(currentTime),
            triggered_by: 'player_controls',
          });
        }
      }

      lastObservedTimeRef.current = currentTime;
      lastObservedAtRef.current = now;
      lastPlayerStateRef.current = currentState;
    }

    function getTotalWatched() {
      const merged = mergeSegments(watchedSegmentsRef.current);
      return prevWatchedSecondsRef.current + calcWatchedSeconds(merged);
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

            // onReady 只負責續播，prevWatchedSecondsRef 已在 fetchData 設好
            if (token) {
              try {
                const res = await fetch(`${API_URL}/video_progresses/${lectureId}`, {
                  headers: { Authorization: `Bearer ${token}` },
                });
                if (res.ok) {
                  const data = await res.json();
                  if (data?.last_position > 0) {
                    ignoreSeekUntilRef.current = Date.now() + 3000;
                    event.target.seekTo(data.last_position, true);
                    lastObservedTimeRef.current = data.last_position;
                    lastObservedAtRef.current = Date.now();
                  }
                }
              } catch (e) { }
            }

            // 初始顯示進度
            updateProgressDisplay(prevWatchedSecondsRef.current, totalDurationRef.current);

            // 每 2 秒記錄播放片段
            trackingIntervalRef.current = setInterval(() => {
              if (!playerRef.current || !playerReadyRef.current) return;
              const state = playerRef.current.getPlayerState?.();
              if (state === window.YT.PlayerState.PLAYING) {
                const currentTime = getPlayerCurrentTime();
                observePlaybackPosition(currentTime, state);
                watchedSegmentsRef.current.push({
                  start: Math.max(0, currentTime - 2),
                  end: currentTime,
                });
                // 每 2 秒更新進度顯示
                updateProgressDisplay(getTotalWatched(), totalDurationRef.current);
                maybeShowTimedQuestion(currentTime);
              }
            }, 2000);

            // 每 30 秒自動存一次
            saveIntervalRef.current = setInterval(() => {
              const lastPosition = getPlayerCurrentTime();
              const totalWatched = getTotalWatched();
              saveProgress(lectureId, lastPosition, totalWatched, totalDurationRef.current);
              updateProgressDisplay(totalWatched, totalDurationRef.current);
            }, 30000);
          },

          onStateChange: (event) => {
            const state = event.data;
            const currentTime = getPlayerCurrentTime();
            observePlaybackPosition(currentTime, state);

            if (state === window.YT.PlayerState.PLAYING) {
              segmentStartRef.current = currentTime;
              maybeShowTimedQuestion(currentTime);
            }

            if (state === window.YT.PlayerState.PAUSED) {
              if (segmentStartRef.current < currentTime) {
                watchedSegmentsRef.current.push({
                  start: segmentStartRef.current,
                  end: currentTime,
                });
              }
              if (suppressNextPauseEventRef.current) {
                suppressNextPauseEventRef.current = false;
              } else {
                pauseCountRef.current += 1;
                logEvent(lectureId, 'pause', {
                  timestamp: Math.floor(currentTime),
                  pause_count: pauseCountRef.current,
                });
              }
              const totalWatched = getTotalWatched();
              saveProgress(lectureId, currentTime, totalWatched, totalDurationRef.current);
              updateProgressDisplay(totalWatched, totalDurationRef.current);
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
              updateProgressDisplay(totalWatched, totalDurationRef.current);
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
        const currentTime = getPlayerCurrentTime();
        if (segmentStartRef.current < currentTime) {
          segments.push({ start: segmentStartRef.current, end: currentTime });
        }
        const merged = mergeSegments(segments);
        const totalWatched = prevWatched + calcWatchedSeconds(merged);
        saveProgress(lectureId, currentTime, totalWatched, totalDurationRef.current);
      }
      if (trackingIntervalRef.current) clearInterval(trackingIntervalRef.current);
      if (saveIntervalRef.current) clearInterval(saveIntervalRef.current);
      playerReadyRef.current = false;
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
  }, [videoId, lectureId, token, maybeShowTimedQuestion, getPlayerCurrentTime]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  function seekToKnowledgePoint(startTime, index) {
    if (!playerRef.current || !playerReadyRef.current) return;
    const seconds = timeToSeconds(startTime);
    const currentTime = getPlayerCurrentTime();
    if (segmentStartRef.current < currentTime) {
      watchedSegmentsRef.current.push({ start: segmentStartRef.current, end: currentTime });
    }
    logEvent(lectureId, 'seek', {
      from: Math.floor(currentTime),
      to: seconds,
      triggered_by: 'knowledge_point',
    });
    // The knowledge-point action already has its own seek event. Reset the
    // observation baseline so the player API does not report it a second time.
    ignoreSeekUntilRef.current = Date.now() + 3000;
    lastObservedTimeRef.current = seconds;
    lastObservedAtRef.current = Date.now();
    lastPlayerStateRef.current = window.YT?.PlayerState?.PLAYING ?? 1;
    playerRef.current.seekTo(seconds, true);
    playerRef.current.playVideo();
    maybeShowTimedQuestion(seconds);
    segmentStartRef.current = seconds;
    setActiveKp(index);
  }

  // questionOverride：若有傳入，代表是「快速提問」按鈕觸發，不從輸入框拿文字
  async function handleAskQuestion(questionOverride) {
    const question = (questionOverride ?? chatInput).trim();
    if (!question || chatLoading) return;

    const currentTime = Math.floor(getPlayerCurrentTime());

    logEvent(lectureId, 'question_asked', { timestamp: currentTime, question });
    setChatMessages(prev => [...prev, { role: 'user', text: question }]);
    if (!questionOverride) setChatInput('');
    setChatLoading(true);

    try {
      const res = await fetch(`${API_URL}/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          lecture_id: parseInt(lectureId),
          question,
          video_timestamp: currentTime,
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

  // 即時發問：自動帶入目前影片時間點，請助教講解現在教的內容
  function handleQuickAskCurrentMoment() {
    if (chatLoading) return;
    const currentTime = Math.floor(getPlayerCurrentTime());
    const minutes = Math.floor(currentTime / 60);
    const seconds = currentTime % 60;
    const timestampStr = `${minutes}:${String(seconds).padStart(2, '0')}`;
    const question = `請講解一下現在影片播放到 ${timestampStr} 這段在教什麼內容？`;
    handleAskQuestion(question);
  }

  function getQuestionOptions(question) {
    const options = question?.options_json;
    if (Array.isArray(options)) return options;
    if (typeof options === 'string') {
      try {
        const parsed = JSON.parse(options);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  async function submitQuestionAnswer() {
    if (!activeQuestion || !selectedAnswer || questionSubmitting) return;
    if (!token) {
      setQuestionFeedback({
        is_correct: false,
        error: '請先登入，系統才能儲存作答紀錄。',
      });
      return;
    }
    setQuestionSubmitting(true);

    const currentTime = getPlayerCurrentTime(activeQuestion.source_timestamp);

    try {
      const res = await fetch(`${API_URL}/questions/${activeQuestion.id}/attempt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          lecture_id: parseInt(lectureId),
          selected_answer: selectedAnswer,
          video_time: currentTime,
        }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || '作答紀錄儲存失敗');
      }
      const data = await res.json();
      setQuestionFeedback(data);
      logEvent(lectureId, 'question_answered', {
        question_id: activeQuestion.id,
        selected_answer: selectedAnswer,
        is_correct: data.is_correct,
        timestamp: Math.floor(currentTime),
      });
    } catch (err) {
      setQuestionFeedback({
        is_correct: false,
        error: err.message || '作答失敗，請稍後再試',
      });
    } finally {
      setQuestionSubmitting(false);
    }
  }

  async function resetDemoQuestions() {
    if (!token || resettingQuestions) return;
    setResettingQuestions(true);
    setResetMessage('');

    try {
      const res = await fetch(`${API_URL}/lectures/${lectureId}/question-attempts`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || '重置測驗失敗');
      }

      shownQuestionIdsRef.current = new Set();
      activeQuestionRef.current = null;
      setActiveQuestion(null);
      setSelectedAnswer('');
      setQuestionFeedback(null);
      setResetMessage('已重置測驗，題目可以重新跳出。');

      let timedQuestions = questionsRef.current;
      if (!timedQuestions.length) {
        timedQuestions = await fetchTimedQuestions(lectureId);
        questionsRef.current = timedQuestions;
        setQuestions(timedQuestions);
      }

      const firstQuestion = timedQuestions.find(question =>
        Number.isFinite(Number(question.source_timestamp))
      );
      if (!firstQuestion) {
        throw new Error('這個小節目前沒有設定時間點的題目');
      }

      if (firstQuestion) {
        const triggerTime = Number(firstQuestion.source_timestamp);
        if (playerRef.current && playerReadyRef.current) {
          ignoreSeekUntilRef.current = Date.now() + 3000;
          lastObservedTimeRef.current = triggerTime;
          lastObservedAtRef.current = Date.now();
          lastPlayerStateRef.current = window.YT?.PlayerState?.PAUSED ?? 2;
          playerRef.current.seekTo(triggerTime, true);
        }
        showTimedQuestion(firstQuestion, triggerTime);
      }
    } catch (err) {
      setResetMessage(err.message || '重置測驗失敗');
    } finally {
      setResettingQuestions(false);
    }
  }

  function continueAfterQuestion() {
    activeQuestionRef.current = null;
    setActiveQuestion(null);
    setSelectedAnswer('');
    setQuestionFeedback(null);
    playerRef.current?.playVideo?.();
  }

  return (
    <div className="learning-shell h-screen overflow-hidden flex flex-col bg-[#f4f5fa]">

      {/* Header */}
      <header className="learning-header flex-shrink-0 bg-white/90 backdrop-blur border-b border-slate-200 px-6 py-3 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <Link to={`/course/${id}`} className="text-blue-500 text-sm hover:underline">← 返回</Link>
          <div>
            <h1 className="text-lg font-bold text-slate-800">AI 輔助學習系統</h1>
            <p className="text-slate-400 text-xs">小節 {lectureId}</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* 觀看進度 */}
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold ${isCompleted ? 'text-green-600' : 'text-slate-500'}`}>
              {isCompleted ? '✓ 已完成' : `已觀看 ${watchedPercent}%`}
            </span>
            <div className="learning-progress-bar w-28 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${isCompleted ? 'bg-green-500' : 'bg-blue-400'}`}
                style={{ width: `${watchedPercent}%` }}
              />
            </div>
          </div>
          <div className="learning-user bg-[#eeefff] px-4 py-1.5 rounded-full text-sm font-medium text-[#5555bd]">
            使用者：{userName || '載入中...'}
          </div>
          {userProfile?.email === 'teststudent@example.com' && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={resetDemoQuestions}
                disabled={resettingQuestions}
                className="bg-amber-50 border border-amber-200 text-amber-700 px-3 py-1.5 rounded-full text-xs font-bold hover:bg-amber-100 disabled:opacity-60"
                title="清除這個 demo 帳號在本小節的作答紀錄"
              >
                {resettingQuestions ? '重置中...' : '重置測驗'}
              </button>
              {resetMessage && (
                <span className="max-w-44 truncate text-xs font-medium text-amber-700" title={resetMessage}>
                  {resetMessage}
                </span>
              )}
            </div>
          )}
        </div>
      </header>

      {/* 三欄主體 */}
      <div className="learning-body flex flex-1 overflow-hidden">

        {/* 左側：知識點清單 */}
        <aside className="knowledge-aside w-60 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col">
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
        <main className="learning-main flex-1 overflow-y-auto flex flex-col p-4 gap-4 min-w-0">
          <div className="flex-shrink-0 aspect-video bg-black rounded-[22px] shadow-xl shadow-slate-300/40 overflow-hidden">
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
                { key: 'notes', label: '📝 我的筆記' },
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
                ) : mindmapMarkdown ? (
                  <div className="w-full h-[420px] overflow-hidden rounded-xl border border-slate-100 bg-slate-50">
                    <svg ref={mindmapSvgRef} className="w-full h-full" />
                  </div>
                ) : (
                  <p className="text-slate-400 text-sm">無心智圖資料</p>
                )
              )}
              {activeTab === 'notes' && (
                <div className="space-y-4">
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => setShowNoteInput(!showNoteInput)}
                      className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white"
                    >
                      {showNoteInput ? '收起' : '+ 新增筆記'}
                    </button>
                  </div>
                  {showNoteInput && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">

                      <input
                        type="text"
                        value={noteTitle}
                        onChange={e => setNoteTitle(e.target.value)}
                        placeholder="標題（可選）"
                        className="mb-3 w-full rounded-lg border p-2"
                      />

                      <textarea
                        value={noteContent}
                        onChange={e => setNoteContent(e.target.value)}
                        placeholder="輸入筆記內容..."
                        rows={4}
                        className="w-full rounded-lg border p-3"
                      />
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={createNote}
                          disabled={!noteContent.trim()}
                          className="mt-3 rounded-lg bg-blue-500 px-4 py-2 text-white disabled:bg-slate-300"
                        >
                          儲存筆記
                        </button>
                      </div>
                    </div>
                  )}

                  {notes.length === 0 ? (
                    <p className="py-6 text-center text-sm text-slate-400">
                      目前沒有筆記
                    </p>
                  ) : (
                    notes.map(note => (
                      <article
                        key={note.id}
                        onClick={() => {
                          if (editingNoteId !== note.id) {
                            setEditingNoteId(note.id);
                            setEditTitle(note.title || '');
                            setEditContent(note.content);
                          }
                        }}
                        className="relative cursor-pointer rounded-xl border border-slate-200 bg-white p-4 hover:bg-slate-50"
                      >
                        {editingNoteId === note.id ? (
                          <div onClick={e => e.stopPropagation()}>

                            <input
                              value={editTitle}
                              onChange={e => setEditTitle(e.target.value)}
                              className="mb-2 w-full rounded border p-2"
                              placeholder="標題（可選）"
                            />

                            <textarea
                              value={editContent}
                              onChange={e => setEditContent(e.target.value)}
                              className="w-full rounded border p-2"
                              rows={4}
                            />

                            <div className="mt-2 flex justify-end gap-2">
                              <button
                                onClick={() => setEditingNoteId(null)}
                                className="rounded bg-slate-300 px-3 py-1"
                              >
                                取消
                              </button>
                              <button
                                onClick={() => updateNote(note.id, editTitle, editContent)}
                                className="rounded bg-blue-500 px-3 py-1 text-white"
                              >
                                儲存
                              </button>
                            </div>

                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteNote(note.id);
                              }}
                              className="absolute right-3 top-3 text-slate-400 hover:text-red-500"
                            >
                              🗑️
                            </button>
                            {note.title && (
                              <>
                                <h3 className="text-base font-semibold text-slate-800">
                                  {note.title}
                                </h3>
                                <div className="my-2 border-t border-slate-100" />
                              </>
                            )}

                            <p className="whitespace-pre-wrap text-sm">
                              {note.content}
                            </p>
                            <p className="mt-3 text-xs text-slate-400">
                              影片時間：
                              {Math.floor(note.video_timestamp / 60)}:
                              {String(note.video_timestamp % 60).padStart(2, '0')}
                            </p>

                            <p className="absolute bottom-3 right-4 text-xs text-slate-400">
                              上次修改時間：
                              {new Date(note.updated_at).toLocaleString()}
                            </p>
                          </>
                        )}
                      </article>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </main>

        {/* 右側：AI 助教 */}
        <aside className="assistant-aside w-80 flex-shrink-0 bg-[#1f2740] flex flex-col">
          <div className="flex-shrink-0 px-5 py-4 border-b border-slate-700">
            <h2 className="font-bold text-white text-sm">💬 AI 課程助教</h2>
            <p className="text-slate-400 text-xs mt-0.5">針對課程內容即時提問</p>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {!chatInitialized ? (
              <div className="text-slate-400 text-xs">
                載入聊天紀錄中...
              </div>
            ) : chatMessages.length === 0 ? (
              <div
                className="text-xs leading-relaxed rounded-xl p-3 bg-slate-700 text-slate-100"
              >
                你好！我是你的 AI 課程助教 😊 有任何課程問題都可以問我！
              </div>
            ) : (chatMessages.map((msg, i) => (
              <div
                key={i}
                className={`text-xs leading-relaxed rounded-xl p-3 ${msg.role === 'assistant'
                  ? 'bg-slate-700 text-slate-100'
                  : 'bg-blue-600 text-white ml-4'
                  }`}
              >
                {msg.text}
              </div>
            )))}
            {chatLoading && (
              <div className="bg-slate-700 text-slate-400 text-xs rounded-xl p-3 animate-pulse">
                助教思考中...
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>
          <div className="flex-shrink-0 p-4 border-t border-slate-700 space-y-2">
            <button
              onClick={handleQuickAskCurrentMoment}
              disabled={chatLoading}
              className="w-full bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-100 text-xs font-bold py-2 rounded-lg transition flex items-center justify-center gap-1.5"
            >
              📍 這段在教什麼？
            </button>
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
                onClick={() => handleAskQuestion()}
                disabled={chatLoading || !chatInput.trim()}
                className="bg-blue-500 hover:bg-blue-400 disabled:bg-slate-600 px-3 py-2 rounded-lg text-xs font-bold text-white transition"
              >
                送出
              </button>
            </div>
          </div>
        </aside>
      </div>

      {activeQuestion && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center px-4">
          <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-blue-500 mb-1">隨堂小測驗</p>
                  <h3 className="text-lg font-bold text-slate-800">影片時間到，先回答這題</h3>
                </div>
                <span className="text-xs font-mono text-slate-400">
                  {Math.floor(Number(activeQuestion.source_timestamp) || 0)} 秒
                </span>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm font-semibold text-slate-800 leading-relaxed">
                {activeQuestion.question_text}
              </p>

              <div className="space-y-2">
                {getQuestionOptions(activeQuestion).map((option, index) => {
                  const optionKey = option.trim().charAt(0).toUpperCase() || String.fromCharCode(65 + index);
                  const isSelected = selectedAnswer === optionKey;
                  return (
                    <button
                      key={`${activeQuestion.id}-${optionKey}`}
                      type="button"
                      disabled={!!questionFeedback}
                      onClick={() => setSelectedAnswer(optionKey)}
                      className={`w-full text-left rounded-xl border px-4 py-3 text-sm transition ${isSelected
                        ? 'border-blue-400 bg-blue-50 text-blue-700'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-blue-300 hover:bg-blue-50'
                        } ${questionFeedback ? 'cursor-default' : ''}`}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>

              {questionFeedback && (
                <div className={`rounded-xl px-4 py-3 text-sm ${questionFeedback.error
                  ? 'bg-red-50 text-red-700 border border-red-100'
                  : questionFeedback.is_correct
                    ? 'bg-green-50 text-green-700 border border-green-100'
                    : 'bg-amber-50 text-amber-700 border border-amber-100'
                  }`}>
                  {questionFeedback.error ? (
                    <p className="font-semibold">{questionFeedback.error}</p>
                  ) : (
                    <>
                      <p className="font-bold mb-1">
                        {questionFeedback.is_correct ? '答對了！' : `答錯了，正確答案是 ${questionFeedback.correct_answer}`}
                      </p>
                      {questionFeedback.explanation && (
                        <p className="leading-relaxed">{questionFeedback.explanation}</p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
              {!questionFeedback ? (
                <button
                  type="button"
                  onClick={submitQuestionAnswer}
                  disabled={!selectedAnswer || questionSubmitting}
                  className="px-5 py-2 rounded-xl bg-blue-500 text-white text-sm font-bold disabled:bg-slate-300 hover:bg-blue-400 transition"
                >
                  {questionSubmitting ? '送出中...' : '提交答案'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={continueAfterQuestion}
                  className="px-5 py-2 rounded-xl bg-slate-800 text-white text-sm font-bold hover:bg-slate-700 transition"
                >
                  繼續播放
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LectureDetail;
