import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";

const API_URL = "http://127.0.0.1:8000";

export default function Login() {
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
            window.location.href = "/";
            navigate("/");
        } catch (err) {
            setError(err.message);
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100">
            <div className="bg-white w-full max-w-sm p-8 rounded-xl shadow-lg">
                <h1 className="text-2xl font-bold text-center mb-6">
                    登入
                </h1>

                <input
                    className="w-full border rounded-lg p-3 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Email"
                    onChange={(e) => setEmail(e.target.value)}
                />

                <input
                    type="password"
                    className="w-full border rounded-lg p-3 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Password"
                    onChange={(e) => setPassword(e.target.value)}
                />

                {error && (
                    <p className="text-red-500 text-sm mb-3">
                        {error}
                    </p>
                )}

                <button
                    onClick={handleLogin}
                    className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-3 rounded-lg transition"
                >
                    登入
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