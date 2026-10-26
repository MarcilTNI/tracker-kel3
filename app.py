from __future__ import annotations

import os
import re
import secrets
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date
from functools import wraps
from pathlib import Path
from typing import Any

from flask import Flask, abort, jsonify, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_BUDGET = 1_500_000
CATEGORIES = {
    "food",
    "internet",
    "transport",
    "entertainment",
    "housing",
    "college",
    "shopping",
    "health",
    "other",
}
MONTH_PATTERN = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{3,30}$")
PASSWORD_MIN_LENGTH = 8


def current_month() -> str:
    return date.today().strftime("%Y-%m")


def parse_transaction(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        abort(400, description="Data transaksi harus berupa objek.")

    name = payload.get("name")
    category = payload.get("category")
    transaction_date = payload.get("date")
    amount = payload.get("amount")

    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 60:
        abort(400, description="Nama transaksi wajib diisi dan maksimal 60 karakter.")
    if category not in CATEGORIES:
        abort(400, description="Kategori transaksi tidak valid.")
    if not isinstance(transaction_date, str):
        abort(400, description="Tanggal transaksi tidak valid.")
    try:
        parsed_date = date.fromisoformat(transaction_date)
    except ValueError:
        abort(400, description="Tanggal transaksi harus menggunakan format YYYY-MM-DD.")
    if parsed_date.isoformat() != transaction_date:
        abort(400, description="Tanggal transaksi tidak valid.")
    if parsed_date.strftime("%Y-%m") != current_month():
        abort(400, description="Transaksi hanya dapat dicatat untuk bulan berjalan.")
    if isinstance(amount, bool) or not isinstance(amount, (int, float)) or int(amount) != amount or amount < 1:
        abort(400, description="Nominal transaksi harus berupa rupiah bulat lebih besar dari nol.")

    return {
        "name": name.strip(),
        "category": category,
        "amount": int(amount),
        "date": transaction_date,
    }


def create_app(test_config: dict[str, Any] | None = None) -> Flask:
    app = Flask(__name__, static_folder=None)
    app.config.from_mapping(
        DATABASE=os.environ.get("RAPI_DATABASE", str(BASE_DIR / "instance" / "rapi.sqlite3")),
        SECRET_KEY=os.environ.get("RAPI_SECRET_KEY") or secrets.token_hex(32),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.environ.get("RAPI_COOKIE_SECURE") == "1",
    )
    if test_config:
        app.config.update(test_config)

    @contextmanager
    def connect_db() -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(app.config["DATABASE"])
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize_database() -> None:
        database = Path(app.config["DATABASE"])
        database.parent.mkdir(parents=True, exist_ok=True)
        with connect_db() as connection:
            for table in ("budgets", "transactions"):
                exists = connection.execute(
                    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
                    (table,),
                ).fetchone()
                if exists:
                    columns = {
                        row["name"]
                        for row in connection.execute(f"PRAGMA table_info({table})")
                    }
                    if "user_id" not in columns:
                        connection.execute(f"DROP TABLE {table}")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
                    password_hash TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS budgets (
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    month TEXT NOT NULL,
                    amount INTEGER NOT NULL CHECK (amount > 0),
                    PRIMARY KEY (user_id, month)
                );
                CREATE TABLE IF NOT EXISTS transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    name TEXT NOT NULL,
                    category TEXT NOT NULL,
                    amount INTEGER NOT NULL CHECK (amount > 0),
                    date TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS transactions_user_date_idx
                    ON transactions(user_id, date);
                """
            )

    def budget_for_month(
        connection: sqlite3.Connection, user_id: int, month: str
    ) -> int:
        connection.execute(
            """
            INSERT OR IGNORE INTO budgets (user_id, month, amount)
            VALUES (
                ?, ?,
                COALESCE(
                    (SELECT amount FROM budgets WHERE user_id = ? AND month < ?
                     ORDER BY month DESC LIMIT 1),
                    ?
                )
            )
            """,
            (user_id, month, user_id, month, DEFAULT_BUDGET),
        )
        row = connection.execute(
            "SELECT amount FROM budgets WHERE user_id = ? AND month = ?",
            (user_id, month),
        ).fetchone()
        return int(row["amount"])

    def month_summary(
        connection: sqlite3.Connection, user_id: int, month: str
    ) -> dict[str, Any]:
        row = connection.execute(
            """
            SELECT COUNT(*) AS transaction_count, COALESCE(SUM(amount), 0) AS spent
            FROM transactions
            WHERE user_id = ? AND substr(date, 1, 7) = ?
            """,
            (user_id, month),
        ).fetchone()
        return {
            "month": month,
            "budget": budget_for_month(connection, user_id, month),
            "spent": int(row["spent"]),
            "transaction_count": int(row["transaction_count"]),
        }

    def transaction_list(
        connection: sqlite3.Connection, user_id: int, month: str
    ) -> list[dict[str, Any]]:
        rows = connection.execute(
            """
            SELECT id, name, category, amount, date
            FROM transactions
            WHERE user_id = ? AND substr(date, 1, 7) = ?
            ORDER BY date DESC, id DESC
            """,
            (user_id, month),
        ).fetchall()
        return [dict(row) for row in rows]

    initialize_database()

    @app.before_request
    def require_authenticated_api() -> Any:
        public_paths = {
            "/api/auth/register",
            "/api/auth/login",
            "/api/auth/session",
            "/api/auth/logout",
        }
        if request.path.startswith("/api/") and request.path not in public_paths:
            if not isinstance(session.get("user_id"), int):
                return jsonify(error="Silakan masuk untuk mengakses data."), 401
        return None

    @app.errorhandler(400)
    @app.errorhandler(404)
    def handle_http_error(error: Any) -> tuple[Any, int]:
        return jsonify(error=str(error.description)), error.code

    @app.get("/")
    def index() -> Any:
        return send_from_directory(BASE_DIR, "index.html")

    @app.get("/<path:filename>")
    def frontend_file(filename: str) -> Any:
        if filename in {"app.js", "styles.css"}:
            return send_from_directory(BASE_DIR, filename)
        abort(404, description="Halaman tidak ditemukan.")

    @app.get("/api/auth/session")
    def auth_session() -> Any:
        user_id = session.get("user_id")
        if not isinstance(user_id, int):
            return jsonify(authenticated=False)
        with connect_db() as connection:
            user = connection.execute(
                "SELECT username FROM users WHERE id = ?", (user_id,)
            ).fetchone()
        if user is None:
            session.clear()
            return jsonify(authenticated=False)
        return jsonify(authenticated=True, username=user["username"])

    @app.post("/api/auth/register")
    def register() -> Any:
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            abort(400, description="Data pendaftaran tidak valid.")
        username = payload.get("username")
        password = payload.get("password")
        if not isinstance(username, str) or not USERNAME_PATTERN.fullmatch(username):
            abort(
                400,
                description="Username harus 3–30 karakter dan hanya memakai huruf, angka, titik, garis bawah, atau tanda hubung.",
            )
        if (
            not isinstance(password, str)
            or not PASSWORD_MIN_LENGTH <= len(password) <= 128
        ):
            abort(
                400,
                description=f"Password harus terdiri dari {PASSWORD_MIN_LENGTH}–128 karakter.",
            )
        try:
            with connect_db() as connection:
                cursor = connection.execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                    (username, generate_password_hash(password, method="scrypt")),
                )
                user_id = cursor.lastrowid
        except sqlite3.IntegrityError:
            return jsonify(error="Username tersebut sudah digunakan."), 409
        session.clear()
        session["user_id"] = user_id
        return jsonify(authenticated=True, username=username), 201

    @app.post("/api/auth/login")
    def login() -> Any:
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            abort(400, description="Data login tidak valid.")
        username = payload.get("username")
        password = payload.get("password")
        if not isinstance(username, str) or not isinstance(password, str):
            abort(400, description="Username dan password wajib diisi.")
        with connect_db() as connection:
            user = connection.execute(
                "SELECT id, username, password_hash FROM users WHERE username = ?",
                (username.strip(),),
            ).fetchone()
        if user is None or not check_password_hash(user["password_hash"], password):
            return jsonify(error="Username atau password salah."), 401
        session.clear()
        session["user_id"] = int(user["id"])
        return jsonify(authenticated=True, username=user["username"])

    @app.post("/api/auth/logout")
    def logout() -> Any:
        session.clear()
        return jsonify(authenticated=False)

    @app.get("/api/dashboard")
    def dashboard() -> Any:
        user_id = int(session["user_id"])
        month = current_month()
        with connect_db() as connection:
            summary = month_summary(connection, user_id, month)
            summary["transactions"] = transaction_list(connection, user_id, month)
            history = connection.execute(
                """
                SELECT substr(date, 1, 7) AS month
                FROM transactions
                WHERE user_id = ? AND substr(date, 1, 7) < ?
                GROUP BY substr(date, 1, 7)
                ORDER BY month DESC
                """,
                (user_id, month),
            ).fetchall()
            summary["history"] = [
                month_summary(connection, user_id, row["month"]) for row in history
            ]
            return jsonify(summary)

    @app.post("/api/transactions")
    def add_transaction() -> Any:
        user_id = int(session["user_id"])
        transaction = parse_transaction(request.get_json(silent=True))
        with connect_db() as connection:
            cursor = connection.execute(
                """
                INSERT INTO transactions (user_id, name, category, amount, date)
                VALUES (:user_id, :name, :category, :amount, :date)
                """,
                {"user_id": user_id, **transaction},
            )
            transaction["id"] = cursor.lastrowid
        return jsonify(transaction), 201

    @app.put("/api/budget")
    def update_budget() -> Any:
        user_id = int(session["user_id"])
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            abort(400, description="Data anggaran tidak valid.")
        amount = payload.get("amount")
        if isinstance(amount, bool) or not isinstance(amount, (int, float)) or int(amount) != amount or amount < 1:
            abort(400, description="Anggaran harus berupa rupiah bulat lebih besar dari nol.")

        month = current_month()
        with connect_db() as connection:
            connection.execute(
                """
                INSERT INTO budgets (user_id, month, amount) VALUES (?, ?, ?)
                ON CONFLICT(user_id, month) DO UPDATE SET amount = excluded.amount
                """,
                (user_id, month, int(amount)),
            )
        return jsonify({"month": month, "budget": int(amount)})

    @app.get("/api/history")
    def history_list() -> Any:
        user_id = int(session["user_id"])
        month = current_month()
        with connect_db() as connection:
            rows = connection.execute(
                """
                SELECT substr(date, 1, 7) AS month
                FROM transactions
                WHERE user_id = ? AND substr(date, 1, 7) < ?
                GROUP BY substr(date, 1, 7)
                ORDER BY month DESC
                """,
                (user_id, month),
            ).fetchall()
            return jsonify([
                month_summary(connection, user_id, row["month"]) for row in rows
            ])

    @app.get("/api/history/<month>")
    def history_detail(month: str) -> Any:
        user_id = int(session["user_id"])
        if not MONTH_PATTERN.fullmatch(month) or month >= current_month():
            abort(404, description="Riwayat bulan tersebut tidak tersedia.")
        with connect_db() as connection:
            transactions = transaction_list(connection, user_id, month)
            if not transactions:
                abort(404, description="Belum ada transaksi pada bulan tersebut.")
            summary = month_summary(connection, user_id, month)
            totals: dict[str, int] = {}
            for transaction in transactions:
                category = transaction["category"]
                totals[category] = totals.get(category, 0) + int(transaction["amount"])
            summary["transactions"] = transactions
            summary["categories"] = [
                {"category": category, "amount": amount}
                for category, amount in sorted(totals.items(), key=lambda item: item[1], reverse=True)
            ]
            return jsonify(summary)

    @app.post("/api/migrate")
    def migrate_browser_data() -> Any:
        user_id = int(session["user_id"])
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict) or not isinstance(payload.get("transactions"), list):
            abort(400, description="Data lama dari browser tidak valid.")
        budget = payload.get("budget")
        if isinstance(budget, bool) or not isinstance(budget, (int, float)) or int(budget) != budget or budget < 1:
            abort(400, description="Anggaran lama tidak valid.")
        transactions = [parse_transaction(item) for item in payload["transactions"]]

        with connect_db() as connection:
            existing = connection.execute(
                "SELECT COUNT(*) AS count FROM transactions WHERE user_id = ?",
                (user_id,),
            ).fetchone()
            if existing["count"]:
                return jsonify({"imported": False, "reason": "database_not_empty"})
            month = current_month()
            connection.execute(
                """
                INSERT INTO budgets (user_id, month, amount) VALUES (?, ?, ?)
                ON CONFLICT(user_id, month) DO UPDATE SET amount = excluded.amount
                """,
                (user_id, month, int(budget)),
            )
            for transaction in transactions:
                connection.execute(
                    """
                    INSERT INTO transactions (user_id, name, category, amount, date)
                    VALUES (:user_id, :name, :category, :amount, :date)
                    """,
                    {"user_id": user_id, **transaction},
                )
        return jsonify({"imported": True, "count": len(transactions)})

    return app


app = create_app()


if __name__ == "__main__":
    app.run(debug=True)
