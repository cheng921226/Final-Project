import unittest
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock, patch

from services import lecture_processing as jobs

NOW = datetime(2026, 11, 23, tzinfo=timezone.utc)


def row(component="summary", *, minutes=0, status="processing", lecture_id=7):
    return {"lecture_id": lecture_id, "component": component, "status": status,
            "started_at": (NOW - timedelta(hours=2)).isoformat(),
            "updated_at": (NOW - timedelta(minutes=minutes)).isoformat()}


class Query:
    def __init__(self, database):
        self.database = database
        self.filters = []
        self.values = None

    def select(self, *_):
        return self

    def eq(self, key, value):
        self.filters.append((key, value))
        return self

    def is_(self, key, value):
        return self.eq(key, None if value == "null" else value)

    def update(self, values):
        self.values = values
        return self

    def execute(self):
        if self.values and self.database.before_update:
            self.database.before_update()
            self.database.before_update = None
        matches = [r for r in self.database.rows
                   if all(r.get(key) == value for key, value in self.filters)]
        if self.values:
            for match in matches:
                match.update(self.values)
        return SimpleNamespace(data=deepcopy(matches))


class Database:
    def __init__(self, rows):
        self.rows = deepcopy(rows)
        self.before_update = None

    def table(self, _):
        return Query(self)


class ImmediateThread:
    def __init__(self, *, target, **_):
        self.target = target
        self.ident = None

    def start(self):
        self.ident = 1
        self.target()

    def join(self, **_):
        pass


class GenerationHeartbeatTests(unittest.TestCase):
    def setUp(self):
        self.clock = patch.object(jobs, "_now", return_value=NOW)
        self.clock.start()
        self.addCleanup(self.clock.stop)

    def test_long_running_step_with_recent_heartbeat_is_still_busy(self):
        database = Database([row(minutes=1)])
        with patch.object(jobs, "supabase_admin", database):
            self.assertTrue(jobs.generation_is_busy(7, "summary"))
        self.assertEqual(database.rows[0]["status"], "processing")

    def test_read_expires_abandoned_processing_and_waiting_steps(self):
        database = Database([row(minutes=11), row("mindmap", minutes=12, status="pending")])
        with patch.object(jobs, "supabase_admin", database):
            statuses = jobs.get_generation_statuses(7)
        self.assertEqual({r["status"] for r in statuses.values()}, {"failed"})
        self.assertIn("請重新生成", statuses["summary"]["error_message"])
        self.assertEqual({r["status"] for r in database.rows}, {"failed"})

    def test_waiting_steps_are_preserved_while_same_lecture_is_alive(self):
        rows = [row(minutes=1), row("questions", minutes=60, status="pending"),
                row("mindmap", minutes=60, status="pending", lecture_id=8)]
        database = Database(rows)
        with patch.object(jobs, "supabase_admin", database):
            result = jobs.reconcile_generation_statuses(rows)
        self.assertEqual([r["status"] for r in result], ["processing", "pending", "failed"])

    def test_waiting_step_is_not_expired_between_successive_pipeline_steps(self):
        rows = [row(minutes=0, status="completed"), row("questions", minutes=60, status="pending")]
        with patch.object(jobs, "supabase_admin", Database(rows)):
            result = jobs.reconcile_generation_statuses(rows)
        self.assertEqual(result[1]["status"], "pending")

    def test_new_heartbeat_wins_race_with_expiry(self):
        original = row(minutes=11)
        database = Database([original])
        database.before_update = lambda: database.rows[0].update(updated_at=NOW.isoformat())
        with patch.object(jobs, "supabase_admin", database):
            jobs.reconcile_generation_statuses([original])
        self.assertEqual(database.rows[0]["status"], "processing")

    def test_late_worker_cannot_complete_a_newer_run(self):
        original = row()
        database = Database([{**original, "started_at": NOW.isoformat()}])
        with patch.object(jobs, "supabase_admin", database):
            result = jobs.set_generation_status(7, "summary", "completed",
                                                expected_started_at=original["started_at"])
        self.assertIsNone(result)
        self.assertEqual(database.rows[0]["status"], "processing")

    def test_heartbeat_refreshes_only_current_run_and_stops_on_exit(self):
        original = row(minutes=1)
        database = Database([original])
        event = Mock()
        event.wait.side_effect = [False, True]
        with (patch.object(jobs, "supabase_admin", database),
              patch.object(jobs, "Event", return_value=event),
              patch.object(jobs, "Thread", ImmediateThread)):
            with jobs.generation_heartbeat(7, "summary") as identity:
                self.assertEqual(identity, original["started_at"])
        self.assertEqual(database.rows[0]["updated_at"], NOW.isoformat())
        self.assertEqual(database.rows[0]["started_at"], original["started_at"])
        event.wait.assert_any_call(60)
        event.set.assert_called_once()

    def test_heartbeat_is_stopped_if_work_raises(self):
        event = Mock()
        event.wait.return_value = True
        with (patch.object(jobs, "supabase_admin", Database([row()])),
              patch.object(jobs, "Event", return_value=event),
              patch.object(jobs, "Thread", ImmediateThread)):
            with self.assertRaisesRegex(RuntimeError, "AI error"):
                with jobs.generation_heartbeat(7, "summary"):
                    raise RuntimeError("AI error")
        event.set.assert_called_once()


if __name__ == "__main__":
    unittest.main()
