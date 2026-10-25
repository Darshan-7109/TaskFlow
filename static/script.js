
const $ = (selector) => document.querySelector(selector);

const state = {
    tasks: [],
    projects: [],
    members: [],
    stats: {},
    view: "dashboard",
    entityType: "project",
    pendingDelete: null
};

const columns = ["To Do", "In Progress", "Done"];

async function api(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...options.headers
        }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || "Something went wrong.");
    }

    return data;
}

function escapeHTML(value = "") {
    return String(value).replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

function toast(message) {
    const element = $("#toast");
    element.textContent = message;
    element.classList.add("show");

    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove("show"), 2600);
}

function showError(message) {
    $("#form-error").textContent = message;
}

function initials(name = "") {
    return name.trim().split(/\s+/).slice(0, 2)
        .map(part => part[0] || "").join("").toUpperCase() || "?";
}

function dateLabel(value) {
    if (!value) return "No deadline";

    const parsed = new Date(value + "T00:00:00");

    return Number.isNaN(parsed.getTime())
        ? escapeHTML(value)
        : parsed.toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short"
        });
}

function navigate(view) {
    state.view = view;

    document.querySelectorAll(".page").forEach(page => {
        page.classList.toggle("hidden", page.id !== `${view}-view`);
    });

    document.querySelectorAll(".nav-item").forEach(button => {
        button.classList.toggle("active", button.dataset.view === view);
    });

    const names = {
        dashboard: "Overview",
        board: "My Tasks",
        projects: "Projects",
        team: "Team Members"
    };

    $("#page-name").textContent = names[view] || "Overview";
}

function updateSelect(select, items, placeholder, selected = "") {
    const previous = String(selected || select.value || "");

    select.innerHTML =
        `<option value="">${escapeHTML(placeholder)}</option>` +
        items.map(item =>
            `<option value="${item.id}">${escapeHTML(item.name)}</option>`
        ).join("");

    select.value = items.some(item => String(item.id) === previous)
        ? previous : "";
}

async function refresh() {
    try {
        const data = await api("/api/overview");

        state.tasks = data.tasks;
        state.projects = data.projects;
        state.members = data.members;
        state.stats = data.stats;

        renderAll();
    } catch (error) {
        toast(`Unable to load data: ${error.message}`);
    }
}

function renderAll() {
    renderStats();
    renderPreview();
    renderProgress();
    renderProjects();
    renderFilters();
    renderBoard();
    renderTeam();
}

function renderStats() {
    const stats = state.stats;

    $("#total").textContent = stats.total ?? 0;
    $("#completed").textContent = stats.completed ?? 0;
    $("#in-progress").textContent = stats.in_progress ?? 0;
    $("#overdue").textContent = stats.overdue ?? 0;
}

function renderProgress() {
    const stats = state.stats;
    const completion = stats.completion ?? 0;

    $("#completion").textContent = `${completion}%`;
    $("#progress-ring").style.setProperty("--progress", `${completion}%`);

    $("#legend-done").textContent = stats.completed ?? 0;
    $("#legend-progress").textContent = stats.in_progress ?? 0;
    $("#legend-todo").textContent =
        state.tasks.filter(task => task.status === "To Do").length;
}

function renderPreview() {
    const tasks = state.tasks.slice(0, 5);

    $("#board-preview").innerHTML = tasks.length
        ? tasks.map(task => `
            <div class="preview-item">
                <button
                    class="task-check ${task.status === "Done" ? "checked" : ""}"
                    data-action="complete"
                    data-id="${task.id}"
                    aria-label="Toggle task completion"
                    title="Mark complete or reopen"
                >${task.status === "Done" ? "✓" : ""}</button>

                <div>
                    <div class="preview-title">${escapeHTML(task.title)}</div>
                    <div class="preview-sub">
                        ${escapeHTML(task.project_name || "Unassigned project")}
                        · ${escapeHTML(task.assignee_name || "Unassigned")}
                    </div>
                </div>

                <div class="preview-end">
                    <span class="priority ${task.priority}">
                        ${escapeHTML(task.priority)}
                    </span>
                </div>
            </div>
        `).join("")
        : `<p class="muted">No tasks yet. Create your first task.</p>`;
}

function projectProgress(projectId) {
    const tasks = state.tasks.filter(
        task => String(task.project_id) === String(projectId)
    );

    const completed = tasks.filter(task => task.status === "Done").length;

    return {
        total: tasks.length,
        completed,
        percent: tasks.length ? Math.round(completed * 100 / tasks.length) : 0
    };
}

function projectCard(project) {
    const progress = projectProgress(project.id);

    return `
        <article class="project-card">
            <div class="project-card-top">
                <div class="project-symbol">▧</div>
                <button class="small-btn danger-outline" data-action="delete-project" data-id="${project.id}" aria-label="Delete ${escapeHTML(project.name)}">Delete</button>
            </div>
            <h3>${escapeHTML(project.name)}</h3>
            <p>${escapeHTML(project.description || "No description provided.")}</p>

            <div class="project-meta">
                <span>${progress.completed}/${progress.total} completed</span>
                <span>${progress.percent}%</span>
            </div>

            <div
                class="mini-progress"
                role="progressbar"
                aria-valuenow="${progress.percent}"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-label="${escapeHTML(project.name)} completion"
            >
                <span style="width:${progress.percent}%"></span>
            </div>
        </article>
    `;
}

function renderProjects() {
    const content = state.projects.length
        ? state.projects.map(projectCard).join("")
        : `<p class="muted">No projects created yet.</p>`;

    $("#project-preview").innerHTML = content;
    $("#all-projects").innerHTML = content;
}

function renderFilters() {
    const filter = $("#project-filter");
    const current = filter.value;

    updateSelect(filter, state.projects, "All projects", current);
    updateSelect($("#task-project"), state.projects, "No project");
    updateSelect($("#task-assignee"), state.members, "Unassigned");
}

function filteredTasks() {
    const search = $("#task-search").value.trim().toLowerCase();
    const project = $("#project-filter").value;
    const priority = $("#priority-filter").value;

    return state.tasks.filter(task => {
        const matchesSearch =
            !search ||
            [task.title, task.description, task.assignee_name, task.project_name]
                .some(value => String(value || "").toLowerCase().includes(search));

        const matchesProject =
            !project || String(task.project_id) === project;

        const matchesPriority =
            !priority || task.priority === priority;

        return matchesSearch && matchesProject && matchesPriority;
    });
}

function taskCard(task) {
    const deadline = task.due_date
        ? `<p>◷ ${dateLabel(task.due_date)}
            ${task.overdue ? '<span class="overdue-label"> · OVERDUE</span>' : ""}
           </p>`
        : "";

    return `
        <article class="task-card">
            <span class="priority ${task.priority}">
                ${escapeHTML(task.priority)} priority
            </span>

            <h3>${escapeHTML(task.title)}</h3>

            ${task.description
                ? `<p>${escapeHTML(task.description)}</p>`
                : ""}

            <p>${escapeHTML(task.project_name || "No project")}</p>
            <p>♙ ${escapeHTML(task.assignee_name || "Unassigned")}</p>
            ${deadline}

            <div class="task-card-footer">
                <span class="preview-sub">${dateLabel(task.due_date)}</span>
                <div class="task-actions">
                    <button class="small-btn" data-action="edit" data-id="${task.id}">
                        Edit
                    </button>
                    <button class="small-btn" data-action="delete" data-id="${task.id}">
                        Delete
                    </button>
                </div>
            </div>

            <select
                class="status-select"
                data-action="status"
                data-id="${task.id}"
                aria-label="Change task status"
            >
                ${columns.map(column => `
                    <option ${task.status === column ? "selected" : ""}>
                        ${column}
                    </option>
                `).join("")}
            </select>
        </article>
    `;
}

function renderBoard() {
    const tasks = filteredTasks();

    $("#kanban").innerHTML = columns.map((column, index) => {
        const columnTasks = tasks.filter(task => task.status === column);

        const dots = ["#aab0a9", "#8ebbdc", "#79e0ac"];

        return `
            <section class="kanban-column">
                <div class="column-heading">
                    <span>
                        <span style="color:${dots[index]}">●</span>
                        ${column}
                    </span>
                    <span class="column-count">${columnTasks.length}</span>
                </div>

                <button
                    class="small-btn"
                    style="width:100%;padding:9px;margin-bottom:12px"
                    data-action="add-column-task"
                    data-status="${column}"
                >＋ Add task</button>

                ${columnTasks.length
                    ? columnTasks.map(taskCard).join("")
                    : `<p class="muted" style="padding:10px 3px">No tasks here.</p>`}
            </section>
        `;
    }).join("");
}

function renderTeam() {
    $("#team-grid").innerHTML = state.members.length
        ? state.members.map(member => {
            const tasks = state.tasks.filter(
                task => String(task.assignee_id) === String(member.id)
            );

            const done = tasks.filter(task => task.status === "Done").length;

            return `
                <article class="team-card">
                    <div class="avatar">${escapeHTML(initials(member.name))}</div>
                    <h3>${escapeHTML(member.name)}</h3>
                    <p>Team member</p>
                    <button class="small-btn danger-outline member-delete" data-action="delete-member" data-id="${member.id}">Remove member</button>

                    <div class="team-stats">
                        <div><strong>${tasks.length}</strong>Assigned</div>
                        <div><strong>${done}</strong>Completed</div>
                    </div>
                </article>
            `;
        }).join("")
        : `<p class="muted">Add a team member to get started.</p>`;
}

function openTaskModal(task = null, defaultStatus = "To Do") {
    $("#task-form").reset();
    showError("");

    $("#task-id").value = task?.id || "";
    $("#modal-title").textContent = task ? "Edit task" : "Create a task";
    $("#save-task-btn").textContent = task ? "Save Changes" : "Create Task";

    updateSelect($("#task-project"), state.projects, "No project", task?.project_id);
    updateSelect($("#task-assignee"), state.members, "Unassigned", task?.assignee_id);

    $("#task-title").value = task?.title || "";
    $("#task-description").value = task?.description || "";
    $("#task-priority").value = task?.priority || "Medium";
    $("#task-status").value = task?.status || defaultStatus;
    $("#task-due").value = task?.due_date || "";

    $("#modal").classList.remove("hidden");
    $("#task-title").focus();
}

function closeTaskModal() {
    $("#modal").classList.add("hidden");
}

async function saveTask(event) {
    event.preventDefault();
    showError("");

    const id = $("#task-id").value;

    const payload = {
        title: $("#task-title").value.trim(),
        description: $("#task-description").value.trim(),
        project_id: $("#task-project").value || null,
        assignee_id: $("#task-assignee").value || null,
        priority: $("#task-priority").value,
        status: $("#task-status").value,
        due_date: $("#task-due").value
    };

    try {
        if (id) {
            await api(`/api/tasks/${id}`, {
                method: "PATCH",
                body: JSON.stringify(payload)
            });
        } else {
            await api("/api/tasks", {
                method: "POST",
                body: JSON.stringify(payload)
            });
        }

        closeTaskModal();
        await refresh();
        toast(id ? "Task updated successfully." : "Task created successfully.");
    } catch (error) {
        showError(error.message);
    }
}

async function updateStatus(id, status) {
    try {
        await api(`/api/tasks/${id}`, {
            method: "PATCH",
            body: JSON.stringify({ status })
        });

        await refresh();
        toast("Task status updated.");
    } catch (error) {
        toast(error.message);
        await refresh();
    }
}

async function deleteTask(id) {
    const task = state.tasks.find(item => item.id === id);
    if (!task) return;

    openConfirmModal({
        title: "Delete task?",
        message: `Delete “${task.title}”? This action cannot be undone.`,
        run: async () => {
            await api(`/api/tasks/${id}`, { method: "DELETE" });
            await refresh();
            toast("Task deleted.");
        }
    });
}

function openEntityModal(type) {
    state.entityType = type;
    $("#entity-form").reset();
    $("#entity-form-error").textContent = "";
    const isProject = type === "project";
    $("#entity-eyebrow").textContent = isProject ? "PROJECT MANAGEMENT" : "TEAM MANAGEMENT";
    $("#entity-modal-title").textContent = isProject ? "Create a project" : "Add a team member";
    $("#entity-name-label").firstChild.textContent = isProject ? "Project name" : "Member name";
    $("#entity-name").placeholder = isProject ? "e.g. Website redesign" : "e.g. Alex Morgan";
    $("#entity-description-label").classList.toggle("hidden", !isProject);
    $("#save-entity-btn").textContent = isProject ? "Create project" : "Add member";
    $("#entity-modal").classList.remove("hidden");
    $("#entity-name").focus();
}

function closeEntityModal() {
    $("#entity-modal").classList.add("hidden");
}

async function saveEntity(event) {
    event.preventDefault();
    const type = state.entityType;
    const name = $("#entity-name").value.trim();
    const errorElement = $("#entity-form-error");
    errorElement.textContent = "";
    if (!name) {
        errorElement.textContent = type === "project" ? "Project name is required." : "Member name is required.";
        return;
    }

    const payload = { name };
    if (type === "project") payload.description = $("#entity-description").value.trim();

    try {
        await api(type === "project" ? "/api/projects" : "/api/members", {
            method: "POST",
            body: JSON.stringify(payload)
        });
        closeEntityModal();
        await refresh();
        toast(type === "project" ? "Project created successfully." : "Team member added.");
    } catch (error) {
        errorElement.textContent = error.message;
    }
}

function openConfirmModal({ title, message, run }) {
    state.pendingDelete = run;
    $("#confirm-title").textContent = title;
    $("#confirm-message").textContent = message;
    $("#confirm-error").textContent = "";
    $("#confirm-delete-btn").disabled = false;
    $("#confirm-delete-btn").textContent = "Delete";
    $("#confirm-modal").classList.remove("hidden");
}

function closeConfirmModal() {
    $("#confirm-modal").classList.add("hidden");
    state.pendingDelete = null;
}

async function runConfirmedDelete() {
    if (!state.pendingDelete) return;
    const action = state.pendingDelete;
    const button = $("#confirm-delete-btn");
    button.disabled = true;
    button.textContent = "Deleting…";
    $("#confirm-error").textContent = "";
    try {
        await action();
        closeConfirmModal();
    } catch (error) {
        $("#confirm-error").textContent = error.message || "Could not delete this item.";
        button.disabled = false;
        button.textContent = "Try again";
    }
}

function deleteProject(id) {
    const project = state.projects.find(item => Number(item.id) === Number(id));
    if (!project) return;
    openConfirmModal({
        title: "Delete project?",
        message: `Delete “${project.name}”? Tasks linked to this project may become unassigned.`,
        run: async () => {
            await api(`/api/projects/${id}`, { method: "DELETE" });
            await refresh();
            toast("Project deleted.");
        }
    });
}

function deleteMember(id) {
    const member = state.members.find(item => Number(item.id) === Number(id));
    if (!member) return;
    openConfirmModal({
        title: "Remove team member?",
        message: `Remove “${member.name}” from your team? Their assigned tasks may become unassigned.`,
        run: async () => {
            await api(`/api/members/${id}`, { method: "DELETE" });
            await refresh();
            toast("Team member removed.");
        }
    });
}

/* EVENT HANDLERS */

document.querySelectorAll(".nav-item").forEach(button => {
    button.addEventListener("click", () => navigate(button.dataset.view));
});

document.querySelectorAll("[data-goto]").forEach(button => {
    button.addEventListener("click", () => navigate(button.dataset.goto));
});

$("#add-task-btn").addEventListener("click", () => openTaskModal());
$("#board-add-btn").addEventListener("click", () => openTaskModal());

$("#close-modal").addEventListener("click", closeTaskModal);
$("#cancel-modal").addEventListener("click", closeTaskModal);
$("#task-form").addEventListener("submit", saveTask);

$("#modal").addEventListener("click", event => {
    if (event.target === $("#modal")) closeTaskModal();
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        closeTaskModal();
        closeEntityModal();
        closeConfirmModal();
    }
});

$("#add-project-btn").addEventListener("click", () => openEntityModal("project"));
$("#add-member-btn").addEventListener("click", () => openEntityModal("member"));
$("#close-entity-modal").addEventListener("click", closeEntityModal);
$("#cancel-entity-modal").addEventListener("click", closeEntityModal);
$("#entity-form").addEventListener("submit", saveEntity);
$("#entity-modal").addEventListener("click", event => {
    if (event.target === $("#entity-modal")) closeEntityModal();
});
$("#close-confirm-modal").addEventListener("click", closeConfirmModal);
$("#cancel-confirm").addEventListener("click", closeConfirmModal);
$("#confirm-delete-btn").addEventListener("click", runConfirmedDelete);
$("#confirm-modal").addEventListener("click", event => {
    if (event.target === $("#confirm-modal")) closeConfirmModal();
});

$("#task-search").addEventListener("input", renderBoard);
$("#project-filter").addEventListener("change", renderBoard);
$("#priority-filter").addEventListener("change", renderBoard);

document.addEventListener("click", async event => {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    const id = Number(button.dataset.id);
    const action = button.dataset.action;

    if (action === "edit") {
        const task = state.tasks.find(item => item.id === id);
        if (task) openTaskModal(task);
    }

    if (action === "delete") {
        await deleteTask(id);
    }

    if (action === "delete-project") {
        deleteProject(id);
    }

    if (action === "delete-member") {
        deleteMember(id);
    }

    if (action === "complete") {
        const task = state.tasks.find(item => item.id === id);
        if (task) {
            await updateStatus(
                id,
                task.status === "Done" ? "To Do" : "Done"
            );
        }
    }

    if (action === "add-column-task") {
        openTaskModal(null, button.dataset.status);
    }
});

document.addEventListener("change", async event => {
    const element = event.target;

    if (element.matches('[data-action="status"]')) {
        await updateStatus(Number(element.dataset.id), element.value);
    }
});

/* INITIALIZE */

$("#today").textContent = new Date().toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
});

refresh();

/* TaskFlow account integration */

// Load the logged-in user's profile
(async function initTaskFlowAccount() {
    try {
        const response = await fetch('/api/me', {
            method: 'GET',
            credentials: 'same-origin',
            headers: { 'Accept': 'application/json' }
        });

        if (response.status === 401) {
            window.location.replace('/login');
            return;
        }

        if (!response.ok) {
            throw new Error('Could not load account details');
        }

        const user = await response.json();
        const name = (user.name || 'User').trim();

        const nameElement =
            document.getElementById('profile-name');

        const avatarElement =
            document.getElementById('profile-avatar');

        if (nameElement) {
            nameElement.textContent = name;
        }

        if (avatarElement) {
            avatarElement.textContent =
                name.charAt(0).toUpperCase();
        }
    } catch (error) {
        console.error(
            'TaskFlow account setup failed:', error
        );
    }
})();

// Redirect to login when an API session expires
(function redirectOnExpiredSession() {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async function (...args) {
        const response = await originalFetch(...args);

        const requestUrl =
            typeof args[0] === 'string'
                ? args[0]
                : args[0]?.url;

        if (
            response.status === 401 &&
            requestUrl &&
            requestUrl.includes('/api/')
        ) {
            window.location.replace('/login');
        }

        return response;
    };
})();
