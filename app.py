from flask import Flask, render_template, request, jsonify, redirect, url_for, session, flash
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps
import sqlite3
import os
from pathlib import Path
from datetime import date

app = Flask(__name__)
app.secret_key = os.environ.get("TASKFLOW_SECRET_KEY", "change-this-development-key-before-deployment")
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax")
DB_PATH = Path(__file__).with_name("taskflow.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("user_id"):
            if request.path.startswith("/api/"):
                return jsonify({"error": "Please log in to continue", "auth_required": True}), 401
            return redirect(url_for("login"))
        return view(*args, **kwargs)
    return wrapped

def init_db():
    with get_db() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT DEFAULT '',
                status TEXT NOT NULL DEFAULT 'To Do'
                    CHECK(status IN ('To Do', 'In Progress', 'Done')),
                priority TEXT NOT NULL DEFAULT 'Medium'
                    CHECK(priority IN ('Low', 'Medium', 'High')),
                due_date TEXT DEFAULT '',
                project_id INTEGER,
                assignee_id INTEGER,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL,
                FOREIGN KEY(assignee_id) REFERENCES members(id) ON DELETE SET NULL
            );
        """)

        # Safe, repeatable migration: add ownership columns without dropping existing data.
        for table in ("projects", "members", "tasks"):
            columns = {row["name"] for row in db.execute(f"PRAGMA table_info({table})")}
            if "user_id" not in columns:
                db.execute(f"ALTER TABLE {table} ADD COLUMN user_id INTEGER")

        # Remove the original TaskFlow demo workspace, if it exists.
        # Only exact seeded task titles under the exact default project are removed.
        demo_project = db.execute(
            "SELECT id FROM projects WHERE name = ? AND description = ?",
            ("TaskFlow Website", "Build our project management app")
        ).fetchall()
        for project in demo_project:
            project_id = project["id"]
            demo_tasks = db.execute("""
                SELECT id, assignee_id FROM tasks
                WHERE project_id = ? AND title IN (?, ?, ?, ?)
            """, (project_id, "Design dashboard", "Build task board",
                  "Connect database", "Test application")).fetchall()
            seeded_member_ids = {row["assignee_id"] for row in demo_tasks if row["assignee_id"] is not None}
            if demo_tasks:
                db.executemany("DELETE FROM tasks WHERE id = ?", [(row["id"],) for row in demo_tasks])
            db.execute("DELETE FROM projects WHERE id = ?", (project_id,))
            # Remove only members assigned to those seeded demo tasks, and only if no
            # remaining task uses them. Any member used by real tasks is preserved.
            for member_id in seeded_member_ids:
                still_used = db.execute(
                    "SELECT 1 FROM tasks WHERE assignee_id = ? LIMIT 1", (member_id,)
                ).fetchone()
                if not still_used:
                    db.execute("DELETE FROM members WHERE id = ?", (member_id,))

def task_dict(row):
    task = dict(row)
    task["overdue"] = bool(
        task.get("due_date")
        and task["due_date"] < date.today().isoformat()
        and task["status"] != "Done"
    )
    return task

@app.route("/")
def home():
    # Always show login first for signed-out users.
    # Signed-in users go to the dashboard route below.
    if session.get("user_id"):
        return redirect(url_for("dashboard"))
    return redirect(url_for("login"))


@app.route("/dashboard")
@login_required
def dashboard():
    return render_template("index.html")

@app.route("/register", methods=["GET", "POST"])
def register():
    if session.get("user_id"):
        return redirect(url_for("home"))
    if request.method == "POST":
        name = request.form.get("name", "").strip()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        if not name or not email or not password:
            flash("Please fill in every field.", "error")
        elif len(name) > 80:
            flash("Name must be 80 characters or fewer.", "error")
        elif len(password) < 8:
            flash("Password must be at least 8 characters.", "error")
        else:
            try:
                with get_db() as db:
                    first_account = db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0
                    cur = db.execute(
                        "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
                        (name, email, generate_password_hash(password))
                    )
                    user_id = cur.lastrowid
                    if first_account:
                        # Preserve any existing pre-login data by assigning it to the first account.
                        for table in ("projects", "members", "tasks"):
                            db.execute(f"UPDATE {table} SET user_id = ? WHERE user_id IS NULL", (user_id,))
                session.clear()
                session["user_id"] = user_id
                session["user_name"] = name
                session.permanent = True
                return redirect(url_for("home"))
            except sqlite3.IntegrityError:
                flash("An account with that email already exists.", "error")
    return render_template("auth.html", mode="register")

@app.route("/login", methods=["GET", "POST"])
def login():
    if session.get("user_id"):
        return redirect(url_for("home"))
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        with get_db() as db:
            user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if user and check_password_hash(user["password_hash"], password):
            session.clear()
            session["user_id"] = user["id"]
            session["user_name"] = user["name"]
            session.permanent = True
            return redirect(url_for("home"))
        flash("Email or password is incorrect.", "error")
    return render_template("auth.html", mode="login")

@app.post("/logout")
@login_required
def logout():
    session.clear()
    return redirect(url_for("login"))

@app.get("/api/me")
@login_required
def me():
    return jsonify({"id": session["user_id"], "name": session.get("user_name", "User")})

@app.get("/api/overview")
@login_required
def overview():
    user_id = session["user_id"]
    with get_db() as db:
        tasks = db.execute("""
            SELECT t.*, p.name AS project_name, m.name AS assignee_name
            FROM tasks t
            LEFT JOIN projects p ON t.project_id = p.id AND p.user_id = ?
            LEFT JOIN members m ON t.assignee_id = m.id AND m.user_id = ?
            WHERE t.user_id = ?
            ORDER BY t.id DESC
        """, (user_id, user_id, user_id)).fetchall()
        projects = db.execute("SELECT * FROM projects WHERE user_id = ? ORDER BY id DESC", (user_id,)).fetchall()
        members = db.execute("SELECT * FROM members WHERE user_id = ? ORDER BY name", (user_id,)).fetchall()

    task_list = [task_dict(t) for t in tasks]
    total = len(task_list)
    completed = sum(t["status"] == "Done" for t in task_list)
    return jsonify({
        "tasks": task_list,
        "projects": [dict(p) for p in projects],
        "members": [dict(m) for m in members],
        "stats": {
            "total": total,
            "completed": completed,
            "in_progress": sum(t["status"] == "In Progress" for t in task_list),
            "overdue": sum(t["overdue"] for t in task_list),
            "completion": round(completed * 100 / total) if total else 0
        }
    })

@app.post("/api/tasks")
@login_required
def create_task():
    data = request.get_json(silent=True) or {}
    title = str(data.get("title", "")).strip()
    if not title:
        return jsonify({"error": "Task title is required"}), 400
    status, priority = data.get("status", "To Do"), data.get("priority", "Medium")
    if status not in ("To Do", "In Progress", "Done"):
        return jsonify({"error": "Invalid status"}), 400
    if priority not in ("Low", "Medium", "High"):
        return jsonify({"error": "Invalid priority"}), 400

    user_id = session["user_id"]
    project_id = data.get("project_id") or None
    assignee_id = data.get("assignee_id") or None
    with get_db() as db:
        if project_id and not db.execute("SELECT 1 FROM projects WHERE id=? AND user_id=?", (project_id, user_id)).fetchone():
            return jsonify({"error": "Invalid project"}), 400
        if assignee_id and not db.execute("SELECT 1 FROM members WHERE id=? AND user_id=?", (assignee_id, user_id)).fetchone():
            return jsonify({"error": "Invalid team member"}), 400
        cursor = db.execute("""
            INSERT INTO tasks (title, description, status, priority, due_date, project_id, assignee_id, user_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (title, str(data.get("description", "")).strip(), status, priority,
              str(data.get("due_date", "")), project_id, assignee_id, user_id))
    return jsonify({"message": "Task created", "id": cursor.lastrowid}), 201

@app.patch("/api/tasks/<int:task_id>")
@login_required
def update_task(task_id):
    data = request.get_json(silent=True) or {}
    allowed = {"title", "description", "status", "priority", "due_date", "project_id", "assignee_id"}
    if not data or not set(data).issubset(allowed):
        return jsonify({"error": "Invalid task fields"}), 400
    if "title" in data and not str(data["title"]).strip():
        return jsonify({"error": "Task title cannot be empty"}), 400
    if "status" in data and data["status"] not in ("To Do", "In Progress", "Done"):
        return jsonify({"error": "Invalid status"}), 400
    if "priority" in data and data["priority"] not in ("Low", "Medium", "High"):
        return jsonify({"error": "Invalid priority"}), 400

    user_id = session["user_id"]
    for key, table in (("project_id", "projects"), ("assignee_id", "members")):
        if key in data and data[key]:
            with get_db() as db:
                if not db.execute(f"SELECT 1 FROM {table} WHERE id=? AND user_id=?", (data[key], user_id)).fetchone():
                    return jsonify({"error": f"Invalid {key.replace('_id', '')}"}), 400

    fields, values = [], []
    for key, value in data.items():
        fields.append(f"{key} = ?")
        if key in ("title", "description", "due_date"):
            values.append(str(value or "").strip())
        elif key in ("project_id", "assignee_id"):
            values.append(value or None)
        else:
            values.append(value)
    values.extend([task_id, user_id])
    with get_db() as db:
        cursor = db.execute(f"UPDATE tasks SET {', '.join(fields)} WHERE id = ? AND user_id = ?", values)
        if cursor.rowcount == 0:
            return jsonify({"error": "Task not found"}), 404
    return jsonify({"message": "Task updated"})

@app.delete("/api/tasks/<int:task_id>")
@login_required
def delete_task(task_id):
    with get_db() as db:
        cursor = db.execute("DELETE FROM tasks WHERE id = ? AND user_id = ?", (task_id, session["user_id"]))
        if cursor.rowcount == 0:
            return jsonify({"error": "Task not found"}), 404
    return jsonify({"message": "Task deleted"})

@app.post("/api/projects")
@login_required
def create_project():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    if not name:
        return jsonify({"error": "Project name is required"}), 400
    with get_db() as db:
        cursor = db.execute(
            "INSERT INTO projects (name, description, user_id) VALUES (?, ?, ?)",
            (name, str(data.get("description", "")).strip(), session["user_id"])
        )
    return jsonify({"message": "Project created", "id": cursor.lastrowid}), 201

@app.post("/api/members")
@login_required
def create_member():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    if not name:
        return jsonify({"error": "Member name is required"}), 400
    with get_db() as db:
        cursor = db.execute("INSERT INTO members (name, user_id) VALUES (?, ?)", (name, session["user_id"]))
    return jsonify({"message": "Member added", "id": cursor.lastrowid}), 201


@app.delete("/api/projects/<int:project_id>")
@login_required
def delete_project(project_id):
    user_id = session["user_id"]

    with get_db() as db:
        project = db.execute(
            "SELECT id FROM projects WHERE id = ? AND user_id = ?",
            (project_id, user_id)
        ).fetchone()

        if project is None:
            return jsonify({"error": "Project not found"}), 404

        db.execute(
            "DELETE FROM projects WHERE id = ? AND user_id = ?",
            (project_id, user_id)
        )

    return jsonify({"message": "Project deleted"}), 200


@app.delete("/api/members/<int:member_id>")
@login_required
def delete_member(member_id):
    user_id = session["user_id"]

    with get_db() as db:
        member = db.execute(
            "SELECT id FROM members WHERE id = ? AND user_id = ?",
            (member_id, user_id)
        ).fetchone()

        if member is None:
            return jsonify({"error": "Member not found"}), 404

        db.execute(
            "DELETE FROM members WHERE id = ? AND user_id = ?",
            (member_id, user_id)
        )

    return jsonify({"message": "Member deleted"}), 200

init_db()

if __name__ == "__main__":
    app.run(debug=True, port=5000)
