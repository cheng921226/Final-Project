import { useEffect, useState } from "react";
import { Outlet, Link, useNavigate } from "react-router-dom";

const API_URL = 'http://127.0.0.1:8000';
let sessionRefreshPromise = null;

function clearStoredSession() {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
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
                if (!res.ok) return null;
                const data = await res.json();
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

    useEffect(() => {
        if (!token) {
            setLoading(false);
            return;
        }

        let cancelled = false;

        async function loadUser() {
            setLoading(true);
            let activeToken = token;

            try {
                let res = await fetch(`${API_URL}/name`, {
                    headers: { Authorization: `Bearer ${activeToken}` },
                });

                if (res.status === 401) {
                    activeToken = await refreshAccessToken();
                    if (!activeToken) throw new Error("Unauthorized");
                    if (!cancelled) setToken(activeToken);

                    res = await fetch(`${API_URL}/name`, {
                        headers: { Authorization: `Bearer ${activeToken}` },
                    });
                }

                if (!res.ok) throw new Error("Unauthorized");
                const data = await res.json();
                if (!cancelled) setUser(data);
            } catch {
                clearStoredSession();
                if (!cancelled) {
                    setUser(null);
                    setToken(null);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        loadUser();
        return () => {
            cancelled = true;
        };
    }, [token, setToken]);

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
                    <img src="/智學網_logo.svg" alt="智學網" className="brand-logo" />
                </Link>

                <div className="nav-user">
                    {loading ? (
                        <span>載入中...</span>
                    ) : user ? (
                        <>
                            {user.role === 'student' && (
                                <Link to="/review" className="review-nav-link">複習模式</Link>
                            )}
                            {user.role === 'teacher' && (
                                <Link to="/teacher" className="teacher-nav-link">分析中心</Link>
                            )}
                            <span className="avatar">{(user.name || user.email || 'U').charAt(0).toUpperCase()}</span>
                            <span>{user.name || user.email}</span>
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
