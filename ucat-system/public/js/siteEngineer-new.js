// Wait for DOM to be fully loaded before executing any JavaScript
document.addEventListener('DOMContentLoaded', function() {
  // Initialize the application by calling all setup functions
  initializeApp();
});

// Global variable to store the current selected project ID
let currentProjectId = null;

// Global variable to store all workers for the selected project
let allWorkers = [];

// Global variable to store all available supervisors for assignment
let allSupervisors = [];

/**
 * Initialize the application - called on page load
 * Sets up all event listeners, loads data, and prepares UI
 */
function initializeApp() {
  // Load projects for the current site engineer
  loadProjects();
  // Setup navigation between different sections
  setupNavigation();
  // Setup all event listeners for forms and buttons
  setupEventListeners();
}

/**
 * Load projects assigned to the current site engineer
 * Makes GET request to /api/projects to get projects for this SE
 */
function loadProjects() {
  // Make API request to fetch projects for current site engineer
  fetch('/api/projects')
    // Convert response to JSON
    .then(response => response.json())
    // Handle the projects data
    .then(data => {
      // Store projects in global for later use if needed
      const projects = data || [];
      // Get the project select dropdown element
      const projectSelect = document.getElementById('projectSelect');
      // Clear existing options except the default one
      projectSelect.innerHTML = '<option value="">Choose a project...</option>';
      // Loop through each project to add as option
      projects.forEach(project => {
        // Create a new option element
        const option = document.createElement('option');
        // Set the option value to the project ID
        option.value = project.id;
        // Set the option text to the project name
        option.textContent = project.name;
        // Append the option to the select element
        projectSelect.appendChild(option);
      });
      // Get the projects list container
      const projectsList = document.getElementById('projectsList');
      // Clear any existing projects display
      projectsList.innerHTML = '';
      // Check if projects exist
      if (projects.length > 0) {
        // Loop through each project
        projects.forEach(project => {
          // Create a div for each project
          const projectDiv = document.createElement('div');
          // Add CSS class for project card styling
          projectDiv.className = 'project-card';
          // Set the HTML content for the project card
          projectDiv.innerHTML = `
            <!-- Project name heading -->
            <h3>${project.name}</h3>
            <!-- Project location -->
            <p><strong>Location:</strong> ${project.location || 'N/A'}</p>
            <!-- Project city -->
            <p><strong>City:</strong> ${project.city || 'N/A'}</p>
            <!-- Project description -->
            <p><strong>Description:</strong> ${project.description || 'N/A'}</p>
            <!-- Project status -->
            <p><strong>Status:</strong> ${project.status || 'active'}</p>
          `;
          // Append the project card to the list
          projectsList.appendChild(projectDiv);
        });
      } else {
        // Display message if no projects found
        projectsList.innerHTML = '<p>No projects assigned to you yet.</p>';
      }
    })
    // Catch and log any errors from the API request
    .catch(error => console.error('Error loading projects:', error));
}

/**
 * Load workers for a specific project
 * Makes GET request to /api/workers?project_id=X
 * @param {number} projectId - The project ID to load workers for
 */
function loadWorkers(projectId) {
  // Store the selected project ID in global variable
  currentProjectId = projectId;
  // Check if a project was selected
  if (!projectId) {
    // Clear the workers table if no project selected
    document.getElementById('workersTable').innerHTML = '';
    // Show empty state message
    document.getElementById('emptyWorkerState').style.display = 'block';
    // Exit function early
    return;
  }
  // Hide empty state message when project is selected
  document.getElementById('emptyWorkerState').style.display = 'none';
  // Make API request to fetch workers for this project
  fetch(`/api/workers?project_id=${projectId}`)
    // Convert response to JSON
    .then(response => response.json())
    // Handle the workers data
    .then(data => {
      // Store workers in global variable
      allWorkers = data || [];
      // Display the workers in the workers table
      displayWorkersTable(allWorkers);
    })
    // Catch and log any errors from the API request
    .catch(error => {
      // Log error to console
      console.error('Error loading workers:', error);
      // Show error toast notification
      showToast('Failed to load workers', 'error');
    });
}

/**
 * Display workers in the workers table with action buttons
 * @param {Array} workers - Array of worker objects to display
 */
function displayWorkersTable(workers) {
  // Get the table body element where worker rows will be added
  const tableBody = document.getElementById('workersTable');
  // Clear any existing rows in the table
  tableBody.innerHTML = '';
  // Check if there are workers to display
  if (!workers || workers.length === 0) {
    // Show empty state message if no workers
    document.getElementById('emptyWorkerState').style.display = 'block';
    // Exit function early if no workers
    return;
  }
  // Hide empty state message when workers exist
  document.getElementById('emptyWorkerState').style.display = 'none';
  // Loop through each worker to create table rows
  workers.forEach((worker, index) => {
    // Create a new table row element
    const row = document.createElement('tr');
    // Set the HTML content of the row with worker data
    row.innerHTML = `
      <!-- Row number (index + 1) -->
      <td>${index + 1}</td>
      <!-- Worker full name -->
      <td>${worker.name}</td>
      <!-- Worker age -->
      <td>${worker.age || '-'}</td>
      <!-- Worker gender -->
      <td>${worker.gender || '-'}</td>
      <!-- Assigned supervisor name -->
      <td>${worker.supervisor_name || '-'}</td>
      <!-- Date worker was added -->
      <td>${new Date(worker.created_at).toLocaleDateString()}</td>
      <!-- Action buttons container -->
      <td>
        <!-- Remove button that deletes the worker -->
        <button class="btn btn-small btn-danger" onclick="deleteWorker(${worker.id})">Remove</button>
      </td>
    `;
    // Append the row to the table body
    tableBody.appendChild(row);
  });
}

/**
 * Load supervisors for assignment to workers
 * Makes GET request to /api/workers/supervisors?project_id=X
 * @param {number} projectId - The project ID to get supervisors for
 */
function loadSupervisors(projectId) {
  // Make API request to fetch supervisors for this project
  fetch(`/api/workers/supervisors?project_id=${projectId}`)
    // Convert response to JSON
    .then(response => response.json())
    // Handle the supervisors data
    .then(data => {
      // Store supervisors in global variable
      allSupervisors = data || [];
      // Get the supervisor select element
      const supervisorSelect = document.getElementById('workerSupervisor');
      // Clear existing options except the default one
      supervisorSelect.innerHTML = '<option value="">Select Supervisor</option>';
      // Loop through each supervisor to add as option
      allSupervisors.forEach(supervisor => {
        // Create a new option element
        const option = document.createElement('option');
        // Set the option value to the supervisor ID
        option.value = supervisor.id;
        // Set the option text to the supervisor name
        option.textContent = supervisor.name;
        // Append the option to the select element
        supervisorSelect.appendChild(option);
      });
    })
    // Catch and log any errors from the API request
    .catch(error => console.error('Error loading supervisors:', error));
}

/**
 * Open the Add Worker modal and load supervisors for selected project
 * @param {number} projectId - The project ID to add worker to
 */
function openAddWorkerModal(projectId) {
  // Store the current project ID
  currentProjectId = projectId;
  // Load supervisors for this project
  loadSupervisors(projectId);
  // Clear the form fields for fresh entry
  document.getElementById('addWorkerForm').reset();
  // Show the add worker modal by setting display to block
  document.getElementById('addWorkerModal').style.display = 'block';
}

/**
 * Handle form submission for adding a new worker
 * @param {Event} e - The form submit event
 */
function handleAddWorker(e) {
  // Prevent default form submission behavior
  e.preventDefault();
  // Get the worker name value from the form
  const name = document.getElementById('workerName').value;
  // Validate name has minimum length (at least 2 characters)
  if (!name || name.length < 2) {
    // Show error toast if name is too short
    showToast('Name must be at least 2 characters', 'error');
    // Exit function if name invalid
    return;
  }
  // Get the age value from the form
  const age = parseInt(document.getElementById('workerAge').value);
  // Validate age is within acceptable range (1-99)
  if (age < 1 || age > 99) {
    // Show error toast if age is invalid
    showToast('Age must be between 1 and 99', 'error');
    // Exit function if age invalid
    return;
  }
  // Get the gender value from the form
  const gender = document.getElementById('workerGender').value;
  // Get the supervisor ID value from the form
  const supervisor_id = document.getElementById('workerSupervisor').value;
  // Check if a supervisor was selected
  if (!supervisor_id) {
    // Show error toast if no supervisor selected
    showToast('Please select a supervisor', 'error');
    // Exit function if supervisor not selected
    return;
  }
  // Make API request to create new worker
  fetch('/api/workers', {
    // Set HTTP method to POST for creating new resource
    method: 'POST',
    // Set header for JSON content type
    headers: {
      'Content-Type': 'application/json'
    },
    // Set the request body with worker data
    body: JSON.stringify({
      // Worker name
      name,
      // Worker age
      age,
      // Worker gender
      gender,
      // Project ID for this worker
      project_id: currentProjectId,
      // Supervisor ID for this worker
      supervisor_id: parseInt(supervisor_id)
    })
  })
    // Handle the response from the API
    .then(response => {
      // Check if response status indicates success
      if (response.ok) {
        // Show success toast notification
        showToast('Worker added successfully', 'success');
        // Close the add worker modal
        document.getElementById('addWorkerModal').style.display = 'none';
        // Clear the form fields for next use
        document.getElementById('addWorkerForm').reset();
        // Reload workers table to show new worker
        loadWorkers(currentProjectId);
      } else {
        // Show error toast if request failed
        showToast('Failed to add worker', 'error');
      }
    })
    // Catch and log any errors from the API request
    .catch(error => {
      // Log error to console
      console.error('Error adding worker:', error);
      // Show error toast notification
      showToast('Error adding worker', 'error');
    });
}

/**
 * Delete a worker after confirmation
 * @param {number} workerId - The ID of the worker to delete
 */
function deleteWorker(workerId) {
  // Show confirmation dialog to user
  if (!confirm('Are you sure you want to remove this worker?')) {
    // Exit function if user cancels confirmation
    return;
  }
  // Make API request to delete the worker
  fetch(`/api/workers/${workerId}`, {
    // Set HTTP method to DELETE
    method: 'DELETE',
    // Set header for JSON content type
    headers: {
      'Content-Type': 'application/json'
    }
  })
    // Handle the response from the API
    .then(response => {
      // Check if response status is successful
      if (response.ok) {
        // Show success toast notification
        showToast('Worker removed successfully', 'success');
        // Reload the workers table to reflect changes
        loadWorkers(currentProjectId);
      } else {
        // Show error toast notification if deletion failed
        showToast('Failed to remove worker', 'error');
      }
    })
    // Catch and log any errors from the API request
    .catch(error => {
      // Log error to console
      console.error('Error deleting worker:', error);
      // Show error toast notification
      showToast('Error removing worker', 'error');
    });
}

/**
 * Setup navigation between different dashboard sections
 * Adds click handlers to nav links to show/hide sections
 */
function setupNavigation() {
  // Get all navigation links
  const navLinks = document.querySelectorAll('.nav-link');
  // Loop through each navigation link
  navLinks.forEach(link => {
    // Add click event listener to the link
    link.addEventListener('click', function(e) {
      // Prevent default link behavior
      e.preventDefault();
      // Get the section name from the data attribute
      const sectionName = this.getAttribute('data-section');
      // Get the corresponding section element
      const section = document.getElementById(sectionName);
      // Check if section exists
      if (!section) {
        // Log error if section not found
        console.error('Section not found:', sectionName);
        // Exit function if section missing
        return;
      }
      // Get all content sections
      const sections = document.querySelectorAll('.content-section');
      // Hide all content sections
      sections.forEach(s => s.classList.remove('active'));
      // Get all nav links
      const links = document.querySelectorAll('.nav-link');
      // Remove active class from all nav links
      links.forEach(l => l.classList.remove('active'));
      // Show the selected section
      section.classList.add('active');
      // Add active class to clicked nav link
      this.classList.add('active');
    });
  });
}

/**
 * Setup all event listeners for forms, buttons, and input fields
 * Called on page load to attach event handlers
 */
function setupEventListeners() {
  // Get the add worker button
  const addWorkerBtn = document.getElementById('addWorkerBtn');
  // Add click event listener to add worker button
  if (addWorkerBtn) {
    // Show the add worker modal when button clicked
    addWorkerBtn.addEventListener('click', function() {
      // Check if a project is selected
      if (!currentProjectId) {
        // Show error if no project selected
        showToast('Please select a project first', 'error');
        // Exit function if no project
        return;
      }
      // Open the add worker modal with current project ID
      openAddWorkerModal(currentProjectId);
    });
  }
  // Get the add worker form
  const addWorkerForm = document.getElementById('addWorkerForm');
  // Add submit event listener to add worker form
  if (addWorkerForm) {
    // Handle form submission
    addWorkerForm.addEventListener('submit', handleAddWorker);
  }
  // Get all modal close buttons
  const closeButtons = document.querySelectorAll('.close-btn');
  // Loop through each close button
  closeButtons.forEach(btn => {
    // Add click event listener to close button
    btn.addEventListener('click', function() {
      // Find parent modal and hide it
      const modal = this.closest('.modal');
      // Check if modal exists
      if (modal) {
        // Hide the modal
        modal.style.display = 'none';
      }
    });
  });
  // Get all modals on the page
  const modals = document.querySelectorAll('.modal');
  // Loop through each modal
  modals.forEach(modal => {
    // Add click event listener to modal element
    modal.addEventListener('click', function(e) {
      // Check if click was on modal backdrop (not content)
      if (e.target === this) {
        // Hide the modal if backdrop clicked
        this.style.display = 'none';
      }
    });
  });
}

/**
 * Logout the current user and redirect to login page
 * Makes POST request to /api/auth/logout
 */
function logoutUser() {
  // Make API request to logout
  fetch('/api/auth/logout', {
    // Set HTTP method to POST
    method: 'POST'
  })
    // Handle the response
    .then(response => {
      // Redirect to login page after logout
      window.location.href = '/login.html';
    })
    // Catch and log any errors
    .catch(error => console.error('Error logging out:', error));
}

/**
 * Display a toast notification message to the user
 * @param {string} message - The message to display
 * @param {string} type - The type of notification ('success', 'error', 'info')
 */
function showToast(message, type) {
  // Get the toast container element
  const toastContainer = document.getElementById('toastContainer');
  // Create a new div element for the toast
  const toast = document.createElement('div');
  // Add CSS class for toast styling
  toast.className = `toast toast-${type}`;
  // Set the toast message text
  toast.textContent = message;
  // Append the toast to the container
  toastContainer.appendChild(toast);
  // Remove the toast after 3 seconds (3000 milliseconds)
  setTimeout(() => {
    // Remove the toast element from DOM
    toast.remove();
  }, 3000);
}
