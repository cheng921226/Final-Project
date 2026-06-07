import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

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
                throw new Error("登入失敗");
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
        <div className="flex justify-center items-center h-screen">
            <div className="bg-white p-6 shadow rounded w-80">
                <h1 className="text-xl font-bold mb-4">登入</h1>

                <input
                    className="border w-full p-2 mb-2"
                    placeholder="Email"
                    onChange={(e) => setEmail(e.target.value)}
                />

                <input
                    type="password"
                    className="border w-full p-2 mb-2"
                    placeholder="Password"
                    onChange={(e) => setPassword(e.target.value)}
                />

                {error && <p className="text-red-500">{error}</p>}

                <button
                    onClick={handleLogin}
                    className="bg-blue-500 text-white w-full p-2 mt-2"
                >
                    登入
                </button>
            </div>
        </div>
    );
}