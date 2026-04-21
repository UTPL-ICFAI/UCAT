// Site Engineer Dashboard JS

let currentUser = null;
let currentProjectId = null;
let allProjects = [];
let allWorkers = [];
let allImages = [];
let allIssues = [];
let allTasks = [];
let allCommunications = [];

function showToast(message, type = "info") {
  const container =
    document.getElementById("toastContainer") || createToastContainer();
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = "slideOutRight 0.3s ease-out forwards";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function createToastContainer() {
  const container = document.createElement("div");
  container.id = "toastContainer";
  container.className = "toast-container";
  document.body.appendChild(container);
  return container;
}

function showLoading(show = true) {
  const overlay = document.getElementById("loadingOverlay");
  if (overlay) {
    overlay.classList.toggle("show", show);
  }
}

function decodeJWT(token) {
  const base64Url = token.split(".")[1];
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const jsonPayload = decodeURIComponent(
    atob(base64)
      .split("")
      .map((c) => {
        return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
      })
      .join(""),
  );
  return JSON.parse(jsonPayload);
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

function formatDateShort(dateStr) {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add("show");
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove("show");
}

async function logoutUser() {
  if (!confirm("Are you sure you want to logout?")) return;
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    localStorage.removeItem("auth_token");
    window.location.href = "/";
  }
}

// ─── Projects ────────────────────────────────────────────────────────────────

async function loadProjects() {
  try {
    const token = localStorage.getItem("auth_token");
    const response = await fetch("/api/projects", {
      headers: { Authorization: `Bearer ${token}` },
    });
    allProjects = await response.json();
    displayProjectsGrid();
    updateProjectSidebar();
  } catch (error) {
    console.error("Error loading projects:", error);
    showToast("Failed to load projects", "error");
  }
}

function displayProjectsGrid() {
  const grid = document.getElementById("projectsGrid");
  if (allProjects.length === 0) {
    grid.innerHTML =
      '<div style="text-align: center; padding: 40px; color: #999; grid-column: 1/-1;">No projects assigned yet</div>';
    return;
  }
  grid.innerHTML = allProjects
    .map(
      (p) => `
    <div class="project-card" onclick="selectProject(${p.id})">
      <h3>${p.name}</h3>
      <p><strong>Location:</strong> ${p.location}</p>
      <p><strong>City:</strong> ${p.city}</p>
      <p><strong>Status:</strong> <span class="badge badge-${p.work_status === "active" ? "success" : "secondary"}">${p.work_status}</span></p>
    </div>
  `,
    )
    .join("");
}

function updateProjectSidebar() {
  const searchTerm = (
    document.getElementById("projectSearch").value || ""
  ).toLowerCase();
  const filtered = allProjects.filter((p) =>
    p.name.toLowerCase().includes(searchTerm),
  );
  const list = document.getElementById("projectList");
  list.innerHTML =
    filtered
      .map(
        (p) => `
    <li><a href="#" class="nav-link" onclick="selectProject(${p.id}); return false;">${p.name}</a></li>
  `,
      )
      .join("") ||
    '<li><a href="#" class="nav-link">No projects found</a></li>';
}

async function selectProject(projectId) {
  currentProjectId = projectId;

  let project = allProjects.find((p) => p.id === projectId);
  if (!project) return;

  try {
    const token = localStorage.getItem("auth_token");
    const res = await fetch("/api/projects/" + projectId, {
      headers: { Authorization: "Bearer " + token },
    });
    if (res.ok) {
      project = await res.json();
      const idx = allProjects.findIndex((p) => p.id === projectId);
      if (idx !== -1) allProjects[idx] = project;
    }
  } catch (err) {
    console.error("Error fetching project details:", err);
  }

  document.getElementById("projectsGrid").style.display = "none";
  document.getElementById("projectDetail").style.display = "block";
  document.getElementById("pageTitle").textContent = project.name;

  document.getElementById("projectInfo").innerHTML = `
    <p><strong>Location:</strong> ${project.location}</p>
    <p><strong>City:</strong> ${project.city}</p>
    <p><strong>Status:</strong> <span class="badge badge-${project.work_status === "active" ? "success" : "secondary"}">${project.work_status}</span></p>
    <p><strong>Created:</strong> ${formatDate(project.created_at)}</p>
  `;

  // Reset to first tab
  switchTabById("my-tasks");

  // Load all project data
  loadProjectTasks();
  loadProjectWorkers();
  loadPendingImages();
  loadProjectIssues();
  loadProjectCommunications();

  const attendanceDateEl = document.getElementById("attendanceDate");
  if (attendanceDateEl) attendanceDateEl.valueAsDate = new Date();
}

function goBackToProjects() {
  currentProjectId = null;
  document.getElementById("projectsGrid").style.display = "grid";
  document.getElementById("projectDetail").style.display = "none";
  document.getElementById("pageTitle").textContent = "My Projects";
}

// ─── Tab Switching ────────────────────────────────────────────────────────────

function switchTab(e, tabName) {
  document
    .querySelectorAll(".tab")
    .forEach((t) => t.classList.remove("active"));
  document
    .querySelectorAll(".tab-content")
    .forEach((c) => c.classList.remove("active"));
  e.target.classList.add("active");
  document.getElementById(tabName).classList.add("active");
}

function switchTabById(tabName) {
  document
    .querySelectorAll(".tab")
    .forEach((t) => t.classList.remove("active"));
  document
    .querySelectorAll(".tab-content")
    .forEach((c) => c.classList.remove("active"));
  const tabContent = document.getElementById(tabName);
  if (tabContent) tabContent.classList.add("active");
  // Activate first matching tab button
  document.querySelectorAll(".tab").forEach((t) => {
    if (
      t.getAttribute("onclick") &&
      t.getAttribute("onclick").includes(`'${tabName}'`)
    ) {
      t.classList.add("active");
    }
  });
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

async function loadProjectTasks() {
  try {
    const token = localStorage.getItem("auth_token");
    const response = await fetch(
      `/api/tasks?project_id=${currentProjectId}&assigned_to=${currentUser.id}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    allTasks = await response.json();

    const html = allTasks
      .map(
        (task) => `
      <tr>
        <td>${task.title}</td>
        <td>${formatDateShort(task.due_date)}</td>
        <td><span class="badge badge-${task.status === "completed" ? "success" : task.status === "overdue" ? "danger" : "primary"}">${task.status}</span></td>
        <td><button class="btn btn-small" onclick="updateTaskStatus(${task.id}, '${task.status}')">Update</button></td>
      </tr>
    `,
      )
      .join("");

    document.getElementById("myTasksTableBody").innerHTML =
      html || '<tr><td colspan="4">No tasks assigned</td></tr>';
  } catch (error) {
    console.error("Error loading tasks:", error);
  }
}

function updateTaskStatus(taskId, currentStatus) {
  // Remove any existing status modal
  const existing = document.getElementById("taskStatusModal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "taskStatusModal";
  modal.className = "modal show";
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 360px;">
      <div class="modal-header">
        <span>Update Task Status</span>
        <button class="modal-close" onclick="document.getElementById('taskStatusModal').remove()">&times;</button>
      </div>
      <div style="padding: 20px;">
        <div class="form-group">
          <label style="font-weight:600; margin-bottom:8px; display:block;">Select New Status</label>
          <select id="taskStatusSelect" class="form-control" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:4px; font-size:14px;">
            <option value="pending"      ${currentStatus === "pending" ? "selected" : ""}>Pending</option>
            <option value="in_progress"  ${currentStatus === "in_progress" ? "selected" : ""}>In Progress</option>
            <option value="dismissed"    ${currentStatus === "dismissed" ? "selected" : ""}>Dismissed</option>
            <option value="completed"    ${currentStatus === "completed" ? "selected" : ""}>Completed</option>
          </select>
        </div>
        <div style="display:flex; gap:10px; margin-top:15px;">
          <button class="btn btn-primary" onclick="confirmTaskStatusUpdate(${taskId})">Update</button>
          <button class="btn btn-secondary" onclick="document.getElementById('taskStatusModal').remove()">Cancel</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

async function confirmTaskStatusUpdate(taskId) {
  const select = document.getElementById("taskStatusSelect");
  const newStatus = select ? select.value : null;
  if (!newStatus) return;

  document.getElementById("taskStatusModal").remove();
  showLoading(true);
  try {
    const token = localStorage.getItem("auth_token");
    const response = await fetch(`/api/tasks/${taskId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || "Failed to update");
    }
    showToast('Task status updated to "' + newStatus + '"', "success");
    loadProjectTasks();
  } catch (error) {
    showToast(error.message || "Failed to update task", "error");
  } finally {
    showLoading(false);
  }
}

// ─── Worker Management ───────────────────────────────────────────────────────

async function loadProjectWorkers() {
  try {
    const token = localStorage.getItem("auth_token");

    // Load workers for this project
    const response = await fetch(
      `/api/workers?project_id=${currentProjectId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || "Failed to load workers");
    }

    allWorkers = await response.json();

    // Load supervisors for dropdown
    const supResponse = await fetch(
      `/api/workers/supervisors?project_id=${currentProjectId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const supervisors = supResponse.ok ? await supResponse.json() : [];

    const supSelect = document.getElementById("supervisorSelect");
    if (supSelect) {
      supSelect.innerHTML =
        supervisors.length === 0
          ? '<option value="">No Supervisors Assigned to Project</option>'
          : '<option value="">Select Supervisor...</option>' +
            supervisors
              .map((s) => `<option value="${s.id}">${s.name}</option>`)
              .join("");
    }

    const tbody = document.getElementById("workersTableBody");
    const html = allWorkers
      .map(
        (w) => `
      <tr>
        <td>${w.name}</td>
        <td>${w.age || "-"}</td>
        <td>${w.gender || "-"}</td>
        <td>${w.supervisor_name || "Unassigned"}</td>
        <td>${formatDateShort(w.created_at)}</td>
        <td><button class="btn btn-small btn-danger" onclick="deleteWorker(${w.id})">Delete</button></td>
      </tr>
    `,
      )
      .join("");

    tbody.innerHTML =
      html ||
      '<tr><td colspan="6">No workers yet. Click "Add Worker" to add one.</td></tr>';
  } catch (error) {
    console.error("Error loading workers:", error);
    document.getElementById("workersTableBody").innerHTML =
      `<tr><td colspan="6" style="color:red;">Error: ${error.message}</td></tr>`;
  }
}

function openAddWorkerModal() {
  document.getElementById("addWorkerForm").reset();
  openModal("addWorkerModal");
}

async function handleAddWorker(e) {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);

  const supervisorIdRaw = formData.get("supervisor_id");
  if (!supervisorIdRaw) {
    showToast("Please select a supervisor", "warning");
    return;
  }

  showLoading(true);
  try {
    const token = localStorage.getItem("auth_token");
    const payload = {
      name: formData.get("name"),
      age: parseInt(formData.get("age")),
      gender: formData.get("gender"),
      project_id: currentProjectId,
      supervisor_id: parseInt(supervisorIdRaw),
    };

    console.log("Adding worker payload:", payload);

    const response = await fetch("/api/workers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || "Failed to add worker");
    }

    showToast("Worker added successfully", "success");
    closeModal("addWorkerModal");
    loadProjectWorkers();
  } catch (error) {
    console.error("Add worker error:", error);
    showToast(error.message || "Failed to add worker", "error");
  } finally {
    showLoading(false);
  }
}

async function deleteWorker(workerId) {
  if (!confirm("Are you sure you want to delete this worker?")) return;

  showLoading(true);
  try {
    const token = localStorage.getItem("auth_token");
    const response = await fetch(`/api/workers/${workerId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error("Failed to delete");
    showToast("Worker deleted", "success");
    loadProjectWorkers();
  } catch (error) {
    showToast("Failed to delete worker", "error");
  } finally {
    showLoading(false);
  }
}

// ─── Daily Report ────────────────────────────────────────────────────────────

async function handleDailyReportSubmit(e) {
  e.preventDefault();
  showLoading(true);

  try {
    if (!currentProjectId) {
      showToast("No project selected", "warning");
      return;
    }

    const formData = new FormData(e.target);
    const data = {
      project_id: currentProjectId,
      tunnelType: formData.get("tunnelType"),
      tunnelStartChainage: formData.get("tunnelStartChainage"),
      tunnelEndChainage: formData.get("tunnelEndChainage"),
      faceCurrentChainage: formData.get("faceCurrentChainage"),
      tunnelLength: parseFloat(formData.get("tunnelLength")) || 0,
      steelRDB: parseFloat(formData.get("steelRDB")) || 0,
      rockClass: formData.get("rockClass"),
      latticeGirders: parseFloat(formData.get("latticeGirders")) || 0,
      monthPerDay: parseFloat(formData.get("monthPerDay")) || 0,
      targetTarget: parseFloat(formData.get("targetTarget")) || 0,
      todaysProgress: parseFloat(formData.get("todaysProgress")) || 0,
      progressThisMonth: parseFloat(formData.get("progressThisMonth")) || 0,
      tillLastMonth: parseFloat(formData.get("tillLastMonth")) || 0,
      totalProgressUpToDate:
        parseFloat(formData.get("totalProgressUpToDate")) || 0,
      balance: parseFloat(formData.get("balance")) || 0,
      percentageCompleted: parseFloat(formData.get("percentageCompleted")) || 0,
      remarks: formData.get("remarks"),
    };

    const token = localStorage.getItem("auth_token");
    const response = await fetch("/api/daily-reports", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to submit report");
    }

    showToast("Report submitted successfully! Document created.", "success");
    e.target.reset();
  } catch (error) {
    console.error("Error submitting report:", error);
    showToast(error.message || "Failed to submit report", "error");
  } finally {
    showLoading(false);
  }
}

// ─── Attendance ───────────────────────────────────────────────────────────────

async function loadAttendanceForDate() {
  const date = document.getElementById("attendanceDate").value;
  if (!date) return;

  try {
    const token = localStorage.getItem("auth_token");
    const response = await fetch(
      `/api/attendance?project_id=${currentProjectId}&date=${date}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const attendance = await response.json();

    const tbody = document.getElementById("attendanceTableBody");
    const html = attendance
      .map(
        (a) => `
      <tr>
        <td>${a.worker_name}</td>
        <td>${formatDateShort(a.date)}</td>
        <td><span class="badge badge-${a.status === "present" ? "success" : a.status === "absent" ? "danger" : "warning"}">${a.status}</span></td>
        <td>${a.supervisor_name || "Unknown"}</td>
      </tr>
    `,
      )
      .join("");

    tbody.innerHTML =
      html || '<tr><td colspan="4">No attendance records</td></tr>';
  } catch (error) {
    console.error("Error loading attendance:", error);
  }
}

// ─── Images ───────────────────────────────────────────────────────────────────

async function loadPendingImages() {
  try {
    const token = localStorage.getItem("auth_token");
    const response = await fetch(
      `/api/images?project_id=${currentProjectId}&status=pending`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    allImages = await response.json();

    const gallery = document.getElementById("pendingImagesGallery");
    gallery.innerHTML =
      allImages.length === 0
        ? '<div style="grid-column: 1/-1; text-align: center; padding: 40px;">No pending images</div>'
        : allImages
            .map(
              (img) => `
        <div class="gallery-item">
          <img src="/${img.file_path}" alt="${img.original_name}">
          <div class="gallery-overlay">
            <button class="gallery-btn" onclick="approveImage(${img.id})">Approve</button>
            <button class="gallery-btn" style="background: #d32f2f; color: white;" onclick="rejectImage(${img.id})">Reject</button>
          </div>
        </div>
      `,
            )
            .join("");
  } catch (error) {
    console.error("Error loading images:", error);
  }
}

async function approveImage(imageId) {
  showLoading(true);
  try {
    const token = localStorage.getItem("auth_token");
    const response = await fetch(`/api/images/${imageId}/approve`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error("Failed to approve");
    showToast("Image approved", "success");
    loadPendingImages();
  } catch (error) {
    showToast("Failed to approve image", "error");
  } finally {
    showLoading(false);
  }
}

async function rejectImage(imageId) {
  showLoading(true);
  try {
    const token = localStorage.getItem("auth_token");
    const response = await fetch(`/api/images/${imageId}/reject`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error("Failed to reject");
    showToast("Image rejected", "success");
    loadPendingImages();
  } catch (error) {
    showToast("Failed to reject image", "error");
  } finally {
    showLoading(false);
  }
}

// ─── Chat / Communications ────────────────────────────────────────────────────

async function loadProjectCommunications() {
  try {
    const token = localStorage.getItem("auth_token");
    const response = await fetch(
      `/api/communications?project_id=${currentProjectId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!response.ok) return;
    allCommunications = await response.json();
    displaySeChat();
  } catch (error) {
    console.error("Error loading communications:", error);
  }
}

function displaySeChat() {
  const chatDiv = document.getElementById("seChatMessages");
  if (!chatDiv) return;
  const msgs = [...allCommunications].reverse();
  chatDiv.innerHTML =
    msgs.length === 0
      ? '<p style="color:#999; text-align:center; margin-top: 20px;">No messages yet. Start the conversation!</p>'
      : msgs
          .map((msg) => {
            const isMe = currentUser && msg.sender_id === currentUser.id;
            return `
          <div style="margin-bottom: 14px; display: flex; flex-direction: column; align-items: ${isMe ? "flex-end" : "flex-start"};">
            <div style="max-width: 70%; background: ${isMe ? "#1a5490" : "white"}; color: ${isMe ? "white" : "#333"}; padding: 10px 14px; border-radius: ${isMe ? "12px 12px 4px 12px" : "12px 12px 12px 4px"}; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
              <div style="font-size: 11px; font-weight: 600; margin-bottom: 4px; opacity: 0.75;">${isMe ? "You" : msg.sender_name || "Unknown"}</div>
              <div style="font-size: 14px; line-height: 1.4;">${msg.message}</div>
            </div>
            <div style="font-size: 11px; color: #999; margin-top: 3px;">${formatDate(msg.sent_at)}</div>
          </div>
        `;
          })
          .join("");
  chatDiv.scrollTop = chatDiv.scrollHeight;
}

async function seSendMessage() {
  const input = document.getElementById("seMessageInput");
  const message = input.value.trim();
  if (!message) return;

  showLoading(true);
  try {
    const token = localStorage.getItem("auth_token");
    const response = await fetch("/api/communications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        project_id: currentProjectId,
        message: message,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || "Failed to send message");
    }

    input.value = "";
    loadProjectCommunications();
  } catch (error) {
    console.error("Error sending message:", error);
    showToast(error.message || "Failed to send message", "error");
  } finally {
    showLoading(false);
  }
}

// ─── Issues ───────────────────────────────────────────────────────────────────

async function loadProjectIssues() {
  try {
    const token = localStorage.getItem("auth_token");
    const response = await fetch(
      `/api/troubleshoot?project_id=${currentProjectId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    allIssues = await response.json();

    const tbody = document.getElementById("seIssuesTableBody");
    const html = allIssues
      .map(
        (issue) => `
      <tr>
        <td>${issue.title}</td>
        <td><span class="badge badge-${issue.status === "open" ? "danger" : issue.status === "escalated" ? "warning" : "success"}">${issue.status}</span></td>
        <td>${formatDate(issue.created_at)}</td>
        <td>
          ${issue.status === "open" ? `<button class="btn btn-small" onclick="escalateIssue(${issue.id})">Push to PM</button>` : "Already escalated"}
        </td>
      </tr>
    `,
      )
      .join("");

    tbody.innerHTML = html || '<tr><td colspan="4">No issues</td></tr>';
  } catch (error) {
    console.error("Error loading issues:", error);
  }
}

function openRaiseIssueModal() {
  document.getElementById("raiseIssueForm").reset();
  openModal("raiseIssueModal");
}

async function handleRaiseIssue(e) {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);

  showLoading(true);
  try {
    const token = localStorage.getItem("auth_token");
    const response = await fetch("/api/troubleshoot", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        project_id: currentProjectId,
        title: formData.get("title"),
        description: formData.get("description"),
      }),
    });

    if (!response.ok) throw new Error("Failed to raise issue");
    showToast("Issue raised", "success");
    closeModal("raiseIssueModal");
    loadProjectIssues();
  } catch (error) {
    showToast("Failed to raise issue", "error");
  } finally {
    showLoading(false);
  }
}

async function escalateIssue(issueId) {
  showLoading(true);
  try {
    const token = localStorage.getItem("auth_token");

    // Prefer cached assignments from selectProject(); fallback to live fetch
    let pmAccountId = null;
    const cachedProject = allProjects.find((p) => p.id === currentProjectId);
    if (cachedProject && Array.isArray(cachedProject.assignments)) {
      const pm = cachedProject.assignments.find(
        (a) => a.role === "project_manager",
      );
      // account_id is the numeric DB users.id (returned by the /api/projects/:id query)
      if (pm) pmAccountId = pm.account_id || pm.user_id;
    }

    // If not in cache, fetch project detail fresh
    if (!pmAccountId) {
      const projRes = await fetch(`/api/projects/${currentProjectId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (projRes.ok) {
        const fullProject = await projRes.json();
        // Update cache
        const idx = allProjects.findIndex((p) => p.id === currentProjectId);
        if (idx !== -1) allProjects[idx] = fullProject;
        const pm = (fullProject.assignments || []).find(
          (a) => a.role === "project_manager",
        );
        if (pm) pmAccountId = pm.account_id || pm.user_id;
      }
    }

    if (!pmAccountId) {
      showToast("No Project Manager assigned to this project", "warning");
      return;
    }

    const response = await fetch(`/api/troubleshoot/${issueId}/escalate`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ escalated_to: pmAccountId }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || "Failed to escalate issue");
    }
    showToast("Issue escalated to PM successfully", "success");
    loadProjectIssues();
  } catch (error) {
    console.error("Escalate issue error:", error);
    showToast(error.message || "Failed to escalate issue", "error");
  } finally {
    showLoading(false);
  }
}

// ─── Initialize ───────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  const token = localStorage.getItem("auth_token");
  if (!token) {
    window.location.href = "/";
    return;
  }

  try {
    currentUser = decodeJWT(token);
    document.getElementById("userName").textContent = currentUser.name;
  } catch (error) {
    localStorage.removeItem("auth_token");
    window.location.href = "/";
    return;
  }

  // Bind forms
  const addWorkerForm = document.getElementById("addWorkerForm");
  if (addWorkerForm) addWorkerForm.addEventListener("submit", handleAddWorker);

  const raiseIssueForm = document.getElementById("raiseIssueForm");
  if (raiseIssueForm)
    raiseIssueForm.addEventListener("submit", handleRaiseIssue);

  // Project search
  const projectSearch = document.getElementById("projectSearch");
  if (projectSearch) {
    projectSearch.addEventListener("keyup", updateProjectSidebar);
  }

  loadProjects();

  // Animation CSS
  const style = document.createElement("style");
  style.textContent = `
    @keyframes slideOutRight {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(400px); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
});
