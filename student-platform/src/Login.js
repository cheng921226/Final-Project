import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";

const API_URL = "http://127.0.0.1:8000";

export default function Login({ setToken }) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState(null);

    const navigate = useNavigate();

    async function handleLogin() {
        setError(null);

        try {
            const res = await fetch(`${API_URL}/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email,
                    password,
                }),
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error("登入失敗" || err.detail);
            }

            const data = await res.json();

            localStorage.setItem("access_token", data.access_token);
            localStorage.setItem("refresh_token", data.refresh_token);
            setToken(data.access_token);
            navigate("/");
        } catch (err) {
            setError(err.message);
        }
    }

    return (
        <div className="auth-page">
            <div className="auth-card">
                <div className="auth-icon">L</div>
                <h1>歡迎回來</h1>
                <p className="intro">登入後繼續你的學習旅程。</p>

                <label className="field">
                    <span>電子信箱</span>
                    <input placeholder="name@example.com" autoComplete="email"
                    onChange={(e) => setEmail(e.target.value)}
                    />
                </label>

                <label className="field">
                    <span>密碼</span>
                    <input type="password" placeholder="輸入你的密碼" autoComplete="current-password"
                    onChange={(e) => setPassword(e.target.value)}
                    />
                </label>

                {error && (
                    <p className="auth-error">
                        {error}
                    </p>
                )}

                <button
                    onClick={handleLogin}
                    className="auth-submit"
                >
                    登入學習空間
                </button>

                {/* <div className="text-center mt-4">
                    <span className="text-gray-600">
                        沒有帳號？
                    </span>{" "}
                    <Link
                        to="/register"
                        className="text-blue-600 hover:underline"
                    >
                        立即註冊
                    </Link>
                </div> */}
            </div>
        </div>
    );
}
