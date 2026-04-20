// Site Engineer Dashboard JS

let currentUser = null;
let currentProjectId = null;
let allProjects = [];
let allWorkers = [];
let allImages = [];
let allIssues = [];
let allTasks = [];

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

function getCookie(name) {
  const nameEQ = name + "=";
  const cookies = document.cookie.split(";");
  for (let i = 0; i < cookies.length; i++) {
    let cookie = cookies[i].trim();
    if (cookie.indexOf(nameEQ) === 0) {
      return cookie.substring(nameEQ.length, cookie.length);
    }
  }
  return null;
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
  if (modal) {
    modal.classList.add("show");
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove("show");
  }
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

// Load projects for daily report selection
async function loadReportProjects() {
  try {
    const token = localStorage.getItem("auth_token");

    // ✅ FIX: use existing endpoint
    const response = await fetch("/api/projects", {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) throw new Error("Failed to load projects");

    const projects = await response.json();

    const select = document.getElementById("reportProjectSelect");
    select.innerHTML = '<option value="">Choose a project...</option>';

    // ✅ populate dropdown with projects
    for (const p of projects) {
      const option = document.createElement("option");
      option.value = p.id;
      option.textContent = p.name;
      select.appendChild(option);
    }

    // ⚠️ OPTIONAL: only add if not already added elsewhere
    select.onchange = () => {
      if (select.value) {
        document.getElementById("reportFormContainer").style.display = "block";
        document.getElementById("dailyReportForm").reset();
      } else {
        document.getElementById("reportFormContainer").style.display = "none";
      }
    };
  } catch (error) {
    showToast("Failed to load projects", "error");
  }
}

// Handle daily report form submission
async function handleDailyReportSubmit(e) {
  e.preventDefault();
  showLoading(true);

  try {
    const projectId = document.getElementById("reportProjectSelect").value;
    if (!projectId) {
      showToast("Please select a project", "warning");
      return;
    }

    // Get form data
    const formData = new FormData(e.target);
    const data = {
      project_id: projectId,
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

    const result = await response.json();
    showToast("Report submitted successfully! Document created.", "success");
    e.target.reset();
    document.getElementById("reportProjectSelect").value = "";
    document.getElementById("reportFormContainer").style.display = "none";
  } catch (error) {
    console.error("Error submitting report:", error);
    showToast(error.message || "Failed to submit report", "error");
  } finally {
    showLoading(false);
  }
}

function navigateSection(sectionId, clickedEl) {
  document
    .querySelectorAll(".page-section")
    .forEach((s) => s.classList.add("hidden"));
  document.getElementById(sectionId).classList.remove("hidden");

  document
    .querySelectorAll(".nav-link")
    .forEach((l) => l.classList.remove("active"));
  if (clickedEl) clickedEl.classList.add("active");

  // Section-specific data loaders
  if (sectionId === "daily-report") {
    loadReportProjects();
  } else if (sectionId === "daily-submissions") {
    if (typeof initTemplateSubmissions === "function") {
      initTemplateSubmissions();
    }
  } else if (sectionId === "daily-workers") {
    if (typeof loadDailyWorkersProjects === "function") {
      loadDailyWorkersProjects();
    }
  }
}

async function loadProjects() {
  try {
    const response = await fetch("/api/projects");
    allProjects = await response.json();

    const grid = document.getElementById("projectsGrid");
    grid.innerHTML =
      allProjects.length === 0
        ? '<div style="text-align: center; padding: 40px; grid-column: 1/-1;">No projects assigned</div>'
        : allProjects
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
  } catch (error) {
    console.error("Error loading projects:", error);
    showToast("Failed to load projects", "error");
  }
}

async function selectProject(projectId) {
  currentProjectId = projectId;

  let project = allProjects.find((p) => p.id === projectId);
  if (!project) return;

  // ✅ FIX: Fetch full project details (with assignments)
  try {
    const token = localStorage.getItem("auth_token");

    const detailRes = await fetch(`/api/projects/${projectId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (detailRes.ok) {
      const fullProject = await detailRes.json();

      // Replace project in allProjects
      const idx = allProjects.findIndex((p) => p.id === projectId);
      if (idx !== -1) {
        allProjects[idx] = fullProject;
      }

      project = fullProject;
    }
  } catch (err) {
    console.warn("Could not fetch project detail:", err);
  }

  // UI updates
  document.getElementById("projects").classList.add("hidden");
  document.getElementById("projectDetail").classList.remove("hidden");
  document.getElementById("detailProjectName").textContent = project.name;

  // Show PM info
  const pmAssignment = project.assignments
    ? project.assignments.find((a) => a.role === "project_manager")
    : null;

  if (pmAssignment) {
    document.getElementById("pmInfo").innerHTML = `
      <p><strong>PM Name:</strong> ${pmAssignment.name}</p>
      <p><strong>Employment ID:</strong> ${pmAssignment.employment_id}</p>
    `;
  }

  // Load project data
  loadProjectTasks();
  loadProjectWorkers();
  loadPendingImages();
  loadProjectIssues();

  document.getElementById("attendanceDate").valueAsDate = new Date();
}

function backToProjects() {
  currentProjectId = null;
  document.getElementById("projects").classList.remove("hidden");
  document.getElementById("projectDetail").classList.add("hidden");
}

async function loadProjectTasks() {
  try {
    const response = await fetch(
      `/api/tasks?project_id=${currentProjectId}&assigned_to=${currentUser.id}`,
    );
    allTasks = await response.json();

    const tbody = document.getElementById("myTasksTableBody");
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

async function updateTaskStatus(taskId, currentStatus) {
  const statuses = ["pending", "in_progress", "completed"];
  const newStatus = prompt(
    `Current: ${currentStatus}\nNew status (${statuses.join("/")}):`,
  );
  if (!newStatus || !statuses.includes(newStatus)) return;

  showLoading(true);
  try {
    const response = await fetch(`/api/tasks/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });

    if (!response.ok) throw new Error("Failed to update");
    showToast("Task updated", "success");
    loadProjectTasks();
  } catch (error) {
    showToast("Failed to update task", "error");
  } finally {
    showLoading(false);
  }
}

async function loadProjectWorkers() {
  try {
    const response = await fetch(`/api/workers?project_id=${currentProjectId}`);
    allWorkers = await response.json();

    // Populate supervisor select
    const supervisors = allWorkers
      .map((w) => ({ id: w.supervisor_id, name: w.supervisor_name }))
      .filter((v, i, a) => a.findIndex((t) => t.id === v.id) === i);
    document.getElementById("supervisorSelect").innerHTML = supervisors
      .map((s) => `<option value="${s.id}">${s.name}</option>`)
      .join("");

    const tbody = document.getElementById("workersTableBody");
    const html = allWorkers
      .map(
        (w) => `
      <tr>
        <td>${w.name}</td>
        <td>${w.supervisor_name || "Unassigned"}</td>
        <td>${formatDateShort(w.created_at)}</td>
        <td><button class="btn btn-small btn-danger" onclick="deleteWorker(${w.id})">Delete</button></td>
      </tr>
    `,
      )
      .join("");

    document.getElementById("workersTableBody").innerHTML =
      html || '<tr><td colspan="4">No workers yet</td></tr>';

    // Load all workers
    loadAllWorkers();
  } catch (error) {
    console.error("Error loading workers:", error);
  }
}

async function loadAllWorkers() {
  try {
    const response = await fetch("/api/workers");
    const workers = await response.json();

    const tbody = document.getElementById("allWorkersTableBody");
    const html = workers
      .map(
        (w) => `
      <tr>
        <td>${w.name}</td>
        <td>${allProjects.find((p) => p.id === w.project_id)?.name || "Unknown"}</td>
        <td>${w.supervisor_name || "Unassigned"}</td>
        <td>${formatDateShort(w.created_at)}</td>
      </tr>
    `,
      )
      .join("");

    document.getElementById("allWorkersTableBody").innerHTML =
      html || '<tr><td colspan="4">No workers</td></tr>';
  } catch (error) {
    console.error("Error loading all workers:", error);
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

  showLoading(true);
  try {
    const response = await fetch("/api/workers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        project_id: currentProjectId,
        supervisor_id: parseInt(formData.get("supervisor_id")),
      }),
    });

    if (!response.ok) throw new Error("Failed to add worker");
    showToast("Worker added", "success");
    closeModal("addWorkerModal");
    loadProjectWorkers();
  } catch (error) {
    showToast("Failed to add worker", "error");
  } finally {
    showLoading(false);
  }
}

async function deleteWorker(workerId) {
  if (!confirm("Are you sure?")) return;

  showLoading(true);
  try {
    const response = await fetch(`/api/workers/${workerId}`, {
      method: "DELETE",
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

async function loadAttendanceForDate() {
  const date = document.getElementById("attendanceDate").value;
  if (!date) return;

  try {
    const response = await fetch(
      `/api/attendance?project_id=${currentProjectId}&date=${date}`,
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

    document.getElementById("attendanceTableBody").innerHTML =
      html || '<tr><td colspan="4">No attendance records</td></tr>';
  } catch (error) {
    console.error("Error loading attendance:", error);
  }
}

async function loadPendingImages() {
  try {
    const response = await fetch(
      `/api/images?project_id=${currentProjectId}&status=pending`,
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

    // Load all pending images
    const allImagesResponse = await fetch("/api/images?status=pending");
    const allPendingImages = await allImagesResponse.json();

    const allGallery = document.getElementById("allPendingImages");
    allGallery.innerHTML =
      allPendingImages.length === 0
        ? '<div style="grid-column: 1/-1; text-align: center; padding: 40px;">No pending images</div>'
        : allPendingImages
            .map(
              (img) => `
      <div class="gallery-item">
        <img src="/${img.file_path}" alt="${img.original_name}">
        <div style="padding: 8px; background: #f5f5f5; font-size: 12px;">
          <div><strong>Project:</strong> ${allProjects.find((p) => p.id === img.project_id)?.name || "Unknown"}</div>
        </div>
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
    const response = await fetch(`/api/images/${imageId}/approve`, {
      method: "PUT",
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
    const response = await fetch(`/api/images/${imageId}/reject`, {
      method: "PUT",
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

async function loadProjectIssues() {
  try {
    const response = await fetch(
      `/api/troubleshoot?project_id=${currentProjectId}`,
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

    document.getElementById("seIssuesTableBody").innerHTML =
      html || '<tr><td colspan="4">No issues</td></tr>';

    // Load all issues
    const allIssuesResponse = await fetch("/api/troubleshoot");
    const allProjectIssues = await allIssuesResponse.json();

    const allTbody = document.getElementById("allIssuesTableBody");
    const allHtml = allProjectIssues
      .map(
        (issue) => `
      <tr>
        <td>${allProjects.find((p) => p.id === issue.project_id)?.name || "Unknown"}</td>
        <td>${issue.title}</td>
        <td><span class="badge badge-${issue.status === "open" ? "danger" : issue.status === "escalated" ? "warning" : "success"}">${issue.status}</span></td>
        <td>${formatDate(issue.created_at)}</td>
        <td>
          ${issue.status === "open" && issue.project_id === currentProjectId ? `<button class="btn btn-small" onclick="escalateIssue(${issue.id})">Push to PM</button>` : "N/A"}
        </td>
      </tr>
    `,
      )
      .join("");

    allTbody.innerHTML = allHtml || '<tr><td colspan="5">No issues</td></tr>';
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
    const response = await fetch("/api/troubleshoot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
  // Get PM from current project
  const project = allProjects.find((p) => p.id === currentProjectId);
  const pm =
    project && project.assignments
      ? project.assignments.find((a) => a.role === "project_manager")
      : null;

  if (!pm) {
    showToast("No PM assigned to this project", "error");
    return;
  }

  showLoading(true);
  try {
    const response = await fetch(`/api/troubleshoot/${issueId}/escalate`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },

      // ✅ FIX: use DB ID instead of string ID
      body: JSON.stringify({ escalated_to: pm.user_db_id }),
    });

    if (!response.ok) throw new Error("Failed to escalate");

    showToast("Issue escalated to PM", "success");
    loadProjectIssues();
  } catch (error) {
    showToast("Failed to escalate issue", "error");
  } finally {
    showLoading(false);
  }
}

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

// Initialize
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
  }

  document.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      navigateSection(link.getAttribute("href").substring(1), link);
    });
  });

  document
    .getElementById("addWorkerForm")
    .addEventListener("submit", handleAddWorker);
  document
    .getElementById("raiseIssueForm")
    .addEventListener("submit", handleRaiseIssue);
  document
    .getElementById("dailyReportForm")
    .addEventListener("submit", handleDailyReportSubmit);
  document.getElementById("searchBox").addEventListener("keyup", () => {
    const term = document.getElementById("searchBox").value.toLowerCase();
    if (currentProjectId) {
      loadProjectWorkers();
    }
  });

  loadProjects();

  const style = document.createElement("style");
  style.textContent = `
    @keyframes slideOutRight {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(400px); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
});
