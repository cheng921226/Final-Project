import { useEffect, useRef, useState } from "react";
import { Outlet, Link, useNavigate } from "react-router-dom";

const API_URL = 'http://127.0.0.1:8000';
const TOKEN_REFRESH_EARLY_MS = 60_000;
const TOKEN_REFRESH_RETRY_MS = 30_000;
const USER_LOAD_RETRY_MS = 3_000;
const MAX_TIMER_DELAY = 2_147_000_000;
let sessionRefreshPromise = null;

function unauthorizedError() {
    const error = new Error("Unauthorized");
    error.code = "UNAUTHORIZED";
    return error;
}

function clearStoredSession() {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
}

function getTokenRefreshTime(token) {
    try {
        const payload = token.split(".")[1];
        if (!payload) return null;

        const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
        const decoded = window.atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
        const { exp } = JSON.parse(decoded);
        return Number.isFinite(exp) ? exp * 1000 - TOKEN_REFRESH_EARLY_MS : null;
    } catch {
        return null;
    }
}

async function refreshAccessToken() {
    const refreshToken = localStorage.getItem("refresh_token");
    if (!refreshToken) return null;

    // React StrictMode can run effects twice in development. Reuse one refresh
    // request so a rotating refresh token is never submitted concurrently.
    if (!sessionRefreshPromise) {
        sessionRefreshPromise = fetch(`${API_URL}/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refresh_token: refreshToken }),
        })
            .then(async res => {
                if ([401, 403].includes(res.status)) return null;
                if (!res.ok) throw new Error("Session refresh service unavailable");
                const data = await res.json();
                if (!data.access_token || !data.refresh_token) {
                    throw new Error("Invalid session refresh response");
                }
                localStorage.setItem("access_token", data.access_token);
                localStorage.setItem("refresh_token", data.refresh_token);
                return data.access_token;
            })
            .finally(() => {
                sessionRefreshPromise = null;
            });
    }

    return sessionRefreshPromise;
}

export default function Layout({ token, setToken }) {
    const navigate = useNavigate();
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [teacherMenuOpen, setTeacherMenuOpen] = useState(false);
    const teacherMenuRef = useRef(null);

    useEffect(() => {
        if (!token) return undefined;

        let cancelled = false;
        let timerId;
        let refreshing = false;
        const refreshTime = getTokenRefreshTime(token);
        if (refreshTime === null) return undefined;

        function scheduleRefresh() {
            const delay = Math.min(Math.max(refreshTime - Date.now(), 0), MAX_TIMER_DELAY);
            timerId = window.setTimeout(() => {
                if (refreshTime - Date.now() > 0) {
                    scheduleRefresh();
                    return;
                }
                renewSession();
            }, delay);
        }

        async function renewSession() {
            if (cancelled || refreshing) return;
            refreshing = true;

            try {
                const refreshedToken = await refreshAccessToken();
                if (cancelled) return;
                if (!refreshedToken) {
                    clearStoredSession();
                    setUser(null);
                    setToken(null);
                    return;
                }
                setToken(refreshedToken);
            } catch (error) {
                console.error("Unable to refresh session", error);
                if (!cancelled) {
                    timerId = window.setTimeout(renewSession, TOKEN_REFRESH_RETRY_MS);
                }
            } finally {
                refreshing = false;
            }
        }

        function refreshIfExpired() {
            if (refreshTime - Date.now() <= 0) renewSession();
        }

        scheduleRefresh();
        window.addEventListener("focus", refreshIfExpired);
        document.addEventListener("visibilitychange", refreshIfExpired);

        return () => {
            cancelled = true;
            window.clearTimeout(timerId);
            window.removeEventListener("focus", refreshIfExpired);
            document.removeEventListener("visibilitychange", refreshIfExpired);
        };
    }, [token, setToken]);

    useEffect(() => {
        if (!token) {
            setLoading(false);
            return;
        }

        let cancelled = false;
        let retryId;

        async function loadUser() {
            setLoading(true);
            let activeToken = token;
            let retryScheduled = false;

            try {
                let res = await fetch(`${API_URL}/name`, {
                    headers: { Authorization: `Bearer ${activeToken}` },
                });

                if ([401, 403].includes(res.status)) {
                    activeToken = await refreshAccessToken();
                    if (!activeToken) throw unauthorizedError();
                    if (!cancelled) setToken(activeToken);

                    res = await fetch(`${API_URL}/name`, {
                        headers: { Authorization: `Bearer ${activeToken}` },
                    });
                }

                if ([401, 403].includes(res.status)) throw unauthorizedError();
                if (!res.ok) throw new Error(`Unable to load user (${res.status})`);
                const data = await res.json();
                if (!cancelled) setUser(data);
            } catch (error) {
                if (error?.code === "UNAUTHORIZED") {
                    clearStoredSession();
                    if (!cancelled) {
                        setUser(null);
                        setToken(null);
                    }
                } else {
                    console.error("Unable to load user; keeping the current session", error);
                    if (!cancelled) {
                        retryScheduled = true;
                        retryId = window.setTimeout(loadUser, USER_LOAD_RETRY_MS);
                    }
                }
            } finally {
                if (!cancelled && !retryScheduled) setLoading(false);
            }
        }

        loadUser();
        return () => {
            cancelled = true;
            window.clearTimeout(retryId);
        };
    }, [token, setToken]);

    useEffect(() => {
        if (!teacherMenuOpen) return undefined;

        function closeOutside(event) {
            if (!teacherMenuRef.current?.contains(event.target)) {
                setTeacherMenuOpen(false);
            }
        }

        function closeOnEscape(event) {
            if (event.key === "Escape") setTeacherMenuOpen(false);
        }

        document.addEventListener("mousedown", closeOutside);
        document.addEventListener("keydown", closeOnEscape);
        return () => {
            document.removeEventListener("mousedown", closeOutside);
            document.removeEventListener("keydown", closeOnEscape);
        };
    }, [teacherMenuOpen]);

    function logout() {
        clearStoredSession();
        setToken(null);
        setUser(null);
        navigate("/", { replace: true });
    }

    return (
        <div className="app-shell">
            <nav className="topbar">
                <Link to="/" className="brand" aria-label="首頁">
                    <span className="brand-title">AI輔助線上學習平台</span>
                </Link>

                <div className="nav-user">
                    {loading ? (
                        <span>載入中...</span>
                    ) : user ? (
                        <>
                            {user.role === 'student' && (
                                <>
                                    <Link to="/review" className="review-nav-link">複習模式</Link>
                                    <Link to="/achievements" className="review-nav-link">學習成就</Link>
                                </>
                            )}
                            {['teacher', 'campus'].includes(user.role) && (
                                <div className="teacher-menu" ref={teacherMenuRef}>
                                    <button
                                        type="button"
                                        className="teacher-menu-trigger"
                                        aria-expanded={teacherMenuOpen}
                                        aria-controls="teacher-feature-menu"
                                        onClick={() => setTeacherMenuOpen(open => !open)}
                                    >
                                        {user.role === 'campus' ? '平台管理' : '教師功能'}
                                        <span className="teacher-menu-chevron" aria-hidden="true">▾</span>
                                    </button>
                                    {teacherMenuOpen && (
                                        <div className="teacher-menu-panel" id="teacher-feature-menu">
                                            <Link to="/teacher" onClick={() => setTeacherMenuOpen(false)}>分析中心</Link>
                                            <Link to="/teacher/courses" onClick={() => setTeacherMenuOpen(false)}>課程管理</Link>
                                            <Link to="/teacher/questions" onClick={() => setTeacherMenuOpen(false)}>審題</Link>
                                            <Link to="/teacher/final-assessment" onClick={() => setTeacherMenuOpen(false)}>最終測驗</Link>
                                            <Link to="/teacher/upload" onClick={() => setTeacherMenuOpen(false)}>上傳課程</Link>
                                            <Link to="/teacher/credits" onClick={() => setTeacherMenuOpen(false)}>學分設定</Link>
                                            {user.role === 'campus' && <Link to="/campus/personnel" onClick={() => setTeacherMenuOpen(false)}>人員管理</Link>}
                                            {user.role === 'campus' && <Link to="/campus/enrollments" onClick={() => setTeacherMenuOpen(false)}>選課管理</Link>}
                                        </div>
                                    )}
                                </div>
                            )}
                            <span className="avatar">{(user.name || user.email || 'U').charAt(0).toUpperCase()}</span>
                            <span>{user.name || user.email}</span>
                            {user.role === 'campus' && <span className="role-label">校園平台端</span>}
                            <button onClick={logout} className="ghost-button">
                                登出
                            </button>
                        </>
                    ) : (
                        <Link to="/login" className="primary-link">
                            登入
                        </Link>
                    )}
                </div>
            </nav>

            <main>
                <Outlet />
            </main>
        </div>
    );
}
