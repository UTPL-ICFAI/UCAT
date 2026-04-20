// Global error handler to catch any uncaught JavaScript errors
window.onerror = function(msg, url, lineNo, columnNo, error) {
  // Log error details to console for debugging
  console.error('JavaScript Error:', {
    message: msg,
    source: url,
    line: lineNo,
    column: columnNo,
    error: error
  });
  // Don't show error for network issues - let them be handled gracefully
  return false;
};

// Wait for DOM to be fully loaded before executing any JavaScript
document.addEventListener('DOMContentLoaded', function() {
  // Check if user is authenticated
  const token = localStorage.getItem('auth_token');
  if (!token) {
    // Redirect to login page if no token
    console.warn('No authentication token found - redirecting to login');
    window.location.href = '/';
    return;
  }
  // Initialize the application by calling all setup functions
  initializeApp();
});

// Global variable to store all users fetched from API
let allUsers = [];

// Global variable to store all projects fetched from API
let allProjects = [];

// Global variable to store all documents fetched from API
let allDocuments = [];

// Global variable to store all statistics fetched from API
let allStats = {};

// Global variable to track which user is being edited (for edit modal)
let editingUserId = null;

// Global variable to store the budget chart instance (Chart.js)
let budgetChart = null;

/**
 * Initialize the application - called on page load
 * Sets up all event listeners, loads data, and prepares UI
 */
function initializeApp() {
  // Load all statistics and populate KPI cards
  loadStats();
  // Initialize the budget chart for data visualization
  initBudgetChart();
  // Load all activity items and display in feed
  loadActivity();
  // Load all users into memory
  loadUsers();
  // Load all projects and display in project tabs
  loadProjects();
  // Load all documents from all projects
  loadAllDocuments();
  // Load all templates
  loadTemplates();
  // Load users for dropdown menus in project creation
  loadUsersForDropdowns();
  // Setup navigation between different sections
  setupNavigation();
  // Setup project tab switching
  setupProjectTabs();
  // Setup all event listeners for forms and buttons
  setupEventListeners();
}

/**
 * Load statistics from API and populate KPI cards
 * Makes GET request to /api/superadmin/stats
 */
function loadStats() {
  // Get the JWT token from localStorage for authentication
  const token = localStorage.getItem('auth_token');
  if (!token) {
    console.warn('No authentication token available for stats');
    return;
  }
  
  // Make API request to fetch statistics
  fetch('/api/superadmin/stats', {
    // Set request headers with Authorization token
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
    // Check if response is successful
    .then(response => {
      // If response is not OK, throw an error
      if (!response.ok) {
        // Log the error status
        console.warn('Stats API returned status:', response.status);
        // Throw error with status
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      // Convert response to JSON if successful
      return response.json();
    })
    // Handle the statistics data
    .then(data => {
      // Store stats in global variable for later use
      allStats = data;
      // Log stats to console for debugging
      console.log('Stats loaded:', data);
      
      // Safely update KPI cards with fallback to 0
      const updateKPI = (elementId, value) => {
        const element = document.getElementById(elementId);
        if (element) {
          element.textContent = value || 0;
        }
      };
      
      // Populate total projects KPI card
      updateKPI('totalProjectsValue', data.totalProjects);
      // Populate active projects KPI card
      updateKPI('activeProjectsValue', data.activeProjects);
      // Populate total users KPI card
      updateKPI('totalUsersValue', data.totalUsers);
      // Populate open issues KPI card
      updateKPI('openIssuesValue', data.openIssues);
      // Populate total workers KPI card
      updateKPI('totalWorkersValue', data.totalWorkers);
      // Populate total documents KPI card
      updateKPI('totalDocumentsValue', data.totalDocuments);
    })
    // Catch and log any errors from the API request
    .catch(error => {
      // Log error to console with full details
      console.warn('Warning: Could not load stats:', error.message);
      // Set default values if stats fail to load
      ['totalProjectsValue', 'activeProjectsValue', 'totalUsersValue', 'openIssuesValue', 'totalWorkersValue', 'totalDocumentsValue'].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.textContent = '0';
      });
    });
}

/**
 * Initialize Chart.js bar chart for budget overview
 * Creates a responsive chart with budget data
 */
function initBudgetChart() {
  // Get the canvas element for the chart
  const ctx = document.getElementById('budgetChart');
  // Check if canvas element exists
  if (!ctx) {
    // Log error if canvas not found
    console.error('Budget chart canvas not found');
    // Exit function if canvas missing
    return;
  }
  // Destroy existing chart if one exists to prevent conflicts
  if (budgetChart) {
    // Destroy the previous chart instance
    budgetChart.destroy();
  }
  
  // Prepare chart data from allProjects
  const labels = [];
  const allocatedData = [];
  const spentData = [];
  
  // Get up to 5 projects for the chart
  const projectsToShow = allProjects.slice(0, 5);
  
  // If no projects, show placeholder
  if (projectsToShow.length === 0) {
    // Use placeholder data
    projectsToShow.push(
      { name: 'No Projects', total_budget: 0, budget_allocated: 0 }
    );
  }
  
  // Loop through projects and extract budget data
  projectsToShow.forEach(project => {
    // Add project name to labels
    labels.push(project.name || 'Unknown Project');
    // Add allocated budget (or 0 if undefined)
    allocatedData.push(parseFloat(project.budget_allocated) || 0);
    // Add total budget as spent (or allocated if spent not available)
    spentData.push(parseFloat(project.total_budget) || 0);
  });
  
  // Create new Chart.js instance with bar chart type
  budgetChart = new Chart(ctx, {
    // Set chart type to bar chart
    type: 'bar',
    // Define data for the chart
    data: {
      // Array of labels for each bar (project names)
      labels: labels,
      // Array of datasets for the chart
      datasets: [
        // First dataset for allocated budget
        {
          // Label for allocated budget bars
          label: 'Budget Allocated',
          // Array of values for allocated budget
          data: allocatedData,
          // Background color for allocated budget bars
          backgroundColor: 'rgba(54, 162, 235, 0.7)',
          // Border color for allocated budget bars
          borderColor: 'rgba(54, 162, 235, 1)',
          // Border width for allocated budget bars
          borderWidth: 2
        },
        // Second dataset for total budget
        {
          // Label for total budget bars
          label: 'Total Budget',
          // Array of values for total budget
          data: spentData,
          // Background color for total budget bars
          backgroundColor: 'rgba(75, 192, 75, 0.7)',
          // Border color for total budget bars
          borderColor: 'rgba(75, 192, 75, 1)',
          // Border width for total budget bars
          borderWidth: 2
        }
      ]
    },
    // Options for chart behavior and appearance
    options: {
      // Enable responsive behavior for different screen sizes
      responsive: true,
      // Maintain aspect ratio of the chart
      maintainAspectRatio: false,
      // Configure the scales (axes) of the chart
      scales: {
        // Configure the Y axis (vertical axis)
        y: {
          // Set the minimum value on Y axis
          beginAtZero: true,
          // Format Y axis labels as currency
          ticks: {
            callback: function(value) {
              return '₹' + value.toLocaleString();
            }
          }
        }
      },
      // Configure tooltips
      plugins: {
        // Configure the legend
        legend: {
          // Display the legend
          display: true,
          // Position legend at bottom
          position: 'bottom'
        },
        // Configure tooltips on hover
        tooltip: {
          // Format tooltip labels
          callbacks: {
            label: function(context) {
              return context.dataset.label + ': ₹' + context.parsed.y.toLocaleString();
            }
          }
        }
      }
    }
  });
}

/**
 * Load recent activity from API and display in activity feed
 * Makes GET request to /api/superadmin/activity
 */
function loadActivity() {
  // Get the JWT token from localStorage for authentication
  const token = localStorage.getItem('auth_token');
  // Make API request to fetch recent activity
  fetch('/api/superadmin/activity', {
    // Set request headers with Authorization token
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
    // Check if response is successful
    .then(response => {
      // If response is not OK, throw an error
      if (!response.ok) {
        // Log the error status
        console.error('Response status:', response.status);
        // Throw error with status
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      // Convert response to JSON if successful
      return response.json();
    })
    // Handle the activity data
    .then(data => {
      // Get the activity feed container element
      const activityFeed = document.getElementById('activityFeed');
      // Clear any existing activity items
      activityFeed.innerHTML = '';
      // Log activity to console for debugging
      console.log('Activity loaded:', data);
      // Check if activity data is available
      if (data && data.length > 0) {
        // Loop through each activity item
        data.forEach(activity => {
          // Create a div element for each activity item
          const activityItem = document.createElement('div');
          // Add CSS class for styling activity items
          activityItem.className = 'activity-item';
          // Set the HTML content of the activity item
          activityItem.innerHTML = `
            <span class="activity-type">${activity.type || 'Update'}</span>
            <span class="activity-name">${activity.description || 'Unknown'}</span>
            <span class="activity-time">${new Date(activity.created_at).toLocaleDateString()}</span>
          `;
          // Append the activity item to the feed container
          activityFeed.appendChild(activityItem);
        });
      } else {
        // Display message if no activity items found
        activityFeed.innerHTML = '<p>No recent activity</p>';
      }
    })
    // Catch and log any errors from the API request
    .catch(error => {
      // Log error to console with full details
      console.error('Error loading activity:', error);
      // Display error message to user
      showToast('Failed to load activity: ' + error.message, 'error');
    });
}

/**
 * Load all users from API and store in global variable
 * Makes GET request to /api/superadmin/users
 */
function loadUsers() {
  // Get the JWT token from localStorage for authentication
  const token = localStorage.getItem('auth_token');
  // Make API request to fetch all users
  fetch('/api/superadmin/users', {
    // Set request headers with Authorization token
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
    // Check if response is successful
    .then(response => {
      // If response is not OK, throw an error
      if (!response.ok) {
        // Log the error status
        console.error('Response status:', response.status);
        // Throw error with status
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      // Convert response to JSON if successful
      return response.json();
    })
    // Handle the users data
    .then(data => {
      // Store all users in global variable
      allUsers = data || [];
      // Log the users to console for debugging
      console.log('Users loaded:', allUsers);
      // Display the users in the users table
      displayUsersTable(allUsers);
    })
    // Catch and log any errors from the API request
    .catch(error => {
      // Log error to console with full details
      console.error('Error loading users:', error);
      // Display error message to user
      showToast('Failed to load users: ' + error.message, 'error');
    });
}

/**
 * Display users in the users table with Edit and Delete buttons
 * @param {Array} users - Array of user objects to display
 */
function displayUsersTable(users) {
  // Get the table body element where user rows will be added
  const tableBody = document.getElementById('usersTable');
  // Clear any existing rows in the table
  tableBody.innerHTML = '';
  // Check if there are users to display
  if (!users || users.length === 0) {
    // Create a message row if no users exist
    tableBody.innerHTML = '<tr><td colspan="8" style="text-align: center;">No users found</td></tr>';
    // Exit function early if no users
    return;
  }
  // Loop through each user to create table rows
  users.forEach(user => {
    // Create a new table row element
    const row = document.createElement('tr');
    // Set the HTML content of the row with user data
    row.innerHTML = `
      <td>${user.name}</td>
      <td>${user.age || '-'}</td>
      <td>${user.gender || '-'}</td>
      <td>${user.employment_id}</td>
      <td>${user.role}</td>
      <td>${user.user_id}</td>
      <td>${new Date(user.created_at).toLocaleDateString()}</td>
      <td>
        <button class="btn btn-small" onclick="openEditUserModal(${user.id}, '${user.name}', ${user.age}, '${user.gender}', '${user.employment_id}', '${user.role}', '${user.user_id}')">Edit</button>
        <button class="btn btn-small btn-danger" onclick="deleteUser(${user.id})">Delete</button>
      </td>
    `;
    // Append the row to the table body
    tableBody.appendChild(row);
  });
}

/**
 * Open the Edit User modal and pre-fill it with user data
 * @param {number} userId - The ID of the user being edited
 * @param {string} name - The name of the user
 * @param {number} age - The age of the user
 * @param {string} gender - The gender of the user
 * @param {string} employmentId - The employment ID of the user
 * @param {string} role - The role of the user
 * @param {string} userIdStr - The user ID string
 */
function openEditUserModal(userId, name, age, gender, employmentId, role, userIdStr) {
  // Set the hidden user ID field
  document.getElementById('editUserId').value = userId;
  // Set the name field
  document.getElementById('editUserName').value = name;
  // Set the age field
  document.getElementById('editUserAge').value = age;
  // Set the gender select
  document.getElementById('editUserGender').value = gender || '';
  // Set the employment ID field
  document.getElementById('editUserEmploymentId').value = employmentId;
  // Set the role select
  document.getElementById('editUserRole').value = role;
  // Set the readonly user ID field
  document.getElementById('editUserIdField').value = userIdStr;
  // Clear the password field (leave blank on edit)
  document.getElementById('editUserPassword').value = '';
  // Show the edit user modal
  document.getElementById('editUserModal').style.display = 'flex';
}

/**
 * Filter users based on search input and role filter
 * Gets values from search input and role select, filters allUsers array
 */
function filterUsers() {
  // Get the search input value and convert to lowercase
  const searchValue = document.getElementById('userSearch').value.toLowerCase();
  // Get the role filter select value
  const roleValue = document.getElementById('roleFilter').value;
  // Filter users based on search and role criteria
  const filteredUsers = allUsers.filter(user => {
    // Check if user name includes search term (case-insensitive)
    const matchesSearch = user.name.toLowerCase().includes(searchValue) || 
                          user.user_id.toLowerCase().includes(searchValue);
    // Check if user role matches filter (or all roles if filter is empty)
    const matchesRole = !roleValue || user.role === roleValue;
    // Return true if both conditions are met
    return matchesSearch && matchesRole;
  });
  // Display the filtered users in the table
  displayUsersTable(filteredUsers);
}

/**
 * Open the Edit User modal and pre-fill it with user data
 * @param {number} userId - The ID of the user being edited
 * @param {string} name - The name of the user
 * @param {number} age - The age of the user
 * @param {string} gender - The gender of the user
 * @param {string} employmentId - The employment ID of the user
 * @param {string} role - The role of the user
 * @param {string} userIdStr - The user ID string
 */
/**
 * Delete a user after confirmation
 * @param {number} userId - The ID of the user to delete
 */
function deleteUser(userId) {
  // Show confirmation dialog to user
  if (!confirm('Are you sure you want to delete this user?')) {
    // Exit function if user cancels confirmation
    return;
  }
  // Get the JWT token from localStorage for authentication
  const token = localStorage.getItem('auth_token');
  // Make API request to delete the user
  fetch(`/api/superadmin/users/${userId}`, {
    // Set HTTP method to DELETE
    method: 'DELETE',
    // Set header for JSON content type
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  })
    // Handle the response from the API
    .then(response => {
      // Check if response status is successful
      if (response.ok) {
        // Show success toast notification
        showToast('User deleted successfully', 'success');
        // Reload the users table to reflect changes
        loadUsers();
      } else {
        // Show error toast notification if deletion failed
        showToast('Failed to delete user', 'error');
      }
    })
    // Catch and log any errors from the API request
    .catch(error => {
      // Log error to console
      console.error('Error deleting user:', error);
      // Show error toast notification
      showToast('Error deleting user', 'error');
    });
}

/**
 * Load the permissions matrix from API and display in permissions section
 * Makes GET request to /api/superadmin/permissions/all
 */
function loadPermissionsTable() {
  // Get the JWT token from localStorage for authentication
  const token = localStorage.getItem('auth_token');
  // Make API request to fetch all permissions
  fetch('/api/superadmin/permissions/all', {
    // Set request headers with Authorization token
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
    // Check if response is successful
    .then(response => {
      // If response is not OK, throw an error
      if (!response.ok) {
        // Log the error status
        console.error('Response status:', response.status);
        // Throw error with status
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      // Convert response to JSON if successful
      return response.json();
    })
    // Handle the permissions data
    .then(data => {
      // Get the permissions section container
      const permissionsSection = document.getElementById('permissionsSection');
      // Clear any existing content
      permissionsSection.innerHTML = '';
      // Log permissions to console for debugging
      console.log('Permissions loaded:', data);
      // Check if permissions data exists
      if (data && data.length > 0) {
        // Create a table for the permissions matrix
        const table = document.createElement('table');
        // Add CSS class for table styling
        table.className = 'permissions-table';
        // Create and append the table header
        const thead = document.createElement('thead');
        // Create header row
        const headerRow = document.createElement('tr');
        // Create header cell for user name column
        headerRow.innerHTML = `
          <th>User</th>
          <th>View</th>
          <th>Edit</th>
          <th>Delete</th>
          <th>Manage Users</th>
          <th>Manage Projects</th>
        `;
        // Append header row to table head
        thead.appendChild(headerRow);
        // Append table head to table
        table.appendChild(thead);
        // Create and append the table body
        const tbody = document.createElement('tbody');
        // Loop through each permission row
        data.forEach(perm => {
          // Create a new table row
          const row = document.createElement('tr');
          // Set the HTML content with permission data
          row.innerHTML = `
            <td>${perm.user_name}</td>
            <td><input type="checkbox" ${perm.can_view ? 'checked' : ''} disabled /></td>
            <td><input type="checkbox" ${perm.can_edit ? 'checked' : ''} disabled /></td>
            <td><input type="checkbox" ${perm.can_delete ? 'checked' : ''} disabled /></td>
            <td><input type="checkbox" ${perm.can_manage_users ? 'checked' : ''} disabled /></td>
            <td><input type="checkbox" ${perm.can_manage_projects ? 'checked' : ''} disabled /></td>
          `;
          // Append the row to the table body
          tbody.appendChild(row);
        });
        // Append table body to table
        table.appendChild(tbody);
        // Append the table to the permissions section
        permissionsSection.appendChild(table);
      } else {
        // Display message if no permissions found
        permissionsSection.innerHTML = '<p>No permissions data available</p>';
      }
    })
    // Catch and log any errors from the API request
    .catch(error => {
      // Log error to console with full details
      console.error('Error loading permissions:', error);
      // Display error message to user
      showToast('Failed to load permissions: ' + error.message, 'error');
    });
}

/**
 * Handle form submission for adding a new user
 * @param {Event} e - The form submit event
 */
function handleAddUser(e) {
  // Prevent default form submission behavior
  e.preventDefault();
  
  // Get all form values
  const name = document.getElementById('addUserName').value.trim();
  const age = parseInt(document.getElementById('addUserAge').value);
  const gender = document.getElementById('addUserGender').value;
  const employment_id = document.getElementById('addUserEmploymentId').value.trim();
  const role = document.getElementById('addUserRole').value;
  const user_id = document.getElementById('addUserId').value.trim();
  const password = document.getElementById('addUserPassword').value;
  
  // Validate all required fields
  if (!name) {
    showToast('Please enter a full name', 'error');
    return;
  }
  
  if (!age || age < 18 || age > 99) {
    showToast('Age must be between 18 and 99', 'error');
    return;
  }
  
  if (!gender) {
    showToast('Please select a gender', 'error');
    return;
  }
  
  if (!employment_id) {
    showToast('Please enter an employment ID', 'error');
    return;
  }
  
  if (!role) {
    showToast('Please select a role', 'error');
    return;
  }
  
  if (!user_id) {
    showToast('Please enter a user ID', 'error');
    return;
  }
  
  if (!password || password.length < 6) {
    showToast('Password must be at least 6 characters', 'error');
    return;
  }
  
  // Get the JWT token from localStorage for authentication
  const token = localStorage.getItem('auth_token');
  if (!token) {
    showToast('Session expired. Please login again.', 'error');
    return;
  }
  
  // Make API request to create new user
  fetch('/api/superadmin/users', {
    // Set HTTP method to POST for creating new resource
    method: 'POST',
    // Set header for JSON content type
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    // Set the request body with user data
    body: JSON.stringify({
      name,
      age,
      gender,
      employment_id,
      role,
      user_id,
      password
    })
  })
    // Handle the response from the API
    .then(response => {
      // Parse response as JSON
      return response.json().then(data => {
        return { ok: response.ok, status: response.status, data };
      });
    })
    // Handle the response data
    .then(({ok, status, data}) => {
      // Check if response status indicates success
      if (ok) {
        // Show success toast notification
        showToast(`User "${name}" created successfully! They can now login.`, 'success');
        // Close the add user modal
        document.getElementById('addUserModal').style.display = 'none';
        // Clear the form fields for next use
        document.getElementById('addUserForm').reset();
        // Reload users to reflect new user
        loadUsers();
      } else {
        // Show error with details from API
        const errorMsg = data.error || 'Failed to create user';
        showToast(errorMsg, 'error');
        console.error('API Error:', status, data);
      }
    })
    // Catch and log any errors from the API request
    .catch(error => {
      // Log error to console
      console.error('Error creating user:', error);
      // Show error toast notification
      showToast('Network error while creating user. Please try again.', 'error');
    });
}

/**
 * Handle form submission for editing an existing user
 * @param {Event} e - The form submit event
 */
function handleEditUser(e) {
  // Prevent default form submission behavior
  e.preventDefault();
  // Get the user ID being edited from hidden field
  const userId = document.getElementById('editUserId').value;
  // Get the name value from the form
  const name = document.getElementById('editUserName').value;
  // Get the age value from the form
  const age = parseInt(document.getElementById('editUserAge').value);
  // Validate age is within acceptable range (1-99)
  if (age < 1 || age > 99) {
    // Show error toast if age is invalid
    showToast('Age must be between 1 and 99', 'error');
    // Exit function if age invalid
    return;
  }
  // Get the gender value from the form
  const gender = document.getElementById('editUserGender').value;
  // Get the employment ID value from the form
  const employment_id = document.getElementById('editUserEmploymentId').value;
  // Get the role value from the form
  const role = document.getElementById('editUserRole').value;
  // Get the password value from the form (optional field)
  const password = document.getElementById('editUserPassword').value;
  // Create request body object with updated user data
  const requestBody = {
    // User name
    name,
    // User age
    age,
    // User gender
    gender,
    // User employment ID
    employment_id,
    // User role
    role
  };
  // Check if password field has a value (only include if provided)
  if (password) {
    // Add password to request body if user entered one
    requestBody.password = password;
  }
  // Get the JWT token from localStorage for authentication
  const token = localStorage.getItem('auth_token');
  // Make API request to update user
  fetch(`/api/superadmin/users/${userId}`, {
    // Set HTTP method to PUT for updating resource
    method: 'PUT',
    // Set header for JSON content type
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    // Set the request body with updated user data
    body: JSON.stringify(requestBody)
  })
    // Handle the response from the API
    .then(response => {
      // Check if response status indicates success
      if (response.ok) {
        // Show success toast notification
        showToast('User updated successfully', 'success');
        // Close the edit user modal
        document.getElementById('editUserModal').style.display = 'none';
        // Clear the form fields
        document.getElementById('editUserForm').reset();
        // Reload users to reflect changes
        loadUsers();
      } else {
        // Show error toast if request failed
        showToast('Failed to update user', 'error');
      }
    })
    // Catch and log any errors from the API request
    .catch(error => {
      // Log error to console
      console.error('Error updating user:', error);
      // Show error toast notification
      showToast('Error updating user', 'error');
    });
}

/**
 * Handle form submission for creating a new project
 * @param {Event} e - The form submit event
 */
function handleCreateProject(e) {
  // Prevent default form submission behavior
  e.preventDefault();
  // Get the project name value from the form
  const projectName = document.getElementById('projectName').value;
  // Get the project location value from the form
  const projectLocation = document.getElementById('projectLocation').value;
  // Get the project city value from the form
  const projectCity = document.getElementById('projectCity').value;
  // Get the project description value from the form
  const projectDescription = document.getElementById('projectDescription').value;
  // Get the project start date from the form
  const projectStartDate = document.getElementById('projectStartDate').value;
  // Get the project end date from the form
  const projectEndDate = document.getElementById('projectEndDate').value;
  // Get the total budget from the form
  const projectTotalBudget = document.getElementById('projectTotalBudget').value;
  // Get the allocated budget from the form
  const projectAllocatedBudget = document.getElementById('projectAllocatedBudget').value;
  // Get the contractor name from the form
  const contractorName = document.getElementById('contractorName').value;
  // Get the contractor contact number from the form
  const contractorContact = document.getElementById('contractorContact').value;
  // Get the contractor license number from the form
  const contractorLicense = document.getElementById('contractorLicense').value;
  // Get the contractor insurance number from the form
  const contractorInsurance = document.getElementById('contractorInsurance').value;
  // Get the insurance details from the form
  const insuranceDetails = document.getElementById('insuranceDetails').value;
  // Get the safety certifications from the form
  const safetyCertifications = document.getElementById('safetyCertifications').value;
  // Get the project manager ID value from the form
  const projectManager = document.getElementById('projectManagerSelect').value;
  // Get the site engineer ID value from the form
  const siteEngineer = document.getElementById('siteEngineerSelect').value;
  // Get the supervisor ID value from the form (optional)
  const supervisor = document.getElementById('supervisorSelect').value;
  // Get template assignment details
  const templateId = document.getElementById('templateSelect').value;
  const repetitionType = document.getElementById('repetitionType').value;
  const repetitionDays = document.getElementById('repetitionDays').value;
  // Get the JWT token from localStorage for authentication
  const token = localStorage.getItem('auth_token');
  // Make API request to create new project with all construction fields
  fetch('/api/projects', {
    // Set HTTP method to POST for creating new resource
    method: 'POST',
    // Set header for JSON content type
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    // Set the request body with comprehensive project data
    body: JSON.stringify({
      // Project name (required)
      name: projectName,
      // Project location (required)
      location: projectLocation,
      // Project city (required)
      city: projectCity,
      // Project description
      description: projectDescription,
      // Project work status
      work_status: 'ongoing',
      // Project start date
      start_date: projectStartDate,
      // Project end date
      end_date: projectEndDate,
      // Contractor name
      contractor_name: contractorName,
      // Contractor contact number
      contractor_contact: contractorContact,
      // Contractor license number
      contractor_license: contractorLicense,
      // Contractor insurance number
      contractor_insurance_number: contractorInsurance,
      // Contractor details object
      contractor_details: {
        name: contractorName,
        contact: contractorContact,
        license: contractorLicense,
        insurance: contractorInsurance
      },
      // Total budget amount
      total_budget: projectTotalBudget,
      // Allocated budget amount
      budget_allocated: projectAllocatedBudget,
      // Insurance details object
      insurance_details: {
        details: insuranceDetails
      },
      // Safety certifications object
      safety_certifications: {
        certifications: safetyCertifications
      },
      // Project manager ID
      projectManagers: [projectManager],
      // Site engineer ID
      siteEngineers: [siteEngineer],
      // Supervisor ID (optional)
      supervisors: supervisor ? [supervisor] : [],
      // Template assignment details
      template_id: templateId ? parseInt(templateId) : null,
      repetition_type: repetitionType || null,
      repetition_days: repetitionDays ? repetitionDays.split(',').map(d => parseInt(d.trim())).filter(d => !isNaN(d)) : []
    })
  })
    // Handle the response from the API
    .then(response => {
      // Check if response status indicates success
      if (response.ok) {
        return response.json().then(data => {
          // Show success toast notification
          showToast('Project created successfully', 'success');
          // Clear the form fields
          document.getElementById('createProjectForm').reset();
          // Hide template repetition days input
          document.getElementById('repetitionDaysGroup').style.display = 'none';
          // Reload projects to display the new project immediately
          loadProjects();
          
          // If template was assigned, set it up for the project
          if (templateId && data && data.id) {
            assignTemplateToProject(data.id, templateId, repetitionType, repetitionDays);
          }
        });
      } else {
        return response.json().then(data => {
          // Show error toast if request failed
          showToast(data.message || 'Failed to create project', 'error');
        });
      }
    })
    // Catch and log any errors from the API request
    .catch(error => {
      // Log error to console
      console.error('Error creating project:', error);
      // Show error notification
      showToast('Error creating project', 'error');
    });
}

/**
 * Load templates into the project creation form dropdown
 * Fetches all templates created by superadmin
 */
function loadTemplatesForDropdown() {
  const token = localStorage.getItem('auth_token');
  const templateSelect = document.getElementById('templateSelect');
  
  if (!templateSelect) {
    console.warn('Template select dropdown not found');
    return;
  }
  
  fetch('/api/templates', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
    .then(response => {
      if (!response.ok) throw new Error('Failed to load templates');
      return response.json();
    })
    .then(data => {
      // Handle both response formats
      const templates = (data.success && data.templates) ? data.templates : (Array.isArray(data) ? data : []);
      
      // Clear existing options
      templateSelect.innerHTML = '<option value="">Choose a template...</option>';
      
      // Add all templates as options
      templates.forEach(template => {
        const option = document.createElement('option');
        option.value = template.id;
        option.textContent = template.name + (template.is_default ? ' (Default)' : '');
        templateSelect.appendChild(option);
      });
      
      console.log('Templates loaded in dropdown:', templates.length);
    })
    .catch(error => {
      console.error('Error loading templates for dropdown:', error);
      templateSelect.innerHTML = '<option value="">Error loading templates</option>';
    });
}

/**
 * Assign a template to a project with repetition schedule
 * This creates the link between project and template
 */
function assignTemplateToProject(projectId, templateId, repetitionType, repetitionDays) {
  const token = localStorage.getItem('auth_token');
  
  // Parse repetition days if needed
  let repetitionDaysArray = [];
  if (repetitionDays) {
    if (typeof repetitionDays === 'string') {
      repetitionDaysArray = repetitionDays.split(',').map(d => parseInt(d.trim())).filter(d => !isNaN(d));
    } else if (Array.isArray(repetitionDays)) {
      repetitionDaysArray = repetitionDays;
    }
  }
  
  fetch('/api/project-templates', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      project_id: projectId,
      template_id: parseInt(templateId),
      repetition_type: repetitionType,
      repetition_days: repetitionDaysArray
    })
  })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        showToast('Template assigned to project successfully', 'success');
      }
    })
    .catch(error => {
      console.error('Error assigning template to project:', error);
    });
}

/**
 * Load users for populating dropdown menus in project creation form
 * Makes GET request to /api/superadmin/users and filters by role
 */
function loadUsersForDropdowns() {
  // Get the JWT token from localStorage for authentication
  const token = localStorage.getItem('auth_token');
  // Make API request to fetch all users
  fetch('/api/superadmin/users', {
    // Set request headers with Authorization token
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
    // Convert response to JSON
    .then(response => response.json())
    // Handle the users data
    .then(users => {
      // Filter users with project manager role
      const projectManagers = users.filter(u => u.role === 'project_manager');
      // Filter users with site engineer role
      const siteEngineers = users.filter(u => u.role === 'site_engineer');
      // Filter users with supervisor role
      const supervisors = users.filter(u => u.role === 'supervisor');
      // Get the project manager select element
      const pmSelect = document.getElementById('projectManagerSelect');
      // Clear existing options except the default one
      pmSelect.innerHTML = '<option value="">Select Project Manager</option>';
      // Loop through project managers and add as options
      projectManagers.forEach(pm => {
        // Create a new option element
        const option = document.createElement('option');
        // Set the option value to the user ID
        option.value = pm.id;
        // Set the option text to the user name
        option.textContent = pm.name;
        // Append the option to the select element
        pmSelect.appendChild(option);
      });
      // Get the site engineer select element
      const seSelect = document.getElementById('siteEngineerSelect');
      // Clear existing options except the default one
      seSelect.innerHTML = '<option value="">Select Site Engineer</option>';
      // Loop through site engineers and add as options
      siteEngineers.forEach(se => {
        // Create a new option element
        const option = document.createElement('option');
        // Set the option value to the user ID
        option.value = se.id;
        // Set the option text to the user name
        option.textContent = se.name;
        // Append the option to the select element
        seSelect.appendChild(option);
      });
      // Get the supervisor select element
      const supSelect = document.getElementById('supervisorSelect');
      // Clear existing options except the default one
      supSelect.innerHTML = '<option value="">Select Supervisor</option>';
      // Loop through supervisors and add as options
      supervisors.forEach(sup => {
        // Create a new option element
        const option = document.createElement('option');
        // Set the option value to the user ID
        option.value = sup.id;
        // Set the option text to the user name
        option.textContent = sup.name;
        // Append the option to the select element
        supSelect.appendChild(option);
      });
    })
    // Catch and log any errors from the API request
    .catch(error => console.error('Error loading users for dropdowns:', error));
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
      // Hide all content sections by setting display to none
      sections.forEach(s => {
        // Hide section with display none
        s.style.display = 'none';
        // Remove active class from section
        s.classList.remove('active');
      });
      // Get all nav links
      const links = document.querySelectorAll('.nav-link');
      // Remove active class from all nav links
      links.forEach(l => l.classList.remove('active'));
      // Show the selected section by setting display to block
      section.style.display = 'block';
      // Add active class to section for styling
      section.classList.add('active');
      // Add active class to clicked nav link
      this.classList.add('active');
      // Load data when specific sections are clicked
      if (sectionName === 'manageUsers') {
        // Load users when manage users section is clicked
        loadUsers();
      } else if (sectionName === 'permissions') {
        // Load the permissions data
        loadPermissionsTable();
      } else if (sectionName === 'projectsSection') {
        // Load projects when projects section is clicked
        loadProjects();
      } else if (sectionName === 'documentsSection') {
        // Load documents when documents section is clicked
        loadAllDocuments();
      }
    });
  });
}

/**
 * Setup all event listeners for forms, buttons, and input fields
 * Called on page load to attach event handlers
 */
function setupEventListeners() {
  // Get the add user button
  const addUserBtn = document.getElementById('addUserBtn');
  // Add click event listener to add user button
  if (addUserBtn) {
    // Show the add user modal when button clicked
    addUserBtn.addEventListener('click', function() {
      // Display the add user modal with flexbox
      document.getElementById('addUserModal').style.display = 'flex';
    });
  }
  // Get the add user form
  const addUserForm = document.getElementById('addUserForm');
  // Add submit event listener to add user form
  if (addUserForm) {
    // Handle form submission
    addUserForm.addEventListener('submit', handleAddUser);
  }
  // Get the edit user form
  const editUserForm = document.getElementById('editUserForm');
  // Add submit event listener to edit user form
  if (editUserForm) {
    // Handle form submission
    editUserForm.addEventListener('submit', handleEditUser);
  }
  // Get the create project form
  const createProjectForm = document.getElementById('createProjectForm');
  // Add submit event listener to create project form
  if (createProjectForm) {
    // Handle form submission
    createProjectForm.addEventListener('submit', handleCreateProject);
  }
  
  // Set up template selection dropdown
  const templateSelect = document.getElementById('templateSelect');
  if (templateSelect) {
    // Load templates when page loads
    loadTemplatesForDropdown();
  }
  
  // Set up repetition type dropdown visibility
  const repetitionType = document.getElementById('repetitionType');
  if (repetitionType) {
    // Show/hide repetition days input based on selection
    repetitionType.addEventListener('change', function() {
      const repetitionDaysGroup = document.getElementById('repetitionDaysGroup');
      if (this.value === 'weekly' || this.value === 'monthly') {
        repetitionDaysGroup.style.display = 'block';
      } else {
        repetitionDaysGroup.style.display = 'none';
      }
    });
  }
  
  // Get the user search input
  const userSearch = document.getElementById('userSearch');
  // Add input event listener to user search
  if (userSearch) {
    // Filter users on each keystroke
    userSearch.addEventListener('input', filterUsers);
  }
  // Get the role filter select
  const roleFilter = document.getElementById('roleFilter');
  // Add change event listener to role filter
  if (roleFilter) {
    // Filter users when role selection changes
    roleFilter.addEventListener('change', filterUsers);
  }
  // Get the document project filter select
  const documentProjectFilter = document.getElementById('documentProjectFilter');
  // Add change event listener to document project filter
  if (documentProjectFilter) {
    // Filter documents when project selection changes
    documentProjectFilter.addEventListener('change', filterDocuments);
  }
  // Get the document type filter select
  const documentTypeFilter = document.getElementById('documentTypeFilter');
  // Add change event listener to document type filter
  if (documentTypeFilter) {
    // Filter documents when document type selection changes
    documentTypeFilter.addEventListener('change', filterDocuments);
  }
  // Get all modal close buttons
  const closeButtons = document.querySelectorAll('.close-btn, .close-button');
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
 * Load and display projects by status (ongoing, past, completed)
 * Gets all projects and filters by work_status
 */
function loadProjects() {
  // Get the JWT token from localStorage for authentication
  const token = localStorage.getItem('auth_token');
  // Make API request to fetch all projects
  fetch('/api/projects', {
    // Set request headers with Authorization token
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
    // Check if response is successful
    .then(response => {
      // If response is not OK, throw an error
      if (!response.ok) {
        // Log the error status
        console.error('Response status:', response.status);
        // Throw error with status
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      // Convert response to JSON if successful
      return response.json();
    })
    // Handle the projects data
    .then(data => {
      // Store all projects in global variable
      allProjects = data || [];
      // Log projects to console for debugging
      console.log('Projects loaded:', allProjects);
      // Reinitialize budget chart with new project data
      initBudgetChart();
      // Display ongoing projects
      displayOngoingProjects();
      // Display past projects
      displayPastProjects();
    })
    // Catch and log any errors from the API request
    .catch(error => {
      // Log error to console with full details
      console.error('Error loading projects:', error);
      // Display error message to user
      showToast('Failed to load projects: ' + error.message, 'error');
    });
}

/**
 * Display ongoing/active projects in the Ongoing Projects tab
 * Filters allProjects array for work_status = 'ongoing' or 'active'
 */
function displayOngoingProjects() {
  // Filter projects with ongoing or active status
  const ongoingProjects = allProjects.filter(p => p.work_status === 'ongoing' || p.work_status === 'active');
  // Get the ongoing projects list container
  const container = document.getElementById('ongoingProjectsList');
  // Clear any existing content
  container.innerHTML = '';
  // Check if there are ongoing projects
  if (!ongoingProjects || ongoingProjects.length === 0) {
    // Display message if no ongoing projects
    container.innerHTML = '<p style="text-align: center; color: #999; padding: 2rem;">No ongoing projects at this time</p>';
    // Exit function early
    return;
  }
  // Loop through each ongoing project
  ongoingProjects.forEach(project => {
    // Create project card HTML for each project
    const projectCard = document.createElement('div');
    // Add CSS class for project card styling
    projectCard.className = 'project-card';
    // Set the HTML content of the project card
    projectCard.innerHTML = `
      <div class="project-card-header">
        <!-- Project name as card title -->
        <h3 class="project-card-title">${project.name}</h3>
        <!-- Ongoing status badge -->
        <span class="project-status-badge status-ongoing">Ongoing</span>
      </div>
      <div class="project-card-body">
        <!-- Location detail -->
        <div class="project-detail">
          <span class="project-detail-label">Location:</span>
          <span class="project-detail-value">${project.location || '-'}</span>
        </div>
        <!-- City detail -->
        <div class="project-detail">
          <span class="project-detail-label">City:</span>
          <span class="project-detail-value">${project.city || '-'}</span>
        </div>
        <!-- Start date detail -->
        <div class="project-detail">
          <span class="project-detail-label">Start Date:</span>
          <span class="project-detail-value">${project.start_date ? new Date(project.start_date).toLocaleDateString() : '-'}</span>
        </div>
        <!-- End date detail -->
        <div class="project-detail">
          <span class="project-detail-label">End Date:</span>
          <span class="project-detail-value">${project.end_date ? new Date(project.end_date).toLocaleDateString() : '-'}</span>
        </div>
        <!-- Total budget detail -->
        <div class="project-detail">
          <span class="project-detail-label">Budget:</span>
          <span class="project-detail-value">₹${project.total_budget ? parseFloat(project.total_budget).toLocaleString() : '0'}</span>
        </div>
        <!-- Contractor name detail -->
        <div class="project-detail">
          <span class="project-detail-label">Contractor:</span>
          <span class="project-detail-value">${project.contractor_name || '-'}</span>
        </div>
      </div>
      <div class="project-card-footer">
        <!-- View details button -->
        <button class="btn-view-details" onclick="viewProjectDetails(${project.id})">View Details</button>
      </div>
    `;
    // Append the project card to the container
    container.appendChild(projectCard);
  });
}

/**
 * Display past/completed projects in the Past Projects tab
 * Filters allProjects array for work_status = 'past' or 'completed'
 */
function displayPastProjects() {
  // Filter projects with past or completed status
  const pastProjects = allProjects.filter(p => p.work_status === 'past' || p.work_status === 'completed');
  // Get the past projects list container
  const container = document.getElementById('pastProjectsList');
  // Clear any existing content
  container.innerHTML = '';
  // Check if there are past projects
  if (!pastProjects || pastProjects.length === 0) {
    // Display message if no past projects
    container.innerHTML = '<p style="text-align: center; color: #999; padding: 2rem;">No past projects</p>';
    // Exit function early
    return;
  }
  // Loop through each past project
  pastProjects.forEach(project => {
    // Create project card HTML for each project
    const projectCard = document.createElement('div');
    // Add CSS class for project card styling
    projectCard.className = 'project-card';
    // Set the HTML content of the project card
    projectCard.innerHTML = `
      <div class="project-card-header">
        <!-- Project name as card title -->
        <h3 class="project-card-title">${project.name}</h3>
        <!-- Completed status badge -->
        <span class="project-status-badge status-completed">Completed</span>
      </div>
      <div class="project-card-body">
        <!-- Location detail -->
        <div class="project-detail">
          <span class="project-detail-label">Location:</span>
          <span class="project-detail-value">${project.location || '-'}</span>
        </div>
        <!-- City detail -->
        <div class="project-detail">
          <span class="project-detail-label">City:</span>
          <span class="project-detail-value">${project.city || '-'}</span>
        </div>
        <!-- Start date detail -->
        <div class="project-detail">
          <span class="project-detail-label">Start Date:</span>
          <span class="project-detail-value">${project.start_date ? new Date(project.start_date).toLocaleDateString() : '-'}</span>
        </div>
        <!-- End date detail -->
        <div class="project-detail">
          <span class="project-detail-label">End Date:</span>
          <span class="project-detail-value">${project.end_date ? new Date(project.end_date).toLocaleDateString() : '-'}</span>
        </div>
        <!-- Total budget detail -->
        <div class="project-detail">
          <span class="project-detail-label">Budget:</span>
          <span class="project-detail-value">₹${project.total_budget ? parseFloat(project.total_budget).toLocaleString() : '0'}</span>
        </div>
        <!-- Contractor name detail -->
        <div class="project-detail">
          <span class="project-detail-label">Contractor:</span>
          <span class="project-detail-value">${project.contractor_name || '-'}</span>
        </div>
      </div>
      <div class="project-card-footer">
        <!-- View details button -->
        <button class="btn-view-details" onclick="viewProjectDetails(${project.id})">View Details</button>
      </div>
    `;
    // Append the project card to the container
    container.appendChild(projectCard);
  });
}

/**
 * View detailed information about a specific project
 * @param {number} projectId - The ID of the project to view
 */
function viewProjectDetails(projectId) {
  // Find the project in the allProjects array
  const project = allProjects.find(p => p.id === projectId);
  // Check if project was found
  if (!project) {
    // Show error message if project not found
    showToast('Project not found', 'error');
    // Exit function
    return;
  }
  // Parse contractor details JSON if available
  const contractorDetails = typeof project.contractor_details === 'string' ? 
    JSON.parse(project.contractor_details) : project.contractor_details;
  // Parse insurance details JSON if available
  const insuranceDetails = typeof project.insurance_details === 'string' ? 
    JSON.parse(project.insurance_details) : project.insurance_details;
  // Parse safety certifications JSON if available
  const safetyCerts = typeof project.safety_certifications === 'string' ? 
    JSON.parse(project.safety_certifications) : project.safety_certifications;
  // Create detailed project information HTML
  const detailsHtml = `
    <div style="background: white; border-radius: 8px; padding: 2rem;">
      <!-- Project header with title -->
      <h2>${project.name}</h2>
      <!-- Project description -->
      <p style="color: #666; margin: 1rem 0;">${project.description || 'No description provided'}</p>
      
      <!-- Basic Information Section -->
      <h3 style="color: var(--primary-color); margin-top: 1.5rem;">Basic Information</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 0.5rem; font-weight: 600;">Location:</td>
          <td style="padding: 0.5rem;">${project.location || '-'}</td>
        </tr>
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 0.5rem; font-weight: 600;">City:</td>
          <td style="padding: 0.5rem;">${project.city || '-'}</td>
        </tr>
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 0.5rem; font-weight: 600;">Status:</td>
          <td style="padding: 0.5rem;">${project.work_status || '-'}</td>
        </tr>
      </table>
      
      <!-- Timeline Section -->
      <h3 style="color: var(--primary-color); margin-top: 1.5rem;">Timeline</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 0.5rem; font-weight: 600;">Start Date:</td>
          <td style="padding: 0.5rem;">${project.start_date ? new Date(project.start_date).toLocaleDateString() : '-'}</td>
        </tr>
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 0.5rem; font-weight: 600;">End Date:</td>
          <td style="padding: 0.5rem;">${project.end_date ? new Date(project.end_date).toLocaleDateString() : '-'}</td>
        </tr>
      </table>
      
      <!-- Budget Section -->
      <h3 style="color: var(--primary-color); margin-top: 1.5rem;">Budget Details</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 0.5rem; font-weight: 600;">Total Budget:</td>
          <td style="padding: 0.5rem;">₹${project.total_budget ? parseFloat(project.total_budget).toLocaleString() : '0'}</td>
        </tr>
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 0.5rem; font-weight: 600;">Allocated Budget:</td>
          <td style="padding: 0.5rem;">₹${project.budget_allocated ? parseFloat(project.budget_allocated).toLocaleString() : '0'}</td>
        </tr>
      </table>
      
      <!-- Contractor Section -->
      <h3 style="color: var(--primary-color); margin-top: 1.5rem;">Contractor Information</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 0.5rem; font-weight: 600;">Name:</td>
          <td style="padding: 0.5rem;">${project.contractor_name || '-'}</td>
        </tr>
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 0.5rem; font-weight: 600;">Contact:</td>
          <td style="padding: 0.5rem;">${project.contractor_contact || '-'}</td>
        </tr>
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 0.5rem; font-weight: 600;">License:</td>
          <td style="padding: 0.5rem;">${project.contractor_license || '-'}</td>
        </tr>
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 0.5rem; font-weight: 600;">Insurance #:</td>
          <td style="padding: 0.5rem;">${project.contractor_insurance_number || '-'}</td>
        </tr>
      </table>
      
      <!-- Safety Section -->
      <h3 style="color: var(--primary-color); margin-top: 1.5rem;">Safety & Compliance</h3>
      <p style="padding: 0.5rem; white-space: pre-wrap;">${safetyCerts && Object.keys(safetyCerts).length > 0 ? JSON.stringify(safetyCerts, null, 2) : 'No safety certifications recorded'}</p>
    </div>
  `;
  // Remove existing modal if any
  const existingModal = document.getElementById('viewProjectDetailsModal');
  if (existingModal) existingModal.remove();

  // Create modal container
  const modal = document.createElement('div');
  modal.id = 'viewProjectDetailsModal';
  modal.className = 'modal';
  modal.style.display = 'flex';
  modal.style.justifyContent = 'center';
  modal.style.alignItems = 'center';
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.width = '100%';
  modal.style.height = '100%';
  modal.style.backgroundColor = 'rgba(0,0,0,0.5)';
  modal.style.zIndex = '1000';

  const modalContent = `
    <div class="modal-dialog" style="background: white; border-radius: 8px; max-width: 600px; width: 95%; max-height: 90vh; overflow-y: auto; padding: 2rem; position: relative; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
      <button onclick="document.getElementById('viewProjectDetailsModal').remove()" style="position: absolute; right: 1rem; top: 1rem; font-size: 1.5rem; border: none; background: transparent; cursor: pointer; color: #333;">&times;</button>
      <div id="viewProjectContent">
        ${detailsHtml}
        <div style="margin-top: 1.5rem; border-top: 1px solid #eee; padding-top: 1rem; text-align: right;">
          <button onclick="editProjectDetails(${project.id})" class="btn btn-primary" style="background: linear-gradient(135deg, #F5C400 0%, #c49a00 100%); color: #1C1C1E; border: none; padding: 10px 20px; border-radius: 6px; font-weight: 600; cursor: pointer;">Edit Project</button>
        </div>
      </div>
    </div>
  `;
  modal.innerHTML = modalContent;
  document.body.appendChild(modal);

  // Close when clicking outside
  modal.addEventListener('click', function(e) {
    if (e.target === this) {
      this.remove();
    }
  });

  // Display the detailed information in a simple alert (could be modal in production)
  showToast('Project details loaded successfully.', 'success');
}

/**
 * Switch the modal to show a form for editing the project
 */
window.editProjectDetails = function(projectId) {
  const project = allProjects.find(p => p.id === projectId);
  if (!project) return;
  const content = document.getElementById('viewProjectContent');
  
  const roStyle = 'width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; background-color: #f5f5f5; color: #666; cursor: not-allowed;';
  const rwStyle = 'width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;';
  
  const nameAttr = project.name ? `readonly style="${roStyle}"` : `style="${rwStyle}"`;
  const locAttr = project.location ? `readonly style="${roStyle}"` : `style="${rwStyle}"`;
  const cityAttr = project.city ? `readonly style="${roStyle}"` : `style="${rwStyle}"`;
  
  const startDateVal = project.start_date ? new Date(project.start_date).toISOString().split('T')[0] : '';
  const startDateAttr = startDateVal ? `readonly style="${roStyle}"` : `style="${rwStyle}"`;
  
  const endDateVal = project.end_date ? new Date(project.end_date).toISOString().split('T')[0] : '';
  const endDateAttr = endDateVal ? `readonly style="${roStyle}"` : `style="${rwStyle}"`;
  
  const budgetAttr = (project.total_budget && parseFloat(project.total_budget) > 0) ? `readonly style="${roStyle}"` : `style="${rwStyle}"`;
  
  content.innerHTML = `
    <h2 style="margin-bottom: 1rem;">Edit Project: ${project.name}</h2>
    <form id="editProjectFormInModal" onsubmit="submitEditProject(event, ${project.id})">
      <div class="form-group" style="margin-bottom: 1rem;">
        <label style="display: block; font-weight: 600; margin-bottom: 0.5rem; text-align: left;">Project Name *</label>
        <input type="text" name="name" value="${project.name || ''}" required ${nameAttr}>
      </div>
      <div class="form-group" style="margin-bottom: 1rem;">
        <label style="display: block; font-weight: 600; margin-bottom: 0.5rem; text-align: left;">Location *</label>
        <input type="text" name="location" value="${project.location || ''}" required ${locAttr}>
      </div>
      <div class="form-group" style="margin-bottom: 1rem;">
        <label style="display: block; font-weight: 600; margin-bottom: 0.5rem; text-align: left;">City *</label>
        <input type="text" name="city" value="${project.city || ''}" required ${cityAttr}>
      </div>
      <div class="form-group" style="margin-bottom: 1rem;">
        <label style="display: block; font-weight: 600; margin-bottom: 0.5rem; text-align: left;">Start Date</label>
        <input type="date" name="start_date" value="${startDateVal}" ${startDateAttr}>
      </div>
      <div class="form-group" style="margin-bottom: 1rem;">
        <label style="display: block; font-weight: 600; margin-bottom: 0.5rem; text-align: left;">End Date</label>
        <input type="date" name="end_date" value="${endDateVal}" ${endDateAttr}>
      </div>
      <div class="form-group" style="margin-bottom: 1rem;">
        <label style="display: block; font-weight: 600; margin-bottom: 0.5rem; text-align: left;">Total Budget (₹)</label>
        <input type="number" name="total_budget" value="${project.total_budget || ''}" step="0.01" ${budgetAttr}>
      </div>
      <div class="form-group" style="margin-bottom: 1rem;">
        <label style="display: block; font-weight: 600; margin-bottom: 0.5rem; text-align: left;">Allocated Budget (Phase wise) (₹)</label>
        <input type="number" name="budget_allocated" value="${project.budget_allocated || ''}" step="0.01" style="${rwStyle}" placeholder="Enter allocated budget">
      </div>
      <div class="form-group" style="margin-bottom: 1rem;">
        <label style="display: block; font-weight: 600; margin-bottom: 0.5rem; text-align: left;">Contractor Name</label>
        <input type="text" name="contractor_name" value="${project.contractor_name || ''}" style="${rwStyle}">
      </div>
      <div style="margin-top: 1.5rem; text-align: right;">
        <button type="button" class="btn btn-secondary" onclick="viewProjectDetails(${project.id})" style="padding: 10px 20px; background: #eee; border: none; border-radius: 6px; cursor: pointer; margin-right: 10px;">Cancel</button>
        <button type="submit" class="btn btn-primary" style="background: linear-gradient(135deg, #1a5490, #2e7db1); color: white; border: none; padding: 10px 20px; border-radius: 6px; font-weight: 600; cursor: pointer;">Save Changes</button>
      </div>
    </form>
  `;
}

/**
 * Handle submit for editing project
 */
window.submitEditProject = function(event, projectId) {
  event.preventDefault();
  const formData = new FormData(event.target);
  const data = Object.fromEntries(formData.entries());
  
  // Format dates appropriately or omit if empty
  if (!data.start_date) delete data.start_date;
  if (!data.end_date) delete data.end_date;
  if (!data.total_budget) delete data.total_budget;
  
  const token = localStorage.getItem('auth_token');
  fetch('/api/projects/' + projectId, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(data)
  })
  .then(response => {
    if (!response.ok) throw new Error('Failed to update project');
    return response.json();
  })
  .then(updatedProject => {
    showToast('Project updated successfully', 'success');
    document.getElementById('viewProjectDetailsModal').remove();
    loadProjects(); // refresh projects list
  })
  .catch(error => {
    console.error('Error updating project:', error);
    showToast('Error updating project: ' + error.message, 'error');
  });
}

/**
 * Handle project tab switching
 * Shows selected tab content and hides others
 */
function setupProjectTabs() {
  // Get all tab buttons
  const tabButtons = document.querySelectorAll('.tab-button');
  // Loop through each tab button
  tabButtons.forEach(button => {
    // Add click event listener to each tab button
    button.addEventListener('click', function() {
      // Get the tab name from data attribute
      const tabName = this.getAttribute('data-tab');
      // Get all tab content divs
      const tabContents = document.querySelectorAll('.tab-content');
      // Loop through all tab contents
      tabContents.forEach(content => {
        // Hide all tab contents
        content.style.display = 'none';
        // Remove active class from all tabs
        content.classList.remove('active');
      });
      // Get all tab buttons
      const buttons = document.querySelectorAll('.tab-button');
      // Loop through all buttons to remove active class
      buttons.forEach(btn => {
        // Remove active class from all buttons
        btn.classList.remove('active');
      });
      // Show the selected tab content
      document.getElementById(tabName).style.display = 'block';
      // Add active class to the selected tab content
      document.getElementById(tabName).classList.add('active');
      // Add active class to the clicked button
      this.classList.add('active');
    });
  });
}

/**
 * Load all documents from all projects
 * Fetches documents with project names and uploader information
 */
function loadAllDocuments() {
  // Get the JWT token from localStorage for authentication
  const token = localStorage.getItem('auth_token');
  
  // Get user role from localStorage
  const userRole = localStorage.getItem('user_role');
  
  // Determine if we should filter documents by assigned projects
  // Superadmin can see all documents, others see only their assigned projects
  const shouldFilterByAssigned = userRole !== 'superadmin' ? 'true' : 'false';
  
  // Make API request to fetch documents with optional project filtering
  const url = '/api/documents' + (shouldFilterByAssigned === 'true' ? '?filter_by_assigned=true' : '');
  
  fetch(url, {
    // Set request headers with Authorization token
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
    // Check if response is successful
    .then(response => {
      // If response is not OK, throw an error
      if (!response.ok) {
        // Log the error status
        console.error('Response status:', response.status);
        // Throw error with status
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      // Convert response to JSON if successful
      return response.json();
    })
    // Handle the documents data
    .then(data => {
      // Store all documents in global variable
      allDocuments = data || [];
      // Log documents to console for debugging
      console.log('Documents loaded:', allDocuments);
      // Populate project filter dropdown with unique projects
      populateDocumentProjectFilter();
      // Display all documents in the table
      displayDocumentsTable(allDocuments);
    })
    // Catch and log any errors from the API request
    .catch(error => {
      // Log error to console with full details
      console.error('Error loading documents:', error);
      // Display error message to user
      showToast('Failed to load documents: ' + error.message, 'error');
    });
}

/**
 * Populate the project filter dropdown with unique project names
 * Gets list of unique projects from allDocuments array
 */
function populateDocumentProjectFilter() {
  // Get the project filter select element
  const projectFilter = document.getElementById('documentProjectFilter');
  // Get unique project names from all documents
  const uniqueProjects = [...new Set(allDocuments.map(doc => ({ id: doc.project_id, name: doc.project_name || 'Unknown Project' })))];
  // Clear existing options except the first one
  while (projectFilter.options.length > 1) {
    // Remove options at index 1
    projectFilter.remove(1);
  }
  // Loop through each unique project
  uniqueProjects.forEach(project => {
    // Create new option element
    const option = document.createElement('option');
    // Set the option value to project ID
    option.value = project.id;
    // Set the option text to project name
    option.textContent = project.name;
    // Append option to select element
    projectFilter.appendChild(option);
  });
}

/**
 * Display documents in the documents table with all document information
 * @param {Array} documents - Array of document objects to display
 */
function displayDocumentsTable(documents) {
  // Get the table body element where document rows will be added
  const tableBody = document.getElementById('documentsTable');
  // Clear any existing rows in the table
  tableBody.innerHTML = '';
  // Check if there are documents to display
  if (!documents || documents.length === 0) {
    // Create a message row if no documents exist
    tableBody.innerHTML = '<tr><td colspan="7" style="text-align: center;">No documents found</td></tr>';
    // Exit function early if no documents
    return;
  }
  // Loop through each document to create table rows
  documents.forEach(doc => {
    // Create a new table row element
    const row = document.createElement('tr');
    // Get file extension from original filename
    const fileExt = doc.original_name ? doc.original_name.split('.').pop().toUpperCase() : 'UNKNOWN';
    // Set the HTML content of the row with document data
    row.innerHTML = `
      <td>${doc.project_name || 'Unknown'}</td>
      <td>${doc.title || doc.original_name || 'Untitled'}</td>
      <td>${doc.uploaded_by_name || 'Unknown'}</td>
      <td>${new Date(doc.created_at).toLocaleDateString()}</td>
      <td><span class="badge badge-${fileExt === 'PDF' ? 'danger' : fileExt === 'ZIP' ? 'info' : 'warning'}">${fileExt}</span></td>
      <td><span class="badge badge-success">Approved</span></td>
      <td>
        <button class="btn btn-small" onclick="downloadDocument('${doc.file_path}', '${doc.original_name}')">Download</button>
      </td>
    `;
    // Append the row to the table body
    tableBody.appendChild(row);
  });
}

/**
 * Filter documents based on project and document type selections
 * Gets values from filter selects, filters allDocuments array
 */
function filterDocuments() {
  // Get the project filter select value
  const projectValue = document.getElementById('documentProjectFilter').value;
  // Get the document type filter select value
  const typeValue = document.getElementById('documentTypeFilter').value;
  // Filter documents based on project and type criteria
  const filteredDocuments = allDocuments.filter(doc => {
    // Check if document project matches filter (or all projects if filter is empty)
    const matchesProject = !projectValue || doc.project_id == projectValue;
    // Check if document type matches filter (or all types if filter is empty)
    let matchesType = true;
    // Only check type if filter has a value
    if (typeValue) {
      // Get the file extension
      const fileExt = doc.original_name ? doc.original_name.split('.').pop().toLowerCase() : '';
      // Check based on type filter
      if (typeValue === 'pdf' && fileExt !== 'pdf') {
        matchesType = false;
      } else if (typeValue === 'image' && !['png', 'jpg', 'jpeg', 'gif'].includes(fileExt)) {
        matchesType = false;
      } else if (typeValue === 'archive' && !['zip', 'rar', '7z'].includes(fileExt)) {
        matchesType = false;
      }
    }
    // Return true if both conditions are met
    return matchesProject && matchesType;
  });
  // Display the filtered documents in the table
  displayDocumentsTable(filteredDocuments);
}

/**
 * Download a document file
 * @param {string} filePath - The path to the document file
 * @param {string} fileName - The original filename for download
 */
function downloadDocument(filePath, fileName) {
  // Create a new anchor element for download
  const link = document.createElement('a');
  // Set the href to the file path
  link.href = filePath;
  // Set the download attribute with filename
  link.download = fileName || 'document';
  // Append link to body temporarily
  document.body.appendChild(link);
  // Click the link to trigger download
  link.click();
  // Remove the link from body
  document.body.removeChild(link);
  // Show success notification
  showToast('Download started: ' + (fileName || 'document'), 'success');
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
      // Clear authentication token from localStorage
      localStorage.removeItem('auth_token');
      // Redirect to login page after logout
      window.location.href = '/';
    })
    // Catch and log any errors
    .catch(error => {
      // Log error to console
      console.error('Error logging out:', error);
      // Clear localStorage anyway
      localStorage.removeItem('auth_token');
      // Redirect to home page
      window.location.href = '/';
    });
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

// ========================================
// TEMPLATE MANAGEMENT FUNCTIONS
// ========================================

/**
 * Load all available templates from the API
 * Populates the templates table with template data
 */
/**
 * Load and display templates from database
 */

// OLD LOADTEMPLATES REMOVED - Using updated version below

/**
 * Global state for template creation
 */
let templateCreationState = {
  fields: [],
  rows: [],
  columns: [],
  templateType: 'fields'
};

/**
 * Update template type UI - switch between Simple Fields and Rows & Columns
 */
function updateTemplateTypeUI() {
  const templateType = document.querySelector('input[name="templateType"]:checked').value;
  templateCreationState.templateType = templateType;
  
  const simpleFieldsSection = document.getElementById('simpleFieldsSection');
  const rowsColumnsSection = document.getElementById('rowsColumnsSection');
  
  if (templateType === 'fields') {
    simpleFieldsSection.style.display = 'block';
    rowsColumnsSection.style.display = 'none';
  } else {
    simpleFieldsSection.style.display = 'none';
    rowsColumnsSection.style.display = 'block';
  }
  
  updateTemplatePreview();
}

/**
 * Add a new field to the template
 */
function addTemplateField() {
  const fieldName = prompt('Enter field name (e.g., site_status, worker_count):');
  if (!fieldName) return;
  
  const fieldLabel = prompt('Enter display label (e.g., Site Status):');
  if (!fieldLabel) return;
  
  const fieldType = prompt('Field type (text/number/decimal/date/textarea/select):', 'text');
  
  const newField = {
    id: 'field_' + Date.now(),
    name: fieldName,
    label: fieldLabel,
    type: fieldType || 'text'
  };
  
  templateCreationState.fields.push(newField);
  renderFieldsContainer();
  updateTemplatePreview();
  showToast(`Field "${fieldLabel}" added`, 'success');
}

/**
 * Delete a field from the template
 */
function deleteTemplateField(fieldId) {
  templateCreationState.fields = templateCreationState.fields.filter(f => f.id !== fieldId);
  renderFieldsContainer();
  updateTemplatePreview();
  showToast('Field deleted', 'success');
}

/**
 * Render the fields container with all fields
 */
function renderFieldsContainer() {
  const container = document.getElementById('fieldsContainer');
  
  if (templateCreationState.fields.length === 0) {
    container.innerHTML = '<div style="padding: 20px; color: #999; text-align: center;">No fields added yet. Click "Add Field" to create one.</div>';
    return;
  }
  
  container.innerHTML = templateCreationState.fields.map((field, index) => `
    <div style="display: grid; grid-template-columns: 2fr 2fr 1.2fr 1fr; gap: 12px; padding: 12px 15px; border-bottom: 1px solid #e0e0e0; align-items: center;">
      <div style="font-size: 13px; color: #333; font-weight: 500;">${field.name}</div>
      <div style="font-size: 13px; color: #666;">${field.label}</div>
      <div style="font-size: 13px; color: #999;">${field.type}</div>
      <div style="text-align: center;">
        <button type="button" onclick="deleteTemplateField('${field.id}')" 
          style="background: #ff6b6b; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; transition: all 0.3s;"
          onmouseover="this.style.background='#ff5252';"
          onmouseout="this.style.background='#ff6b6b';">
          Delete
        </button>
      </div>
    </div>
  `).join('');
}

/**
 * Add a new row to the template
 */
function addTemplateRow() {
  const numCellsInput = prompt('How many columns should this row have? (e.g., 3)', '3');
  if (!numCellsInput || isNaN(numCellsInput)) return;
  
  const numCells = parseInt(numCellsInput);
  if (numCells < 1) {
    showToast('Row must have at least 1 column', 'error');
    return;
  }
  
  const cells = Array(numCells).fill(null).map((_, i) => ({
    id: 'cell_' + Date.now() + '_' + i,
    label: `Column ${i + 1}`,
    colspan: 1,
    rowspan: 1
  }));
  
  const newRow = {
    id: 'row_' + Date.now(),
    cells: cells
  };
  
  templateCreationState.rows.push(newRow);
  renderRowsContainer();
  updateTemplatePreview();
  showToast(`Row with ${numCells} columns added`, 'success');
}

/**
 * Add a new column to all rows
 */
function addTemplateColumn() {
  if (templateCreationState.rows.length === 0) {
    showToast('Add a row first', 'error');
    return;
  }
  
  templateCreationState.rows.forEach(row => {
    row.cells.push({
      id: 'cell_' + Date.now() + '_' + Math.random(),
      label: `Column ${row.cells.length}`,
      colspan: 1,
      rowspan: 1
    });
  });
  
  renderRowsContainer();
  updateTemplatePreview();
  showToast('Column added to all rows', 'success');
}

/**
 * Delete a row from the template
 */
function deleteTemplateRow(rowId) {
  templateCreationState.rows = templateCreationState.rows.filter(r => r.id !== rowId);
  renderRowsContainer();
  updateTemplatePreview();
  showToast('Row deleted', 'success');
}

/**
 * Update cell label in row
 */
function updateCellLabel(rowId, cellId, newLabel) {
  const row = templateCreationState.rows.find(r => r.id === rowId);
  if (row) {
    const cell = row.cells.find(c => c.id === cellId);
    if (cell) {
      cell.label = newLabel || `Cell`;
      renderRowsContainer();
      updateTemplatePreview();
    }
  }
}

/**
 * Render the rows container with all rows
 */
function renderRowsContainer() {
  const container = document.getElementById('rowsContainer');
  
  if (templateCreationState.rows.length === 0) {
    container.innerHTML = '<div style="padding: 20px; color: #999; text-align: center;">No rows added yet. Click "Add Row" to create one.</div>';
    return;
  }
  
  container.innerHTML = `
    <div style="overflow-x: auto;">
      <table style="width: 100%; border-collapse: collapse;">
        <tbody>
          ${templateCreationState.rows.map((row, rowIndex) => `
            <tr style="border-bottom: 1px solid #e0e0e0;">
              ${row.cells.map(cell => `
                <td style="padding: 12px; border-right: 1px solid #e0e0e0; text-align: center; position: relative;">
                  <input type="text" value="${cell.label}" placeholder="Cell label" 
                    onchange="updateCellLabel('${row.id}', '${cell.id}', this.value)"
                    style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px;" />
                </td>
              `).join('')}
              <td style="padding: 12px; text-align: center;">
                <button type="button" onclick="deleteTemplateRow('${row.id}')" 
                  style="background: #ff6b6b; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; transition: all 0.3s;"
                  onmouseover="this.style.background='#ff5252';"
                  onmouseout="this.style.background='#ff6b6b';">
                  Delete Row
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * Update template preview
 */
function updateTemplatePreview() {
  const preview = document.getElementById('templatePreview');
  const templateType = templateCreationState.templateType;
  
  if (templateType === 'fields') {
    if (templateCreationState.fields.length === 0) {
      preview.innerHTML = '<p style="color: #999; padding: 15px;">Preview will show fields here...</p>';
      return;
    }
    
    preview.innerHTML = `
      <div style="padding: 15px;">
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background: #f0f0f0;">
              ${templateCreationState.fields.map(field => `
                <th style="padding: 10px; border: 1px solid #ddd; text-align: left; font-weight: 600; font-size: 12px;">${field.label}</th>
              `).join('')}
            </tr>
          </thead>
          <tbody>
            <tr>
              ${templateCreationState.fields.map(field => `
                <td style="padding: 10px; border: 1px solid #ddd; color: #999; font-size: 12px;">Sample ${field.type}...</td>
              `).join('')}
            </tr>
          </tbody>
        </table>
      </div>
    `;
  } else {
    if (templateCreationState.rows.length === 0) {
      preview.innerHTML = '<p style="color: #999; padding: 15px;">Preview will show rows here...</p>';
      return;
    }
    
    preview.innerHTML = `
      <div style="overflow-x: auto; padding: 15px;">
        <table style="width: 100%; border-collapse: collapse; border: 1px solid #ddd;">
          <tbody>
            ${templateCreationState.rows.map(row => `
              <tr>
                ${row.cells.map(cell => `
                  <td style="padding: 15px; border: 1px solid #ddd; text-align: center; font-weight: 600; color: #333; background: #f9f9f9;">${cell.label}</td>
                `).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
}

/**
 * Save template to database (create new or update existing)
 */
function saveTemplateToDatabase() {
  const token = localStorage.getItem('auth_token');
  if (!token) {
    showToast('Authentication required', 'error');
    return;
  }
  
  const templateName = document.getElementById('templateName').value.trim();
  const templateDescription = document.getElementById('templateDescription').value.trim();
  const isDefault = document.getElementById('isDefaultTemplate').checked;
  const templateType = templateCreationState.templateType;
  const isEditing = templateCreationState.editingTemplateId;
  
  if (!templateName) {
    showToast('Please enter a template name', 'error');
    return;
  }
  
  if (templateType === 'fields' && templateCreationState.fields.length === 0) {
    showToast('Please add at least one field', 'error');
    return;
  }
  
  if (templateType === 'rows' && templateCreationState.rows.length === 0) {
    showToast('Please add at least one row', 'error');
    return;
  }
  
  const templateData = {
    name: templateName,
    description: templateDescription,
    is_default: isDefault,
    template_type: templateType,
    fields: templateType === 'fields' ? templateCreationState.fields : [],
    rows: templateType === 'rows' ? templateCreationState.rows : []
  };
  
  // Use PUT for updates, POST for new templates
  const method = isEditing ? 'PUT' : 'POST';
  const url = isEditing ? `/api/templates/${isEditing}` : '/api/templates';
  
  fetch(url, {
    method: method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(templateData)
  })
    .then(response => {
      if (!response.ok) {
        return response.json().then(err => Promise.reject(err));
      }
      return response.json();
    })
    .then(data => {
      const actionText = isEditing ? 'updated' : 'saved';
      showToast(`Template "${templateName}" ${actionText} successfully!`, 'success');
      
      // Reset form
      document.getElementById('createTemplateForm').reset();
      templateCreationState = { fields: [], rows: [], columns: [], templateType: 'fields' };
      renderFieldsContainer();
      renderRowsContainer();
      updateTemplatePreview();
      
      // Change button back to "Save"
      const saveBtn = document.querySelector('[onclick="saveTemplateToDatabase()"]');
      if (saveBtn) {
        saveBtn.textContent = '💾 Save Template';
        saveBtn.dataset.editing = 'false';
      }
      
      // Close modal
      document.getElementById('createTemplateModal').style.display = 'none';
      
      // Reload templates list
      loadTemplates();
    })
    .catch(error => {
      console.error('Error saving template:', error);
      showToast(`Error saving template: ${error.message || 'Unknown error'}`, 'error');
    });
}

/**
 * Load templates from API and display them in the templates list
 */
function loadTemplates() {
  const token = localStorage.getItem('auth_token');
  if (!token) return;
  
  fetch('/api/templates', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
    .then(response => {
      if (!response.ok) throw new Error('Failed to load templates');
      return response.json();
    })
    .then(data => {
      const templatesList = document.getElementById('templatesList');
      const templates = data.templates || data || [];
      
      if (!templates || templates.length === 0) {
        templatesList.innerHTML = `
          <div style="text-align: center; padding: 60px 20px; color: #999;">
            <i class="fas fa-inbox" style="font-size: 48px; margin-bottom: 15px; display: block; opacity: 0.5;"></i>
            <p style="margin: 0; font-size: 16px; font-weight: 600;">No templates yet</p>
            <p style="margin: 8px 0 0 0; font-size: 13px;">Create your first template to get started designing reports</p>
          </div>
        `;
        return;
      }
      
      templatesList.innerHTML = templates.map(template => `
        <div style="background: white; border: 2px solid #e0e0e0; border-radius: 8px; padding: 20px; display: grid; grid-template-columns: 1fr auto; gap: 20px; align-items: start; transition: all 0.3s;">
          <div>
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
              <h3 style="margin: 0; color: #1a5490; font-size: 16px; font-weight: 700;">${template.name}</h3>
              ${template.is_default ? `
                <span style="background: linear-gradient(135deg, #ffd700, #ffed4e); color: #333; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">⭐ Default</span>
              ` : ''}
            </div>
            <p style="margin: 0 0 10px 0; color: #666; font-size: 13px;">${template.description || 'No description'}</p>
            <div style="display: flex; gap: 15px; font-size: 12px; color: #999;">
              <span><i class="fas fa-layer-group"></i> ${template.rows && template.rows.length > 0 ? template.rows.length + ' rows' : 'Row-based'}</span>
              <span><i class="fas fa-columns"></i> ${template.fields && template.fields.length > 0 ? template.fields.length + ' fields' : 'Field-based'}</span>
              <span><i class="fas fa-calendar"></i> ${new Date(template.created_at).toLocaleDateString()}</span>
            </div>
          </div>
          <div style="display: flex; flex-direction: column; gap: 10px;">
            <button onclick="editTemplate(${template.id})" 
              style="background: #1a5490; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 12px; transition: all 0.3s; white-space: nowrap;"
              onmouseover="this.style.background='#2e7db1';"
              onmouseout="this.style.background='#1a5490';">
              ✎ Edit
            </button>
            <button onclick="deleteTemplate(${template.id}, '${template.name}')" 
              style="background: #ff6b6b; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 12px; transition: all 0.3s; white-space: nowrap;"
              onmouseover="this.style.background='#ff5252';"
              onmouseout="this.style.background='#ff6b6b';">
              🗑️ Delete
            </button>
          </div>
        </div>
      `).join('');
    })
    .catch(error => {
      console.error('Error loading templates:', error);
      document.getElementById('templatesList').innerHTML = `
        <div style="background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; padding: 15px; color: #856404;">
          <strong>⚠️ Error loading templates:</strong> ${error.message}
        </div>
      `;
    });
}

/**
 * Edit a template
 */
function editTemplate(templateId) {
  const token = localStorage.getItem('auth_token');
  
  // Fetch the template data from API
  fetch(`/api/templates`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
    .then(response => response.json())
    .then(data => {
      const templates = (data.success && data.templates) ? data.templates : (Array.isArray(data) ? data : []);
      const template = templates.find(t => t.id === templateId);
      
      if (!template) {
        showToast('Template not found', 'error');
        return;
      }
      
      // Populate the form with template data
      document.getElementById('templateName').value = template.name || '';
      document.getElementById('templateDescription').value = template.description || '';
      document.getElementById('isDefaultTemplate').checked = template.is_default || false;
      
      // Determine template type and load data
      if (template.rows && template.rows.length > 0) {
        // Rows-based template
        document.querySelector('input[name="templateType"][value="rows"]').checked = true;
        templateCreationState = {
          fields: [],
          rows: template.rows || [],
          columns: [],
          templateType: 'rows',
          editingTemplateId: templateId
        };
      } else {
        // Fields-based template
        document.querySelector('input[name="templateType"][value="fields"]').checked = true;
        templateCreationState = {
          fields: template.fields || [],
          rows: [],
          columns: [],
          templateType: 'fields',
          editingTemplateId: templateId
        };
      }
      
      // Update UI and preview
      updateTemplateTypeUI();
      renderFieldsContainer();
      renderRowsContainer();
      updateTemplatePreview();
      
      // Change button text to "Update" instead of "Save"
      const saveBtn = document.querySelector('[onclick="saveTemplateToDatabase()"]');
      if (saveBtn) {
        saveBtn.textContent = '💾 Update Template';
        saveBtn.dataset.editing = 'true';
      }
      
      // Open modal
      document.getElementById('createTemplateModal').style.display = 'flex';
      showToast(`Editing template: ${template.name}`, 'info');
    })
    .catch(error => {
      console.error('Error loading template for editing:', error);
      showToast('Failed to load template for editing', 'error');
    });
}

/**
 * Delete a template
 */
function deleteTemplate(templateId, templateName) {
  if (!confirm(`Are you sure you want to delete the template "${templateName}"?`)) {
    return;
  }
  
  const token = localStorage.getItem('auth_token');
  if (!token) {
    showToast('Authentication required', 'error');
    return;
  }
  
  fetch(`/api/templates/${templateId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
    .then(response => {
      if (!response.ok) throw new Error('Failed to delete template');
      return response.json();
    })
    .then(data => {
      showToast(`Template "${templateName}" deleted successfully`, 'success');
      loadTemplates();
    })
    .catch(error => {
      console.error('Error deleting template:', error);
      showToast(`Error deleting template: ${error.message}`, 'error');
    });
}

/**
 * Open create template modal
 */
function openCreateTemplateModal() {
  templateCreationState = { fields: [], rows: [], columns: [], templateType: 'fields' };
  renderFieldsContainer();
  renderRowsContainer();
  updateTemplatePreview();
  document.getElementById('createTemplateModal').style.display = 'flex';
}
