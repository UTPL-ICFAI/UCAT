/**
 * Daily Workers Management Module
 * Handles adding, viewing, and marking attendance for daily labour workers
 */

/**
 * Open add daily worker modal
 */
function openAddDailyWorkerModal() {
  const token = localStorage.getItem('auth_token');
  
  // Load projects for the select
  fetch('/api/projects', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
    .then(response => response.json())
    .then(data => {
      if (data.success && Array.isArray(data.data)) {
        const select = document.getElementById('addWorkerProjectSelect');
        select.innerHTML = '<option value="">Choose a project...</option>';
        
        data.data.forEach(project => {
          const option = document.createElement('option');
          option.value = project.id;
          option.textContent = project.name;
          select.appendChild(option);
        });
      }
    })
    .catch(error => console.error('Error loading projects:', error));
  
  document.getElementById('addDailyWorkerModal').style.display = 'flex';
}

/**
 * Handle add daily worker form submission
 */
function handleAddDailyWorker(e) {
  e.preventDefault();
  
  const form = document.getElementById('addDailyWorkerForm');
  const formData = new FormData(form);
  
  const data = {
    project_id: parseInt(formData.get('project_id')),
    worker_name: formData.get('worker_name'),
    gender: formData.get('gender'),
    worker_category: formData.get('worker_category'),
    work_date: formData.get('work_date')
  };
  
  const token = localStorage.getItem('auth_token');
  
  fetch('/api/daily-workers', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(data)
  })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        showToast('Worker added successfully', 'success');
        form.reset();
        closeModal('addDailyWorkerModal');
        loadDailyWorkers();
      } else {
        showToast(data.message || 'Failed to add worker', 'error');
      }
    })
    .catch(error => {
      console.error('Error adding worker:', error);
      showToast('Error adding worker', 'error');
    });
}

/**
 * Load daily workers based on selected project and date
 */
function loadDailyWorkers() {
  const projectId = document.getElementById('workersProjectSelect').value;
  const workDate = document.getElementById('workersDateSelect').value;
  
  if (!projectId || !workDate) {
    document.getElementById('dailyWorkersTableBody').innerHTML = 
      '<tr><td colspan="7" style="text-align: center; padding: 20px;">Please select both project and date</td></tr>';
    return;
  }
  
  const token = localStorage.getItem('auth_token');
  
  fetch(`/api/daily-workers/${projectId}/${workDate}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
    .then(response => response.json())
    .then(data => {
      if (data.success && Array.isArray(data.data)) {
        const tbody = document.getElementById('dailyWorkersTableBody');
        
        if (data.data.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;">No workers added for this date</td></tr>';
          return;
        }
        
        tbody.innerHTML = data.data.map(worker => `
          <tr>
            <td>${worker.worker_name}</td>
            <td>${worker.gender ? worker.gender.charAt(0).toUpperCase() + worker.gender.slice(1) : 'N/A'}</td>
            <td>${worker.worker_category}</td>
            <td>${formatDate(worker.work_date)}</td>
            <td>
              ${worker.attendance_marked ? 
                '<span style="color: green; font-weight: bold;">✓ Present</span>' : 
                '<button class="btn btn-sm" onclick="markAttendance(${worker.id})">Mark</button>'
              }
            </td>
            <td>${worker.attendance_marked_by ? worker.attendance_marked_by : '-'}</td>
            <td>
              <button class="btn btn-sm btn-danger" onclick="deleteWorker(${worker.id})">Delete</button>
            </td>
          </tr>
        `).join('');
      }
    })
    .catch(error => {
      console.error('Error loading workers:', error);
      document.getElementById('dailyWorkersTableBody').innerHTML = 
        '<tr><td colspan="7" style="text-align: center; padding: 20px; color: red;">Error loading workers</td></tr>';
    });
}

/**
 * Mark attendance for a worker
 */
function markAttendance(workerId) {
  const token = localStorage.getItem('auth_token');
  
  fetch(`/api/daily-workers/${workerId}/mark-attendance`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({})
  })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        showToast('Attendance marked successfully', 'success');
        loadDailyWorkers();
      } else {
        showToast(data.message || 'Failed to mark attendance', 'error');
      }
    })
    .catch(error => {
      console.error('Error marking attendance:', error);
      showToast('Error marking attendance', 'error');
    });
}

/**
 * Delete a daily worker record
 */
function deleteWorker(workerId) {
  if (!confirm('Are you sure you want to delete this worker record?')) {
    return;
  }
  
  const token = localStorage.getItem('auth_token');
  
  fetch(`/api/daily-workers/${workerId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        showToast('Worker deleted successfully', 'success');
        loadDailyWorkers();
      } else {
        showToast(data.message || 'Failed to delete worker', 'error');
      }
    })
    .catch(error => {
      console.error('Error deleting worker:', error);
      showToast('Error deleting worker', 'error');
    });
}

/**
 * Load projects for workers filter
 */
function loadProjectsForWorkers() {
  const token = localStorage.getItem('auth_token');
  
  fetch('/api/projects', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
    .then(response => response.json())
    .then(data => {
      if (data.success && Array.isArray(data.data)) {
        const select = document.getElementById('workersProjectSelect');
        select.innerHTML = '<option value="">Choose a project...</option>';
        
        data.data.forEach(project => {
          const option = document.createElement('option');
          option.value = project.id;
          option.textContent = project.name;
          select.appendChild(option);
        });
      }
    })
    .catch(error => console.error('Error loading projects:', error));
}

/**
 * Initialize daily workers module
 */
function initDailyWorkers() {
  const workersProjectSelect = document.getElementById('workersProjectSelect');
  const workersDateSelect = document.getElementById('workersDateSelect');
  const addWorkerForm = document.getElementById('addDailyWorkerForm');
  
  if (workersProjectSelect) {
    loadProjectsForWorkers();
    workersProjectSelect.addEventListener('change', loadDailyWorkers);
  }
  
  if (workersDateSelect) {
    workersDateSelect.addEventListener('change', loadDailyWorkers);
  }
  
  if (addWorkerForm) {
    addWorkerForm.addEventListener('submit', handleAddDailyWorker);
  }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('daily-workers')) {
    initDailyWorkers();
  }
});
