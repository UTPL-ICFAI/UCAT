// Supervisor Dashboard JS

let currentUser = null;
let allProjects = [];
let allWorkers = [];
let allImages = [];
let allIssues = [];
let selectedAttendanceData = {};

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

function navigateSection(sectionId) {
  if (!sectionId) return;

  document
    .querySelectorAll(".page-section")
    .forEach((s) => s.classList.add("hidden"));
  const section = document.getElementById(sectionId);
  if (section) section.classList.remove("hidden");

  document
    .querySelectorAll(".top-nav-link")
    .forEach((l) => l.classList.remove("active"));
  if (event && event.target) event.target.classList.add("active");

  // Load section data
  if (sectionId === "attendance") {
    loadAttendanceProjects();
    document.getElementById("attendanceDate").valueAsDate = new Date();
  } else if (sectionId === "goals") {
    loadSupervisorGoals();
  } else if (sectionId === "upload") {
    loadUploadProjects();
  } else if (sectionId === "issues") {
    loadIssues();
  } else if (sectionId === "chat") {
    populateChatProjectSelect();
    const select = document.getElementById("chatProjectSelect");
    if (select && select.value) {
      loadChatForProject();
    }
  }
}

async function loadProjects() {
  try {
    const response = await fetch("/api/projects");
    allProjects = await response.json();

    displayProjectCards();

    // Populate selects
    const attendanceSelect = document.getElementById("attendanceProjectSelect");
    const uploadSelect = document.getElementById("uploadProjectSelect");
    const issueSelect = document.getElementById("issueProjectSelect");
    const goalsSelect = document.getElementById("goalsProjectSelect");

    allProjects.forEach((project) => {
      const option = document.createElement("option");
      option.value = project.id;
      option.textContent = project.name;
      attendanceSelect.appendChild(option.cloneNode(true));
      uploadSelect.appendChild(option.cloneNode(true));
      issueSelect.appendChild(option.cloneNode(true));
      if (goalsSelect) goalsSelect.appendChild(option.cloneNode(true));
    });
  } catch (error) {
    console.error("Error loading projects:", error);
    showToast("Failed to load projects", "error");
  }
}

function displayProjectCards() {
  const grid = document.getElementById("projectsGrid");
  if (allProjects.length === 0) {
    grid.innerHTML =
      '<div style="text-align: center; padding: 40px; grid-column: 1/-1;">No projects assigned</div>';
    return;
  }

  grid.innerHTML = allProjects
    .map(
      (project) => `
    <div class="project-card">
      <h3>${project.name}</h3>
      <p><strong>Location:</strong> ${project.location}</p>
      <p><strong>City:</strong> ${project.city}</p>
      <p><strong>Status:</strong> <span class="badge badge-${project.work_status === "active" ? "success" : "secondary"}">${project.work_status}</span></p>
      <div style="margin-top: 12px; display: flex; gap: 10px;">
        <button class="btn" onclick="openProjectChat(${project.id}, '${project.name.replace(/'/g, "\\'")}')">Open Chat</button>
      </div>
    </div>
  `,
    )
    .join("");
}

async function loadAttendanceProjects() {
  const projectId = document.getElementById("attendanceProjectSelect").value;
  if (!projectId) {
    document.getElementById("attendanceForm").style.display = "none";
    return;
  }

  await loadAttendanceWorkers();
}

async function loadAttendanceWorkers() {
  const projectId = document.getElementById("attendanceProjectSelect").value;
  if (!projectId) {
    document.getElementById("attendanceForm").style.display = "none";
    return;
  }

  try {
    const token = localStorage.getItem("auth_token");
    const response = await fetch(`/api/workers?project_id=${projectId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const workers = await response.json();
    allWorkers = Array.isArray(workers) ? workers : []; // backend filters by supervisor_id for supervisors

    const tbody = document.getElementById("attendanceTableBody");
    if (allWorkers.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="2" style="text-align:center;color:#999;padding:20px;">No workers assigned to you for this project yet.</td></tr>';
      document.getElementById("attendanceForm").style.display = "block";
      return;
    }
    tbody.innerHTML = allWorkers
      .map(
        (worker) => `
      <tr>
        <td>${worker.name}</td>
        <td>
          <select id="status_${worker.id}" style="padding: 6px 10px;">
            <option value="">Select...</option>
            <option value="present">Present</option>
            <option value="absent">Absent</option>
            <option value="half_day">Half Day</option>
          </select>
        </td>
      </tr>
    `,
      )
      .join("");

    document.getElementById("attendanceForm").style.display = "block";
  } catch (error) {
    console.error("Error loading workers:", error);
    showToast("Failed to load workers", "error");
  }
}

async function submitAttendance() {
  const projectId = document.getElementById("attendanceProjectSelect").value;
  const date = document.getElementById("attendanceDate").value;

  if (!projectId || !date) {
    showToast("Please select project and date", "error");
    return;
  }

  const records = [];
  for (const worker of allWorkers) {
    const status = document.getElementById(`status_${worker.id}`).value;
    if (status) {
      records.push({ worker_id: worker.id, date, status });
    }
  }

  if (records.length === 0) {
    showToast("Please mark attendance for at least one worker", "error");
    return;
  }

  showLoading(true);
  try {
    const token = localStorage.getItem("auth_token");
    const response = await fetch("/api/attendance", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        project_id: parseInt(projectId),
        attendance_records: records,
      }),
    });

    if (!response.ok) throw new Error("Failed to submit attendance");
    showToast("Attendance submitted successfully", "success");
    loadAttendanceWorkers();
  } catch (error) {
    console.error("Error:", error);
    showToast("Failed to submit attendance", "error");
  } finally {
    showLoading(false);
  }
}

async function loadUploadProjects() {
  // Just make sure selects are populated
  if (document.getElementById("uploadProjectSelect").options.length === 1) {
    showToast("No projects available", "error");
  }

  const uploadSelect = document.getElementById("uploadProjectSelect");
  const gallery = document.getElementById("recentUploadsGallery");
  if (gallery) {
    gallery.innerHTML =
      '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #999;">Select a project to view images</div>';
  }

  if (uploadSelect && !uploadSelect.dataset.listenerAttached) {
    uploadSelect.addEventListener("change", () => {
      loadRecentUploads();
    });
    uploadSelect.dataset.listenerAttached = "true";
  }
}

document.addEventListener("DOMContentLoaded", function () {
  const imageInput = document.getElementById("imageInput");
  if (imageInput) {
    imageInput.addEventListener("change", (e) => {
      const preview = document.getElementById("imagePreview");
      preview.innerHTML = "";

      Array.from(e.target.files).forEach((file) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          const img = document.createElement("img");
          img.src = event.target.result;
          img.style.width = "100px";
          img.style.height = "100px";
          img.style.objectFit = "cover";
          img.style.margin = "5px";
          img.style.borderRadius = "4px";
          preview.appendChild(img);
        };
        reader.readAsDataURL(file);
      });
    });
  }
});

async function uploadImages() {
  const projectId = document.getElementById("uploadProjectSelect").value;
  const imageInput = document.getElementById("imageInput");
  const description = document.getElementById("imageDescription").value;

  if (!projectId || imageInput.files.length === 0) {
    showToast("Please select project and images", "error");
    return;
  }

  const formData = new FormData();
  formData.append("project_id", projectId);
  formData.append("description", description);
  Array.from(imageInput.files).forEach((file) => {
    formData.append("images", file);
  });

  showLoading(true);
  try {
    const response = await fetch("/api/images", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to upload images");
    }

    showToast("Images uploaded successfully", "success");
    imageInput.value = "";
    document.getElementById("imagePreview").innerHTML = "";
    document.getElementById("imageDescription").value = "";
    loadRecentUploads();
  } catch (error) {
    console.error("Error:", error);
    showToast(error.message, "error");
  } finally {
    showLoading(false);
  }
}

async function loadRecentUploads() {
  const projectId = document.getElementById("uploadProjectSelect").value;
  const gallery = document.getElementById("recentUploadsGallery");

  if (!projectId) {
    if (gallery) {
      gallery.innerHTML =
        '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #999;">Select a project to view images</div>';
    }
    return;
  }

  try {
    const token = localStorage.getItem("auth_token");
    const response = await fetch(`/api/images?project_id=${projectId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    allImages = await response.json();

    gallery.innerHTML = allImages
      .slice(0, 12)
      .map(
        (img) => `
      <div class="gallery-item">
        <img src="/${img.file_path}" alt="${img.original_name}">
        <div style="padding: 8px; background: #f5f5f5; font-size: 12px;">
          <div><strong>${img.original_name.substring(0, 20)}...</strong></div>
          <div><span class="badge badge-${img.status === "approved" ? "success" : img.status === "rejected" ? "danger" : "warning"}">${img.status}</span></div>
        </div>
      </div>
    `,
      )
      .join("");

    if (allImages.length === 0) {
      gallery.innerHTML =
        '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #999;">No recent uploads</div>';
    }
  } catch (error) {
    console.error("Error loading uploads:", error);
  }
}

// ─── Goals ───────────────────────────────────────────────────────────────────

async function loadSupervisorGoals() {
  const projectId = document.getElementById("goalsProjectSelect").value;
  const tbody = document.getElementById("supervisorGoalsTableBody");

  if (!projectId) {
    tbody.innerHTML =
      '<tr><td colspan="5">Select a project to view goals</td></tr>';
    return;
  }

  try {
    const token = localStorage.getItem("auth_token");
    const response = await fetch(
      `/api/supervisor-goals/my?project_id=${projectId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const goals = await response.json();

    tbody.innerHTML =
      goals.length === 0
        ? '<tr><td colspan="5">No goals assigned yet</td></tr>'
        : goals
            .map((goal) => {
              const isCompleted = goal.status === "completed";
              const actionBtn = isCompleted
                ? ""
                : `<button class="btn btn-small" onclick="markGoalCompleted(${goal.id})">Mark Completed</button>`;
              return `
              <tr>
                <td>${goal.title}</td>
                <td>${goal.assigned_by_name || "Site Engineer"}</td>
                <td>${formatDateShort(goal.due_date)}</td>
                <td><span class="badge badge-${isCompleted ? "success" : goal.status === "in_progress" ? "warning" : "primary"}">${goal.status}</span></td>
                <td>${actionBtn}</td>
              </tr>
            `;
            })
            .join("");
  } catch (error) {
    console.error("Error loading goals:", error);
    tbody.innerHTML = '<tr><td colspan="5">Failed to load goals</td></tr>';
  }
}

async function markGoalCompleted(goalId) {
  showLoading(true);
  try {
    const token = localStorage.getItem("auth_token");
    const response = await fetch(`/api/supervisor-goals/${goalId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status: "completed" }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || "Failed to update goal");
    }
    showToast("Goal marked as completed", "success");
    loadSupervisorGoals();
  } catch (error) {
    showToast(error.message || "Failed to update goal", "error");
  } finally {
    showLoading(false);
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
        project_id: parseInt(formData.get("project_id")),
        title: formData.get("title"),
        description: formData.get("description"),
      }),
    });

    if (!response.ok) throw new Error("Failed to raise issue");
    showToast("Issue raised successfully", "success");
    closeModal("raiseIssueModal");
    loadIssues();
  } catch (error) {
    console.error("Error:", error);
    showToast("Failed to raise issue", "error");
  } finally {
    showLoading(false);
  }
}

async function loadIssues() {
  try {
    const response = await fetch("/api/troubleshoot");
    allIssues = await response
      .json()
      .then((issues) => issues.filter((i) => i.raised_by === currentUser.id));

    const tbody = document.getElementById("issuesTableBody");
    const html = allIssues
      .map((issue) => {
        const project = allProjects.find((p) => p.id === issue.project_id);
        return `
        <tr>
          <td>${project?.name || "Unknown"}</td>
          <td>${issue.title}</td>
          <td><span class="badge badge-${issue.status === "open" ? "danger" : issue.status === "escalated" ? "warning" : "success"}">${issue.status}</span></td>
          <td>${formatDate(issue.created_at)}</td>
        </tr>
      `;
      })
      .join("");

    document.getElementById("issuesTableBody").innerHTML =
      html || '<tr><td colspan="4">No issues raised yet</td></tr>';
  } catch (error) {
    console.error("Error loading issues:", error);
  }
}

// ─── Chat ────────────────────────────────────────────────────────────────────

let svChatProjectId = null;
let svChatMessages = [];

function populateChatProjectSelect() {
  const select = document.getElementById("chatProjectSelect");
  // Preserve existing populated state; only rebuild if empty
  if (select.options.length <= 1) {
    select.innerHTML = '<option value="">Choose a project...</option>';
    allProjects.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      select.appendChild(opt);
    });
  }
  // If came from openProjectChat(), project is already selected — load its chat
  if (svChatProjectId && select.value == svChatProjectId) {
    loadChatForProject();
  }
}

function openProjectChat(projectId, projectName) {
  svChatProjectId = projectId;

  // Switch to chat section
  document
    .querySelectorAll(".page-section")
    .forEach((s) => s.classList.add("hidden"));
  const chatSection = document.getElementById("chat");
  if (chatSection) chatSection.classList.remove("hidden");
  document
    .querySelectorAll(".top-nav-link")
    .forEach((l) => l.classList.remove("active"));
  document.querySelectorAll(".top-nav-link").forEach((l) => {
    if (l.textContent.trim() === "Chat") l.classList.add("active");
  });

  // Pre-select project in the dropdown
  const select = document.getElementById("chatProjectSelect");
  populateChatProjectSelect();
  select.value = projectId;
  document.getElementById("chatProjectTitle").textContent = "💬 " + projectName;
  document.getElementById("chatArea").style.display = "block";
  loadChatForProject();
}

async function loadChatForProject() {
  const select = document.getElementById("chatProjectSelect");
  const projectId = select ? select.value : svChatProjectId;

  if (!projectId) {
    document.getElementById("chatArea").style.display = "none";
    return;
  }

  svChatProjectId = parseInt(projectId);
  const project = allProjects.find((p) => p.id === svChatProjectId);
  document.getElementById("chatProjectTitle").textContent = project
    ? "💬 " + project.name
    : "💬 Project Chat";
  document.getElementById("chatArea").style.display = "block";

  try {
    const token = localStorage.getItem("auth_token");
    const response = await fetch(
      `/api/communications?project_id=${projectId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!response.ok) throw new Error("Failed to load messages");
    svChatMessages = await response.json();
    displaySvChat();
  } catch (error) {
    console.error("Load chat error:", error);
    showToast("Failed to load chat messages", "error");
  }
}

function displaySvChat() {
  const chatDiv = document.getElementById("svChatMessages");
  if (!chatDiv) return;
  const msgs = [...svChatMessages].reverse();
  chatDiv.innerHTML =
    msgs.length === 0
      ? '<p style="color:#999; text-align:center; margin-top: 20px;">No messages yet. Start the conversation!</p>'
      : msgs
          .map((msg) => {
            const isMe = currentUser && msg.sender_id === currentUser.id;
            return `
          <div style="margin-bottom: 14px; display: flex; flex-direction: column; align-items: ${isMe ? "flex-end" : "flex-start"};">
            <div style="max-width: 70%; background: ${isMe ? "#f59e0b" : "white"}; color: ${isMe ? "white" : "#333"}; padding: 10px 14px; border-radius: ${isMe ? "12px 12px 4px 12px" : "12px 12px 12px 4px"}; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
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

async function svSendMessage() {
  const input = document.getElementById("svMessageInput");
  const message = (input ? input.value : "").trim();
  if (!message || !svChatProjectId) return;

  showLoading(true);
  try {
    const token = localStorage.getItem("auth_token");
    const response = await fetch("/api/communications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ project_id: svChatProjectId, message }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || "Failed to send message");
    }

    input.value = "";
    await loadChatForProject();
  } catch (error) {
    console.error("Send message error:", error);
    showToast(error.message || "Failed to send message", "error");
  } finally {
    showLoading(false);
  }
}

// Allow Enter key (without Shift) to send message
document.addEventListener("DOMContentLoaded", () => {
  const inp = document.getElementById("svMessageInput");
  if (inp) {
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        svSendMessage();
      }
    });
  }
});

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
  }

  document
    .getElementById("raiseIssueForm")
    .addEventListener("submit", handleRaiseIssue);
  document.querySelectorAll(".top-nav-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();

      const href = link.getAttribute("href") || "";
      let sectionId = href.startsWith("#") ? href.substring(1) : "";

      if (!sectionId) {
        const onclickText = link.getAttribute("onclick") || "";
        const match = onclickText.match(/navigateSection\('([^']+)'\)/);
        sectionId = match ? match[1] : "";
      }

      navigateSection(sectionId);
    });
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
