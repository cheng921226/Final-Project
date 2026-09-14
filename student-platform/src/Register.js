import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";

const API_URL = "http://127.0.0.1:8000";

export default function Register() {
    const [name, setName] = useState("");
    const [studentNumber, setStudentNumber] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [error, setError] = useState(null);

    const navigate = useNavigate();

    async function handleRegister() {
        setError(null);

        if (!name.trim() || !studentNumber.trim() || !email.trim() || !password) {
            setError("請完整填寫姓名、學號、電子信箱與密碼");
            return;
        }

        if (password !== confirmPassword) {
            setError("密碼不一致");
            return;
        }

        try {
            const res = await fetch(`${API_URL}/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name,
                    student_number: studentNumber,
                    email,
                    password,
                }),
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || "註冊失敗");
            }

            alert("註冊成功");
            navigate("/login");
        } catch (err) {
            setError(err.message);
        }
    }

    return (
        <div className="auth-page">
            <div className="auth-card">
                <div className="auth-icon">L</div>
                <h1>建立學習帳號</h1>
                <p className="intro">一個帳號，保存你的課程與學習進度。</p>

                <label className="field"><span>姓名</span><input placeholder="你的名字"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                /></label>

                <label className="field"><span>學號</span><input placeholder="請輸入學號" autoComplete="off"
                    value={studentNumber}
                    onChange={(e) => setStudentNumber(e.target.value.toUpperCase())}
                /></label>

                <label className="field"><span>電子信箱</span><input placeholder="name@example.com" autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                /></label>

                <label className="field"><span>密碼</span><input type="password" placeholder="設定密碼" autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                /></label>

                <label className="field"><span>確認密碼</span><input type="password" placeholder="再輸入一次密碼" autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                /></label>

                {error && (
                    <p className="auth-error">
                        {error}
                    </p>
                )}

                <button
                    onClick={handleRegister}
                    className="auth-submit"
                >
                    註冊
                </button>

                <div className="auth-foot">
                    <span className="text-gray-600">
                        已有帳號？
                    </span>{" "}
                    <Link
                        to="/login"
                        className="text-blue-600 hover:underline"
                    >
                        立即登入
                    </Link>
                </div>
            </div>
        </div>
    );
}
