import { useEffect, useState } from "react";
import { Outlet, Link } from "react-router-dom";

export default function Layout() {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [token, setToken] = useState(localStorage.getItem("access_token"));

    useEffect(() => {
        if (!token) {
            setLoading(false);
            return;
        }

        fetch("http://127.0.0.1:8000/me", {
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
        setUser(null);
        window.location.href = "/";
    }

    return (
        <div>
            {/* Navbar */}
            <nav className="flex justify-between p-4 shadow bg-white">
                <Link to="/" className="font-bold">
                    <img src="/logo192.png" alt="Logo" className="h-8" />
                </Link>

                <div className="flex gap-4">
                    {loading ? (
                        <span>Loading...</span>
                    ) : user ? (
                        <>
                            <span>{user.name || user.email}</span>
                            <button onClick={logout} className="text-red-500">
                                登出
                            </button>
                        </>
                    ) : (
                        <Link to="/login" className="text-blue-600">
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