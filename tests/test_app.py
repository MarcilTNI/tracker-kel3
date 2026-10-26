import json
import sqlite3
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from app import DEFAULT_BUDGET, create_app, current_month


class ExpenseTrackerApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_directory = tempfile.TemporaryDirectory()
        database = Path(self.temp_directory.name) / "test.sqlite3"
        self.app = create_app({
            "TESTING": True,
            "DATABASE": str(database),
            "SECRET_KEY": "test-secret-key",
        })
        self.client = self.app.test_client()
        self.client.post(
            "/api/auth/register",
            json={"username": "test-user", "password": "password123"},
        )

    def tearDown(self) -> None:
        self.temp_directory.cleanup()

    def test_vercel_requires_postgres_url_and_persistent_session_secret(self) -> None:
        with patch.dict("os.environ", {"VERCEL": "1"}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "RAPI_SECRET_KEY"):
                create_app({"TESTING": True, "DATABASE": ":memory:"})

        with patch.dict(
            "os.environ",
            {"VERCEL": "1", "RAPI_SECRET_KEY": "persistent-secret"},
            clear=True,
        ):
            with self.assertRaisesRegex(RuntimeError, "DATABASE_URL"):
                create_app({"TESTING": True, "DATABASE": ":memory:"})

    def test_data_endpoints_require_login(self) -> None:
        unauthenticated_client = self.app.test_client()

        response = unauthenticated_client.get("/api/dashboard")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json["error"], "Silakan masuk untuk mengakses data.")

    def test_registration_and_login(self) -> None:
        duplicate = self.app.test_client().post(
            "/api/auth/register",
            json={"username": "TEST-USER", "password": "password123"},
        )
        client = self.app.test_client()
        login = client.post(
            "/api/auth/login",
            json={"username": "test-user", "password": "password123"},
        )
        wrong_password = self.app.test_client().post(
            "/api/auth/login",
            json={"username": "test-user", "password": "wrong-password"},
        )

        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.json["username"], "test-user")
        self.assertEqual(wrong_password.status_code, 401)

    def test_users_only_see_their_own_transactions_and_budgets(self) -> None:
        self.client.put("/api/budget", json={"amount": 2_000_000})
        self.client.post(
            "/api/transactions",
            json={
                "name": "Makan siang",
                "category": "food",
                "amount": 12_345,
                "date": date.today().isoformat(),
            },
        )

        second_client = self.app.test_client()
        registration = second_client.post(
            "/api/auth/register",
            json={"username": "second-user", "password": "password456"},
        )
        second_dashboard = second_client.get("/api/dashboard")

        self.assertEqual(registration.status_code, 201)
        self.assertEqual(second_dashboard.status_code, 200)
        self.assertEqual(second_dashboard.json["budget"], DEFAULT_BUDGET)
        self.assertEqual(second_dashboard.json["transactions"], [])
        self.assertEqual(self.client.get("/api/dashboard").json["budget"], 2_000_000)

    def test_old_shared_database_data_is_discarded_during_migration(self) -> None:
        database = Path(self.temp_directory.name) / "legacy.sqlite3"
        connection = sqlite3.connect(database)
        try:
            connection.executescript(
                """
                CREATE TABLE budgets (month TEXT PRIMARY KEY, amount INTEGER NOT NULL);
                INSERT INTO budgets VALUES ('2026-01', 1000000);
                CREATE TABLE transactions (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    category TEXT NOT NULL,
                    amount INTEGER NOT NULL,
                    date TEXT NOT NULL
                );
                INSERT INTO transactions VALUES (1, 'Legacy', 'food', 1000, '2026-01-01');
                """
            )
        finally:
            connection.close()

        migrated_app = create_app({
            "TESTING": True,
            "DATABASE": str(database),
            "SECRET_KEY": "test-secret-key",
        })
        client = migrated_app.test_client()
        client.post(
            "/api/auth/register",
            json={"username": "new-user", "password": "password123"},
        )
        dashboard = client.get("/api/dashboard")

        self.assertEqual(dashboard.json["transactions"], [])
        self.assertEqual(dashboard.json["budget"], DEFAULT_BUDGET)

    def test_dashboard_creates_default_budget_and_empty_transactions(self) -> None:
        response = self.client.get("/api/dashboard")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["budget"], DEFAULT_BUDGET)
        self.assertEqual(response.json["transactions"], [])
        self.assertEqual(response.json["history"], [])
        self.assertEqual(response.json["month"], current_month())

    def test_add_transaction_and_update_budget(self) -> None:
        response = self.client.post(
            "/api/transactions",
            json={
                "name": "Makan siang",
                "category": "food",
                "amount": 12_345,
                "date": date.today().isoformat(),
            },
        )
        budget_response = self.client.put("/api/budget", json={"amount": 2_000_005})

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json["amount"], 12_345)
        self.assertEqual(budget_response.status_code, 200)
        self.assertEqual(budget_response.json["budget"], 2_000_005)
        dashboard = self.client.get("/api/dashboard").json
        self.assertEqual(dashboard["budget"], 2_000_005)
        self.assertEqual(len(dashboard["transactions"]), 1)

    def test_previous_month_transactions_appear_in_printable_history_data(self) -> None:
        today = date.today()
        previous_month_date = date.fromordinal(date(today.year, today.month, 1).toordinal() - 1)
        month = previous_month_date.strftime("%Y-%m")
        with patch("app.current_month", return_value=month):
            response = self.client.post(
                "/api/transactions",
                json={
                    "name": "Buku kuliah",
                    "category": "college",
                    "amount": 85_000,
                    "date": previous_month_date.isoformat(),
                },
            )

        self.assertEqual(response.status_code, 201)
        history = self.client.get("/api/history")
        self.assertEqual(history.status_code, 200)
        self.assertEqual(history.json[0]["month"], month)
        self.assertEqual(history.json[0]["spent"], 85_000)
        detail = self.client.get(f"/api/history/{month}")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json["transactions"][0]["name"], "Buku kuliah")
        self.assertEqual(detail.json["categories"], [{"category": "college", "amount": 85_000}])

    def test_invalid_transaction_is_rejected(self) -> None:
        response = self.client.post(
            "/api/transactions",
            data=json.dumps({
                "name": "Pengeluaran",
                "category": "food",
                "amount": 0,
                "date": date.today().isoformat(),
            }),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.json)

    def test_transactions_outside_current_month_are_rejected(self) -> None:
        today = date.today()
        first_day = date(today.year, today.month, 1)
        previous_month_date = date.fromordinal(first_day.toordinal() - 1)
        if today.month == 12:
            next_month_date = date(today.year + 1, 1, 1)
        else:
            next_month_date = date(today.year, today.month + 1, 1)

        for transaction_date in (previous_month_date, next_month_date):
            with self.subTest(transaction_date=transaction_date):
                response = self.client.post(
                    "/api/transactions",
                    json={
                        "name": "Transaksi di luar bulan ini",
                        "category": "food",
                        "amount": 1_000,
                        "date": transaction_date.isoformat(),
                    },
                )

                self.assertEqual(response.status_code, 400)
                self.assertIn("bulan berjalan", response.json["error"])

        self.assertEqual(self.client.get("/api/dashboard").json["transactions"], [])

    def test_legacy_browser_data_imports_once(self) -> None:
        payload = {
            "budget": 1_750_000,
            "transactions": [{
                "name": "Transport kampus",
                "category": "transport",
                "amount": 20_000,
                "date": date.today().isoformat(),
            }],
        }

        first_import = self.client.post("/api/migrate", json=payload)
        second_import = self.client.post("/api/migrate", json=payload)

        self.assertEqual(first_import.status_code, 200)
        self.assertEqual(first_import.json["count"], 1)
        self.assertEqual(second_import.status_code, 200)
        self.assertFalse(second_import.json["imported"])
        self.assertEqual(len(self.client.get("/api/dashboard").json["transactions"]), 1)


if __name__ == "__main__":
    unittest.main()
