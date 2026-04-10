// Supervisor Dashboard JS

let currentUser = null;
let allProjects = [];
let allWorkers = [];
let allImages = [];
let allIssues = [];
let selectedAttendanceData = {};

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer') || createToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideOutRight 0.3s ease-out forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function createToastContainer() {
  const container = document.createElement('div');
  container.id = 'toastContainer';
  container.className = 'toast-container';
  document.body.appendChild(container);
  return container;
}

function showLoading(show = true) {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) {
    overlay.classList.toggle('show', show);
  }
}

function getCookie(name) {
  const nameEQ = name + '=';
  const cookies = document.cookie.split(';');
  for (let i = 0; i < cookies.length; i++) {
    let cookie = cookies[i].trim();
    if (cookie.indexOf(nameEQ) === 0) {
      return cookie.substring(nameEQ.length, cookie.length);
    }
  }
  return null;
}

function decodeJWT(token) {
  const base64Url = token.split('.')[1];
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => {
    return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
  }).join(''));
  return JSON.parse(jsonPayload);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata'
  }).format(date);
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Kolkata'
  }).format(date);
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('show');
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('show');
  }
}

async function logoutUser() {
  if (!confirm('Are you sure you want to logout?')) return;
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } finally {
    localStorage.removeItem('auth_token');
    window.location.href = '/';
  }
}

function navigateSection(sectionId) {
  document.querySelectorAll('.page-section').forEach(s => s.classList.add('hidden'));
  document.getElementById(sectionId).classList.remove('hidden');
  
  document.querySelectorAll('.top-nav-link').forEach(l => l.classList.remove('active'));
  event.target.classList.add('active');
  
  // Load section data
  if (sectionId === 'attendance') {
    loadAttendanceProjects();
    document.getElementById('attendanceDate').valueAsDate = new Date();
  } else if (sectionId === 'upload') {
    loadUploadProjects();
  } else if (sectionId === 'issues') {
    loadIssues();
  }
}

async function loadProjects() {
  try {
    const response = await fetch('/api/projects');
    allProjects = await response.json();
    
    displayProjectCards();
    
    // Populate selects
    const attendanceSelect = document.getElementById('attendanceProjectSelect');
    const uploadSelect = document.getElementById('uploadProjectSelect');
    const issueSelect = document.getElementById('issueProjectSelect');
    
    allProjects.forEach(project => {
      const option = document.createElement('option');
      option.value = project.id;
      option.textContent = project.name;
      attendanceSelect.appendChild(option.cloneNode(true));
      uploadSelect.appendChild(option.cloneNode(true));
      issueSelect.appendChild(option.cloneNode(true));
    });
  } catch (error) {
    console.error('Error loading projects:', error);
    showToast('Failed to load projects', 'error');
  }
}

function displayProjectCards() {
  const grid = document.getElementById('projectsGrid');
  if (allProjects.length === 0) {
    grid.innerHTML = '<div style="text-align: center; padding: 40px; grid-column: 1/-1;">No projects assigned</div>';
    return;
  }
  
  grid.innerHTML = allProjects.map(project => `
    <div class="project-card">
      <h3>${project.name}</h3>
      <p><strong>Location:</strong> ${project.location}</p>
      <p><strong>City:</strong> ${project.city}</p>
      <p><strong>Status:</strong> <span class="badge badge-${project.work_status === 'active' ? 'success' : 'secondary'}">${project.work_status}</span></p>
    </div>
  `).join('');
}

async function loadAttendanceProjects() {
  const projectId = document.getElementById('attendanceProjectSelect').value;
  if (!projectId) {
    document.getElementById('attendanceForm').style.display = 'none';
    return;
  }
  
  await loadAttendanceWorkers();
}

async function loadAttendanceWorkers() {
  const projectId = document.getElementById('attendanceProjectSelect').value;
  if (!projectId) {
    document.getElementById('attendanceForm').style.display = 'none';
    return;
  }
  
  try {
    const response = await fetch(`/api/workers?project_id=${projectId}`);
    const workers = await response.json();
    allWorkers = workers.filter(w => w.supervisor_id === currentUser.id);
    
    const tbody = document.getElementById('attendanceTableBody');
    tbody.innerHTML = allWorkers.map(worker => `
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
    `).join('');
    
    document.getElementById('attendanceForm').style.display = 'block';
  } catch (error) {
    console.error('Error loading workers:', error);
    showToast('Failed to load workers', 'error');
  }
}

async function submitAttendance() {
  const projectId = document.getElementById('attendanceProjectSelect').value;
  const date = document.getElementById('attendanceDate').value;
  
  if (!projectId || !date) {
    showToast('Please select project and date', 'error');
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
    showToast('Please mark attendance for at least one worker', 'error');
    return;
  }
  
  showLoading(true);
  try {
    const response = await fetch('/api/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: parseInt(projectId),
        attendance_records: records
      })
    });
    
    if (!response.ok) throw new Error('Failed to submit attendance');
    showToast('Attendance submitted successfully', 'success');
    loadAttendanceWorkers();
  } catch (error) {
    console.error('Error:', error);
    showToast('Failed to submit attendance', 'error');
  } finally {
    showLoading(false);
  }
}

async function loadUploadProjects() {
  // Just make sure selects are populated
  if (document.getElementById('uploadProjectSelect').options.length === 1) {
    showToast('No projects available', 'error');
  }
}

document.addEventListener('DOMContentLoaded', function() {
  const imageInput = document.getElementById('imageInput');
  if (imageInput) {
    imageInput.addEventListener('change', (e) => {
      const preview = document.getElementById('imagePreview');
      preview.innerHTML = '';
      
      Array.from(e.target.files).forEach(file => {
        const reader = new FileReader();
        reader.onload = (event) => {
          const img = document.createElement('img');
          img.src = event.target.result;
          img.style.width = '100px';
          img.style.height = '100px';
          img.style.objectFit = 'cover';
          img.style.margin = '5px';
          img.style.borderRadius = '4px';
          preview.appendChild(img);
        };
        reader.readAsDataURL(file);
      });
    });
  }
});

async function uploadImages() {
  const projectId = document.getElementById('uploadProjectSelect').value;
  const imageInput = document.getElementById('imageInput');
  const description = document.getElementById('imageDescription').value;
  
  if (!projectId || imageInput.files.length === 0) {
    showToast('Please select project and images', 'error');
    return;
  }
  
  const formData = new FormData();
  formData.append('project_id', projectId);
  formData.append('description', description);
  Array.from(imageInput.files).forEach(file => {
    formData.append('images', file);
  });
  
  showLoading(true);
  try {
    const response = await fetch('/api/images', {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to upload images');
    }
    
    showToast('Images uploaded successfully', 'success');
    imageInput.value = '';
    document.getElementById('imagePreview').innerHTML = '';
    document.getElementById('imageDescription').value = '';
    loadRecentUploads();
  } catch (error) {
    console.error('Error:', error);
    showToast(error.message, 'error');
  } finally {
    showLoading(false);
  }
}

async function loadRecentUploads() {
  try {
    const response = await fetch(`/api/images?uploaded_by=${currentUser.id}`);
    allImages = await response.json();
    
    const gallery = document.getElementById('recentUploadsGallery');
    gallery.innerHTML = allImages.slice(0, 12).map(img => `
      <div class="gallery-item">
        <img src="/${img.file_path}" alt="${img.original_name}">
        <div style="padding: 8px; background: #f5f5f5; font-size: 12px;">
          <div><strong>${img.original_name.substring(0, 20)}...</strong></div>
          <div><span class="badge badge-${img.status === 'approved' ? 'success' : img.status === 'rejected' ? 'danger' : 'warning'}">${img.status}</span></div>
        </div>
      </div>
    `).join('');
    
    if (allImages.length === 0) {
      gallery.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #999;">No recent uploads</div>';
    }
  } catch (error) {
    console.error('Error loading uploads:', error);
  }
}

function openRaiseIssueModal() {
  document.getElementById('raiseIssueForm').reset();
  openModal('raiseIssueModal');
}

async function handleRaiseIssue(e) {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);
  
  showLoading(true);
  try {
    const response = await fetch('/api/troubleshoot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: parseInt(formData.get('project_id')),
        title: formData.get('title'),
        description: formData.get('description')
      })
    });
    
    if (!response.ok) throw new Error('Failed to raise issue');
    showToast('Issue raised successfully', 'success');
    closeModal('raiseIssueModal');
    loadIssues();
  } catch (error) {
    console.error('Error:', error);
    showToast('Failed to raise issue', 'error');
  } finally {
    showLoading(false);
  }
}

async function loadIssues() {
  try {
    const response = await fetch('/api/troubleshoot');
    allIssues = await response.json().then(issues => issues.filter(i => i.raised_by === currentUser.id));
    
    const tbody = document.getElementById('issuesTableBody');
    const html = allIssues.map(issue => {
      const project = allProjects.find(p => p.id === issue.project_id);
      return `
        <tr>
          <td>${project?.name || 'Unknown'}</td>
          <td>${issue.title}</td>
          <td><span class="badge badge-${issue.status === 'open' ? 'danger' : issue.status === 'escalated' ? 'warning' : 'success'}">${issue.status}</span></td>
          <td>${formatDate(issue.created_at)}</td>
        </tr>
      `;
    }).join('');
    
    document.getElementById('issuesTableBody').innerHTML = html || '<tr><td colspan="4">No issues raised yet</td></tr>';
  } catch (error) {
    console.error('Error loading issues:', error);
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('auth_token');
  if (!token) {
    window.location.href = '/';
    return;
  }
  
  try {
    currentUser = decodeJWT(token);
    document.getElementById('userName').textContent = currentUser.name;
  } catch (error) {
    localStorage.removeItem('auth_token');
    window.location.href = '/';
  }
  
  document.getElementById('raiseIssueForm').addEventListener('submit', handleRaiseIssue);
  document.querySelectorAll('.top-nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigateSection(link.getAttribute('href').substring(1));
    });
  });
  
  loadProjects();
  loadRecentUploads();
  
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideOutRight {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(400px); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
});
