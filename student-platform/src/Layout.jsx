import { useEffect, useState } from "react";
import { Outlet, Link } from "react-router-dom";

const API_URL = 'http://127.0.0.1:8000';

export default function Layout({ token, setToken }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!token) {
            setLoading(false);
            return;
        }

        fetch(`${API_URL}/name`, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        })
            .then(res => {
                if (!res.ok) throw new Error("Unauthorized");
                return res.json();
            })
            .then(data => {
                setUser(data);
            })
            .catch(() => {
                setUser(null);
                localStorage.removeItem("access_token");
            })
            .finally(() => {
                setLoading(false);
            });
    }, [token]);

    function logout() {
        localStorage.removeItem("access_token");
        setToken(null);
        setUser(null);
    }

    return (
        <div className="app-shell">
            <nav className="topbar">
                <Link to="/" className="brand" aria-label="Learnly 首頁">
                    <span className="brand-mark" aria-hidden="true" />
                    <span>Learnly<small>AI learning studio</small></span>
                </Link>

                <div className="nav-user">
                    {loading ? (
                        <span>載入中...</span>
                    ) : user ? (
                        <>
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
