// Project Manager Dashboard JS

let currentUser = null;
let currentProjectId = null;
let allProjects = [];
let allTasks = [];
let allImages = [];
let allDocuments = [];
let allIssues = [];
let allCommunications = [];
let sseConnection = null;
let pmBudgetChart = null;

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
  if (sseConnection) sseConnection.close();
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    localStorage.removeItem("auth_token");
    window.location.href = "/";
  }
}

async function loadProjects() {
  try {
    const response = await fetch("/api/projects");
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
      (project) => `
    <div class="project-card" onclick="selectProject(${project.id})">
      <h3>${project.name}</h3>
      <p><strong>Location:</strong> ${project.location}</p>
      <p><strong>City:</strong> ${project.city}</p>
      <p><strong>Status:</strong> <span class="badge badge-${project.work_status === "active" ? "success" : "secondary"}">${project.work_status}</span></p>
    </div>
  `,
    )
    .join("");
}

function updateProjectSidebar() {
  const searchTerm = document
    .getElementById("projectSearch")
    .value.toLowerCase();
  const filtered = allProjects.filter((p) =>
    p.name.toLowerCase().includes(searchTerm),
  );

  const list = document.getElementById("projectList");
  list.innerHTML = filtered
    .map(
      (project) => `
    <li><a href="#" class="nav-link" onclick="selectProject(${project.id}); return false;">${project.name}</a></li>
  `,
    )
    .join("");
}

async function selectProject(projectId) {
  currentProjectId = projectId;

  let project = allProjects.find((p) => p.id === projectId);
  if (!project) return;

  try {
    const res = await fetch("/api/projects/" + projectId, {
      headers: {
        Authorization: "Bearer " + localStorage.getItem("auth_token"),
      },
    });
    if (res.ok) {
      project = await res.json();
      const idx = allProjects.findIndex((p) => p.id === projectId);
      if (idx !== -1) allProjects[idx] = project;
    }
  } catch (err) {
    console.error("Error fetching full project details:", err);
  }

  document.getElementById("projectsGrid").style.display = "none";

  const detailPanel = document.getElementById("projectDetail");
  detailPanel.style.display = "block";
  detailPanel.setAttribute("data-project-id", projectId);

  document.getElementById("pageTitle").textContent = project.name;

  // Show project info
  const info = `
    <p><strong>Location:</strong> ${project.location}</p>
    <p><strong>City:</strong> ${project.city}</p>
    <p><strong>Budget:</strong> ₹${parseFloat(project.total_budget || 0).toLocaleString()}</p>
    <p><strong>Status:</strong> <span class="badge badge-${project.work_status === "active" ? "success" : "secondary"}">${project.work_status}</span></p>
    <p><strong>Created:</strong> ${formatDate(project.created_at)}</p>
  `;
  document.getElementById("projectInfo").innerHTML = info;

  // Load project data
  loadProjectTasks();
  loadProjectImages();
  loadProjectDocuments();
  loadProjectIssues();
  loadProjectCommunications();
  loadBudgetTracking();
  loadTeamInfo();

  if (typeof loadPMSubmissions === "function") {
    loadPMSubmissions();
  }
}

function goBackToProjects() {
  currentProjectId = null;
  document.getElementById("projectsGrid").style.display = "grid";
  document.getElementById("projectDetail").style.display = "none";
  document.getElementById("projectDetail").removeAttribute("data-project-id");
  document.getElementById("pageTitle").textContent = "My Projects";
}

async function loadProjectTasks() {
  try {
    const response = await fetch(`/api/tasks?project_id=${currentProjectId}`);
    allTasks = await response.json();

    // Populate assign select
    const assignSelect = document.getElementById("taskAssignSelect");
    const project = allProjects.find((p) => p.id === currentProjectId);
    const seList =
      project && project.assignments
        ? project.assignments.filter((a) => a.role === "site_engineer")
        : [];
    assignSelect.innerHTML = seList
      .map(
        (se) =>
          `<option value="${se.account_id || se.user_id}">${se.name}</option>`,
      )
      .join("");

    const tbody = document.getElementById("tasksTableBody");
    const html = allTasks
      .map(
        (task) => `
      <tr>
        <td>${task.title}</td>
        <td>${task.assigned_to || "Unassigned"}</td>
        <td>${formatDateShort(task.due_date)}</td>
        <td><span class="badge badge-${task.status === "completed" ? "success" : task.status === "overdue" ? "danger" : "primary"}">${task.status}</span></td>
        <td><button class="btn btn-small btn-secondary" onclick="editTaskStatus(${task.id})">Edit</button></td>
      </tr>
    `,
      )
      .join("");

    document.getElementById("tasksTableBody").innerHTML =
      html || '<tr><td colspan="5">No tasks yet</td></tr>';

    // Update task progress
    const completed = allTasks.filter((t) => t.status === "completed").length;
    document.getElementById("tasksCompleted").textContent = completed;
    document.getElementById("tasksTotal").textContent = allTasks.length;
    document.getElementById("tasksProgress").style.width = allTasks.length
      ? (completed / allTasks.length) * 100 + "%"
      : "0%";
  } catch (error) {
    console.error("Error loading tasks:", error);
  }
}

async function loadProjectImages() {
  try {
    const response = await fetch(
      `/api/images?project_id=${currentProjectId}&status=approved`,
    );
    allImages = await response.json();

    const gallery = document.getElementById("imagesGallery");
    gallery.innerHTML = allImages
      .map(
        (img) => `
      <div class="gallery-item">
        <img src="/${img.file_path}" alt="${img.original_name}" onclick="viewImageFull('${img.file_path}')">
        <div class="gallery-overlay">
          <button class="gallery-btn" onclick="downloadImage('${img.file_path}')">Download</button>
        </div>
      </div>
    `,
      )
      .join("");

    if (allImages.length === 0) {
      gallery.innerHTML =
        '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #999;">No approved images yet</div>';
    }
  } catch (error) {
    console.error("Error loading images:", error);
  }
}

async function loadProjectDocuments() {
  try {
    const response = await fetch(
      `/api/documents?project_id=${currentProjectId}`,
    );
    allDocuments = await response.json();

    const tbody = document.getElementById("documentsTableBody");
    const html = allDocuments
      .map(
        (doc) => `
      <tr>
        <td>${doc.title || "Untitled"}</td>
        <td>${doc.drawing_no || "-"}</td>
        <td><span class="badge badge-secondary">${doc.doc_status || "Draft"}</span></td>
        <td>${doc.category || "-"}</td>
        <td>${doc.uploaded_by_name || "Unknown"}</td>
        <td>${formatDateShort(doc.created_at)}</td>
        <td>
          <a href="/${doc.file_path ? doc.file_path.replace(/\\\\/g, "/") : ""}" target="_blank" class="btn btn-small btn-secondary">View</a>
        </td>
        <td>
          <button class="btn btn-small btn-danger" onclick="deleteDocument(${doc.id})">Delete</button>
        </td>
      </tr>
    `,
      )
      .join("");

    document.getElementById("documentsTableBody").innerHTML =
      html || '<tr><td colspan="8">No documents yet</td></tr>';
  } catch (error) {
    console.error("Error loading documents:", error);
  }
}

async function deleteDocument(docId) {
  if (!confirm("Are you sure you want to delete this document?")) return;

  showLoading(true);
  try {
    const token = localStorage.getItem("auth_token");
    const response = await fetch(`/api/documents/${docId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) throw new Error("Failed to delete document");

    showToast("Document deleted successfully", "success");
    loadProjectDocuments(); // Reload table
  } catch (error) {
    console.error("Error deleting document:", error);
    showToast(error.message, "error");
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

    const tbody = document.getElementById("issuesTableBody");
    const html = allIssues
      .map(
        (issue) => `
      <tr>
        <td>${issue.title}</td>
        <td>${issue.raised_by_name || "Unknown"}</td>
        <td><span class="badge badge-${issue.status === "open" ? "danger" : issue.status === "escalated" ? "warning" : "success"}">${issue.status}</span></td>
        <td>${formatDate(issue.created_at)}</td>
        <td>
          ${issue.status !== "resolved" ? `<button class="btn btn-small btn-success" onclick="resolveIssue(${issue.id})">Resolve</button>` : "Resolved"}
        </td>
      </tr>
    `,
      )
      .join("");

    document.getElementById("issuesTableBody").innerHTML =
      html || '<tr><td colspan="5">No issues</td></tr>';
  } catch (error) {
    console.error("Error loading issues:", error);
  }
}

async function loadProjectCommunications() {
  try {
    const response = await fetch(
      `/api/communications?project_id=${currentProjectId}`,
    );
    allCommunications = await response.json();
    displayCommunications();
  } catch (error) {
    console.error("Error loading communications:", error);
  }
}

function displayCommunications() {
  const chatDiv = document.getElementById("chatMessages");
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

async function sendMessage() {
  const input = document.getElementById("messageInput");
  const message = input.value.trim();
  if (!message) return;

  showLoading(true);
  try {
    const response = await fetch("/api/communications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: currentProjectId,
        message: message,
      }),
    });

    if (!response.ok) throw new Error("Failed to send message");

    input.value = "";
    loadProjectCommunications();
  } catch (error) {
    console.error("Error sending message:", error);
    showToast("Failed to send message", "error");
  } finally {
    showLoading(false);
  }
}

async function loadBudgetTracking() {
  try {
    const response = await fetch(`/api/budget?project_id=${currentProjectId}`);
    const budgetData = await response.json();

    const project = allProjects.find((p) => p.id === currentProjectId);
    const total = parseFloat(project?.total_budget || 0);
    const spent = budgetData.reduce(
      (sum, item) => sum + parseFloat(item.amount_spent),
      0,
    );

    document.getElementById("totalBudget").textContent = "₹" + total.toFixed(2);
    document.getElementById("spentAmount").textContent = "₹" + spent.toFixed(2);
    document.getElementById("remainingAmount").textContent =
      "₹" + (total - spent).toFixed(2);
    document.getElementById("budgetProgress").style.width = total
      ? (spent / total) * 100 + "%"
      : "0%";

    // Chart
    const dateMap = {};
    budgetData.forEach((item) => {
      if (!dateMap[item.date]) dateMap[item.date] = 0;
      dateMap[item.date] += parseFloat(item.amount_spent);
    });

    const sortedDates = Object.keys(dateMap).sort();
    const last30Days = sortedDates.slice(Math.max(0, sortedDates.length - 30));
    const values = last30Days.map((date) => dateMap[date]);

    const ctx = document.getElementById("pmBudgetChart");
    if (pmBudgetChart) pmBudgetChart.destroy();

    pmBudgetChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: last30Days,
        datasets: [
          {
            label: "Daily Spend (₹)",
            data: values,
            borderColor: "#0F6E56",
            backgroundColor: "rgba(15, 110, 86, 0.1)",
            borderWidth: 2,
            fill: true,
            tension: 0.4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: true, position: "top" } },
        scales: { y: { beginAtZero: true } },
      },
    });
  } catch (error) {
    console.error("Error loading budget:", error);
  }
}

async function loadTeamInfo() {
  try {
    const project = allProjects.find((p) => p.id === currentProjectId);
    const team = project && project.assignments ? project.assignments : [];

    const html = team
      .map(
        (member) => `
      <li style="padding: 8px 0; border-bottom: 1px solid #eee;">
        <strong>${member.name}</strong> <span class="badge badge-secondary">${member.role.replace(/_/g, " ")}</span>
        <br><small style="color: #999;">${member.employment_id}</small>
      </li>
    `,
      )
      .join("");

    document.getElementById("teamList").innerHTML =
      html || "<li>No team members</li>";
  } catch (error) {
    console.error("Error loading team:", error);
  }
}

function openAddTaskModal() {
  document.getElementById("addTaskForm").reset();
  openModal("addTaskModal");
}

async function handleAddTask(e) {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);

  const assignedToRaw = formData.get("assigned_to");
  // parseInt might return NaN for string IDs, which causes backend to throw 400 Bad Request
  const assignedTo = parseInt(assignedToRaw);

  const taskData = {
    project_id: currentProjectId,
    assigned_to: isNaN(assignedTo) ? assignedToRaw : assignedTo,
    title: formData.get("title"),
    description: formData.get("description"),
    due_date: formData.get("due_date") || null,
  };

  showLoading(true);
  try {
    const token = localStorage.getItem("auth_token");
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(taskData),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || "Failed to create task");
    }

    showToast("Task created successfully", "success");
    closeModal("addTaskModal");
    loadProjectTasks();
  } catch (error) {
    console.error("Error:", error);
    showToast(error.message, "error");
  } finally {
    showLoading(false);
  }
}

function openUploadDocModal() {
  document.getElementById("uploadDocForm").reset();
  const previewContainer = document.getElementById("documentPreviewContainer");
  if (previewContainer) {
    previewContainer.innerHTML =
      '<p style="color: #999;">No document selected</p>';
  }
  openModal("uploadDocModal");
}

document.addEventListener("DOMContentLoaded", () => {
  const docInput = document.getElementById("documentFileInput");
  if (docInput) {
    docInput.addEventListener("change", function (e) {
      const file = e.target.files[0];
      const previewContainer = document.getElementById(
        "documentPreviewContainer",
      );

      if (!file) {
        previewContainer.innerHTML =
          '<p style="color: #999;">No document selected</p>';
        return;
      }

      const fileType = file.type;
      const fileURL = URL.createObjectURL(file);

      if (fileType.startsWith("image/")) {
        previewContainer.innerHTML = `<img src="${fileURL}" style="max-width: 100%; max-height: 100%; object-fit: contain;">`;
      } else if (fileType === "application/pdf") {
        previewContainer.innerHTML = `<iframe src="${fileURL}" style="width: 100%; height: 100%; border: none;"></iframe>`;
      } else {
        previewContainer.innerHTML = `<div style="text-align: center;"><p style="font-size: 48px; margin-bottom: 10px;">📄</p><p><strong>${file.name}</strong></p><p style="color: #666; font-size: 12px;">Preview not available for this file type.</p></div>`;
      }
    });
  }
});

async function handleUploadDoc(e) {
  e.preventDefault();
  const form = e.target;
  const originalFormData = new FormData(form);
  const formData = new FormData();

  // Append project_id FIRST so multer's diskStorage has it available before parsing the file
  formData.append("project_id", currentProjectId);

  for (const [key, value] of originalFormData.entries()) {
    formData.append(key, value);
  }

  showLoading(true);
  try {
    const response = await fetch("/api/documents", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) throw new Error("Failed to upload document");

    showToast("Document uploaded successfully", "success");
    closeModal("uploadDocModal");
    loadProjectDocuments();
  } catch (error) {
    console.error("Error:", error);
    showToast(error.message, "error");
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

function editTaskStatus(taskId) {
  const task = allTasks.find((t) => t.id === taskId);
  const newStatus = prompt(
    `Current status: ${task.status}\nNew status (pending/in_progress/completed):`,
    task.status,
  );
  if (!newStatus) return;

  const token = localStorage.getItem("auth_token");
  fetch(`/api/tasks/${taskId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ status: newStatus }),
  })
    .then((r) => {
      if (r.ok) {
        showToast("Task updated", "success");
        loadProjectTasks();
      } else {
        showToast("Failed to update task", "error");
      }
    })
    .catch((e) => showToast("Failed to update task", "error"));
}

async function resolveIssue(issueId) {
  showLoading(true);
  try {
    const response = await fetch(`/api/troubleshoot/${issueId}/resolve`, {
      method: "PUT",
    });

    if (!response.ok) throw new Error("Failed to resolve");
    showToast("Issue resolved", "success");
    loadProjectIssues();
  } catch (error) {
    showToast("Failed to resolve issue", "error");
  } finally {
    showLoading(false);
  }
}

function downloadImage(filePath) {
  const a = document.createElement("a");
  a.href = "/" + filePath;
  a.download = "";
  a.click();
}

function viewImageFull(filePath) {
  const modal = document.createElement("div");
  modal.className = "modal show";
  modal.style.zIndex = "10000";
  modal.innerHTML = `
    <div style="position: relative; background: rgba(0,0,0,0.8); padding: 0; border-radius: 0; width: 90vw; height: 90vh; display: flex; align-items: center; justify-content: center;">
      <img src="/${filePath}" style="max-width: 100%; max-height: 100%; object-fit: contain;">
      <button class="modal-close" style="position: absolute; top: 10px; right: 10px; color: white; background: rgba(0,0,0,0.5);" onclick="this.closest('.modal').remove()">&times;</button>
    </div>
  `;
  document.body.appendChild(modal);
}

function exportDocsCSV() {
  const rows = [
    ["Document", "Drawing No", "Status", "Category", "Uploaded By", "Date"],
  ];
  allDocuments.forEach((doc) => {
    rows.push([
      doc.title || "Untitled",
      doc.drawing_no || "-",
      doc.doc_status || "-",
      doc.category || "-",
      doc.uploaded_by_name || "-",
      formatDateShort(doc.created_at),
    ]);
  });

  const csv = rows
    .map((row) => row.map((cell) => `"${cell}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "documents_" + new Date().toISOString().split("T")[0] + ".csv";
  a.click();
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

  document
    .getElementById("addTaskForm")
    .addEventListener("submit", handleAddTask);
  document
    .getElementById("uploadDocForm")
    .addEventListener("submit", handleUploadDoc);
  document
    .getElementById("projectSearch")
    .addEventListener("keyup", updateProjectSidebar);

  loadProjects();

  // Add CSS
  const style = document.createElement("style");
  style.textContent = `
    @keyframes slideOutRight {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(400px); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
});
