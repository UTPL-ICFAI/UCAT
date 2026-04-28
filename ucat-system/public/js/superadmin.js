// Global error handler to catch any uncaught JavaScript errors
window.onerror = function (msg, url, lineNo, columnNo, error) {
  // Log error details to console for debugging
  console.error("JavaScript Error:", {
    message: msg,
    source: url,
    line: lineNo,
    column: columnNo,
    error: error,
  });
  // Don't show error for network issues - let them be handled gracefully
  return false;
};

// Wait for DOM to be fully loaded before executing any JavaScript
document.addEventListener("DOMContentLoaded", function () {
  // Check if user is authenticated
  const token = localStorage.getItem("auth_token");
  if (!token) {
    // Redirect to login page if no token
    console.warn("No authentication token found - redirecting to login");
    window.location.href = "/";
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

function getCheckedValues(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return [];
  return Array.from(
    container.querySelectorAll('input[type="checkbox"]:checked'),
  )
    .map((input) => parseInt(input.value))
    .filter((value) => !isNaN(value));
}

function renderCheckboxList(containerId, items, emptyMessage) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!items || items.length === 0) {
    container.innerHTML = `<div class="help-text">${emptyMessage || "No options available."}</div>`;
    return;
  }

  container.innerHTML = items
    .map((item) => {
      const inputId = `${containerId}_${item.id}`;
      return `
      <label class="checkbox-item" for="${inputId}">
        <input type="checkbox" id="${inputId}" value="${item.id}" />
        <span>${item.name}</span>
      </label>
    `;
    })
    .join("");
}

function clearCheckboxSelections(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.checked = false;
  });
}

function formatCurrency(amount) {
  const value = Number(amount) || 0;
  return "₹" + value.toFixed(2);
}

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
  const token = localStorage.getItem("auth_token");
  if (!token) {
    console.warn("No authentication token available for stats");
    return;
  }

  // Make API request to fetch statistics
  fetch("/api/superadmin/stats", {
    // Set request headers with Authorization token
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
    // Check if response is successful
    .then((response) => {
      // If response is not OK, throw an error
      if (!response.ok) {
        // Log the error status
        console.warn("Stats API returned status:", response.status);
        // Throw error with status
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      // Convert response to JSON if successful
      return response.json();
    })
    // Handle the statistics data
    .then((data) => {
      // Store stats in global variable for later use
      allStats = data;
      // Log stats to console for debugging
      console.log("Stats loaded:", data);

      // Safely update KPI cards with fallback to 0
      const updateKPI = (elementId, value) => {
        const element = document.getElementById(elementId);
        if (element) {
          element.textContent = value || 0;
        }
      };

      // Populate total projects KPI card
      updateKPI("totalProjectsValue", data.totalProjects);
      // Populate active projects KPI card
      updateKPI("activeProjectsValue", data.activeProjects);
      // Populate total users KPI card
      updateKPI("totalUsersValue", data.totalUsers);
      // Populate open issues KPI card
      updateKPI("openIssuesValue", data.openIssues);
      // Populate total workers KPI card
      updateKPI("totalWorkersValue", data.totalWorkers);
      // Populate total documents KPI card
      updateKPI("totalDocumentsValue", data.totalDocuments);
    })
    // Catch and log any errors from the API request
    .catch((error) => {
      // Log error to console with full details
      console.warn("Warning: Could not load stats:", error.message);
      // Set default values if stats fail to load
      [
        "totalProjectsValue",
        "activeProjectsValue",
        "totalUsersValue",
        "openIssuesValue",
        "totalWorkersValue",
        "totalDocumentsValue",
      ].forEach((id) => {
        const element = document.getElementById(id);
        if (element) element.textContent = "0";
      });
    });
}

/**
 * Initialize Chart.js bar chart for budget overview
 * Creates a responsive chart with budget data
 */
function initBudgetChart() {
  // Get the canvas element for the chart
  const ctx = document.getElementById("budgetChart");
  // Check if canvas element exists
  if (!ctx) {
    // Log error if canvas not found
    console.error("Budget chart canvas not found");
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
    projectsToShow.push({
      name: "No Projects",
      total_budget: 0,
      budget_allocated: 0,
    });
  }

  // Loop through projects and extract budget data
  projectsToShow.forEach((project) => {
    // Add project name to labels
    labels.push(project.name || "Unknown Project");
    // Add allocated budget (or 0 if undefined)
    allocatedData.push(parseFloat(project.budget_allocated) || 0);
    // Add total budget as spent (or allocated if spent not available)
    spentData.push(parseFloat(project.total_budget) || 0);
  });

  // Create new Chart.js instance with bar chart type
  budgetChart = new Chart(ctx, {
    // Set chart type to bar chart
    type: "bar",
    // Define data for the chart
    data: {
      // Array of labels for each bar (project names)
      labels: labels,
      // Array of datasets for the chart
      datasets: [
        // First dataset for allocated budget
        {
          // Label for allocated budget bars
          label: "Budget Allocated",
          // Array of values for allocated budget
          data: allocatedData,
          // Background color for allocated budget bars
          backgroundColor: "rgba(54, 162, 235, 0.7)",
          // Border color for allocated budget bars
          borderColor: "rgba(54, 162, 235, 1)",
          // Border width for allocated budget bars
          borderWidth: 2,
        },
        // Second dataset for total budget
        {
          // Label for total budget bars
          label: "Total Budget",
          // Array of values for total budget
          data: spentData,
          // Background color for total budget bars
          backgroundColor: "rgba(75, 192, 75, 0.7)",
          // Border color for total budget bars
          borderColor: "rgba(75, 192, 75, 1)",
          // Border width for total budget bars
          borderWidth: 2,
        },
      ],
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
            callback: function (value) {
              return "₹" + value.toLocaleString();
            },
          },
        },
      },
      // Configure tooltips
      plugins: {
        // Configure the legend
        legend: {
          // Display the legend
          display: true,
          // Position legend at bottom
          position: "bottom",
        },
        // Configure tooltips on hover
        tooltip: {
          // Format tooltip labels
          callbacks: {
            label: function (context) {
              return (
                context.dataset.label +
                ": ₹" +
                context.parsed.y.toLocaleString()
              );
            },
          },
        },
      },
    },
  });
}

/**
 * Load recent activity from API and display in activity feed
 * Makes GET request to /api/superadmin/activity
 */
function loadActivity() {
  // Get the JWT token from localStorage for authentication
  const token = localStorage.getItem("auth_token");
  // Make API request to fetch recent activity
  fetch("/api/superadmin/activity", {
    // Set request headers with Authorization token
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
    // Check if response is successful
    .then((response) => {
      // If response is not OK, throw an error
      if (!response.ok) {
        // Log the error status
        console.error("Response status:", response.status);
        // Throw error with status
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      // Convert response to JSON if successful
      return response.json();
    })
    // Handle the activity data
    .then((data) => {
      // Get the activity feed container element
      const activityFeed = document.getElementById("activityFeed");
      // Clear any existing activity items
      activityFeed.innerHTML = "";
      // Log activity to console for debugging
      console.log("Activity loaded:", data);
      // Check if activity data is available
      if (data && data.length > 0) {
        // Loop through each activity item
        data.forEach((activity) => {
          // Create a div element for each activity item
          const activityItem = document.createElement("div");
          // Add CSS class for styling activity items
          activityItem.className = "activity-item";
          // Set the HTML content of the activity item
          activityItem.innerHTML = `
            <span class="activity-type">${activity.type || "Update"}</span>
            <span class="activity-name">${activity.description || "Unknown"}</span>
            <span class="activity-time">${new Date(activity.created_at).toLocaleDateString()}</span>
          `;
          // Append the activity item to the feed container
          activityFeed.appendChild(activityItem);
        });
      } else {
        // Display message if no activity items found
        activityFeed.innerHTML = "<p>No recent activity</p>";
      }
    })
    // Catch and log any errors from the API request
    .catch((error) => {
      // Log error to console with full details
      console.error("Error loading activity:", error);
      // Display error message to user
      showToast("Failed to load activity: " + error.message, "error");
    });
}

/**
 * Load all users from API and store in global variable
 * Makes GET request to /api/superadmin/users
 */
function loadUsers() {
  // Get the JWT token from localStorage for authentication
  const token = localStorage.getItem("auth_token");
  // Make API request to fetch all users
  fetch("/api/superadmin/users", {
    // Set request headers with Authorization token
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
    // Check if response is successful
    .then((response) => {
      // If response is not OK, throw an error
      if (!response.ok) {
        // Log the error status
        console.error("Response status:", response.status);
        // Throw error with status
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      // Convert response to JSON if successful
      return response.json();
    })
    // Handle the users data
    .then((data) => {
      // Store all users in global variable
      allUsers = data || [];
      // Log the users to console for debugging
      console.log("Users loaded:", allUsers);
      // Display the users in the users table
      displayUsersTable(allUsers);
    })
    // Catch and log any errors from the API request
    .catch((error) => {
      // Log error to console with full details
      console.error("Error loading users:", error);
      // Display error message to user
      showToast("Failed to load users: " + error.message, "error");
    });
}

/**
 * Display users in the users table with Edit and Delete buttons
 * @param {Array} users - Array of user objects to display
 */
function displayUsersTable(users) {
  // Get the table body element where user rows will be added
  const tableBody = document.getElementById("usersTable");
  // Clear any existing rows in the table
  tableBody.innerHTML = "";
  // Check if there are users to display
  if (!users || users.length === 0) {
    // Create a message row if no users exist
    tableBody.innerHTML =
      '<tr><td colspan="8" style="text-align: center;">No users found</td></tr>';
    // Exit function early if no users
    return;
  }
  // Loop through each user to create table rows
  users.forEach((user) => {
    // Create a new table row element
    const row = document.createElement("tr");
    // Set the HTML content of the row with user data
    row.innerHTML = `
      <td>${user.name}</td>
      <td>${user.age || "-"}</td>
      <td>${user.gender || "-"}</td>
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
function openEditUserModal(
  userId,
  name,
  age,
  gender,
  employmentId,
  role,
  userIdStr,
) {
  // Set the hidden user ID field
  document.getElementById("editUserId").value = userId;
  // Set the name field
  document.getElementById("editUserName").value = name;
  // Set the age field
  document.getElementById("editUserAge").value = age;
  // Set the gender select
  document.getElementById("editUserGender").value = gender || "";
  // Set the employment ID field
  document.getElementById("editUserEmploymentId").value = employmentId;
  // Set the role select
  document.getElementById("editUserRole").value = role;
  // Set the readonly user ID field
  document.getElementById("editUserIdField").value = userIdStr;
  // Clear the password field (leave blank on edit)
  document.getElementById("editUserPassword").value = "";
  // Show the edit user modal
  document.getElementById("editUserModal").style.display = "flex";
}

/**
 * Filter users based on search input and role filter
 * Gets values from search input and role select, filters allUsers array
 */
function filterUsers() {
  // Get the search input value and convert to lowercase
  const searchValue = document.getElementById("userSearch").value.toLowerCase();
  // Get the role filter select value
  const roleValue = document.getElementById("roleFilter").value;
  // Filter users based on search and role criteria
  const filteredUsers = allUsers.filter((user) => {
    // Check if user name includes search term (case-insensitive)
    const matchesSearch =
      user.name.toLowerCase().includes(searchValue) ||
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
  if (!confirm("Are you sure you want to delete this user?")) {
    // Exit function if user cancels confirmation
    return;
  }
  // Get the JWT token from localStorage for authentication
  const token = localStorage.getItem("auth_token");
  // Make API request to delete the user
  fetch(`/api/superadmin/users/${userId}`, {
    // Set HTTP method to DELETE
    method: "DELETE",
    // Set header for JSON content type
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  })
    // Handle the response from the API
    .then((response) => {
      // Check if response status is successful
      if (response.ok) {
        // Show success toast notification
        showToast("User deleted successfully", "success");
        // Reload the users table to reflect changes
        loadUsers();
      } else {
        // Show error toast notification if deletion failed
        showToast("Failed to delete user", "error");
      }
    })
    // Catch and log any errors from the API request
    .catch((error) => {
      // Log error to console
      console.error("Error deleting user:", error);
      // Show error toast notification
      showToast("Error deleting user", "error");
    });
}

/**
 * Load the permissions matrix from API and display in permissions section
 * Makes GET request to /api/superadmin/permissions/all
 */
function loadPermissionsTable() {
  // Get the JWT token from localStorage for authentication
  const token = localStorage.getItem("auth_token");
  // Make API request to fetch all permissions
  fetch("/api/superadmin/permissions/all", {
    // Set request headers with Authorization token
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
    // Check if response is successful
    .then((response) => {
      // If response is not OK, throw an error
      if (!response.ok) {
        // Log the error status
        console.error("Response status:", response.status);
        // Throw error with status
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      // Convert response to JSON if successful
      return response.json();
    })
    // Handle the permissions data
    .then((data) => {
      // Get the permissions section container
      const permissionsSection = document.getElementById("permissionsSection");
      // Clear any existing content
      permissionsSection.innerHTML = "";
      // Log permissions to console for debugging
      console.log("Permissions loaded:", data);
      // Check if permissions data exists
      if (data && data.length > 0) {
        // Create a table for the permissions matrix
        const table = document.createElement("table");
        // Add CSS class for table styling
        table.className = "permissions-table";
        // Create and append the table header
        const thead = document.createElement("thead");
        // Create header row
        const headerRow = document.createElement("tr");
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
        const tbody = document.createElement("tbody");
        // Loop through each permission row
        data.forEach((perm) => {
          // Create a new table row
          const row = document.createElement("tr");
          // Set the HTML content with permission data
          row.innerHTML = `
            <td>${perm.user_name}</td>
            <td><input type="checkbox" ${perm.can_view ? "checked" : ""} disabled /></td>
            <td><input type="checkbox" ${perm.can_edit ? "checked" : ""} disabled /></td>
            <td><input type="checkbox" ${perm.can_delete ? "checked" : ""} disabled /></td>
            <td><input type="checkbox" ${perm.can_manage_users ? "checked" : ""} disabled /></td>
            <td><input type="checkbox" ${perm.can_manage_projects ? "checked" : ""} disabled /></td>
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
        permissionsSection.innerHTML = "<p>No permissions data available</p>";
      }
    })
    // Catch and log any errors from the API request
    .catch((error) => {
      // Log error to console with full details
      console.error("Error loading permissions:", error);
      // Display error message to user
      showToast("Failed to load permissions: " + error.message, "error");
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
  const name = document.getElementById("addUserName").value.trim();
  const age = parseInt(document.getElementById("addUserAge").value);
  const gender = document.getElementById("addUserGender").value;
  const employment_id = document
    .getElementById("addUserEmploymentId")
    .value.trim();
  const role = document.getElementById("addUserRole").value;
  const user_id = document.getElementById("addUserId").value.trim();
  const password = document.getElementById("addUserPassword").value;

  // Validate all required fields
  if (!name) {
    showToast("Please enter a full name", "error");
    return;
  }

  if (!age || age < 18 || age > 99) {
    showToast("Age must be between 18 and 99", "error");
    return;
  }

  if (!gender) {
    showToast("Please select a gender", "error");
    return;
  }

  if (!employment_id) {
    showToast("Please enter an employment ID", "error");
    return;
  }

  if (!role) {
    showToast("Please select a role", "error");
    return;
  }

  if (!user_id) {
    showToast("Please enter a user ID", "error");
    return;
  }

  if (!password || password.length < 6) {
    showToast("Password must be at least 6 characters", "error");
    return;
  }

  // Get the JWT token from localStorage for authentication
  const token = localStorage.getItem("auth_token");
  if (!token) {
    showToast("Session expired. Please login again.", "error");
    return;
  }

  // Make API request to create new user
  fetch("/api/superadmin/users", {
    // Set HTTP method to POST for creating new resource
    method: "POST",
    // Set header for JSON content type
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    // Set the request body with user data
    body: JSON.stringify({
      name,
      age,
      gender,
      employment_id,
      role,
      user_id,
      password,
    }),
  })
    // Handle the response from the API
    .then((response) => {
      // Parse response as JSON
      return response.json().then((data) => {
        return { ok: response.ok, status: response.status, data };
      });
    })
    // Handle the response data
    .then(({ ok, status, data }) => {
      // Check if response status indicates success
      if (ok) {
        // Show success toast notification
        showToast(
          `User "${name}" created successfully! They can now login.`,
          "success",
        );
        // Close the add user modal
        document.getElementById("addUserModal").style.display = "none";
        // Clear the form fields for next use
        document.getElementById("addUserForm").reset();
        // Reload users to reflect new user
        loadUsers();
      } else {
        // Show error with details from API
        const errorMsg = data.error || "Failed to create user";
        showToast(errorMsg, "error");
        console.error("API Error:", status, data);
      }
    })
    // Catch and log any errors from the API request
    .catch((error) => {
      // Log error to console
      console.error("Error creating user:", error);
      // Show error toast notification
      showToast(
        "Network error while creating user. Please try again.",
        "error",
      );
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
  const userId = document.getElementById("editUserId").value;
  // Get the name value from the form
  const name = document.getElementById("editUserName").value;
  // Get the age value from the form
  const age = parseInt(document.getElementById("editUserAge").value);
  // Validate age is within acceptable range (1-99)
  if (age < 1 || age > 99) {
    // Show error toast if age is invalid
    showToast("Age must be between 1 and 99", "error");
    // Exit function if age invalid
    return;
  }
  // Get the gender value from the form
  const gender = document.getElementById("editUserGender").value;
  // Get the employment ID value from the form
  const employment_id = document.getElementById("editUserEmploymentId").value;
  // Get the role value from the form
  const role = document.getElementById("editUserRole").value;
  // Get the password value from the form (optional field)
  const password = document.getElementById("editUserPassword").value;
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
    role,
  };
  // Check if password field has a value (only include if provided)
  if (password) {
    // Add password to request body if user entered one
    requestBody.password = password;
  }
  // Get the JWT token from localStorage for authentication
  const token = localStorage.getItem("auth_token");
  // Make API request to update user
  fetch(`/api/superadmin/users/${userId}`, {
    // Set HTTP method to PUT for updating resource
    method: "PUT",
    // Set header for JSON content type
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    // Set the request body with updated user data
    body: JSON.stringify(requestBody),
  })
    // Handle the response from the API
    .then((response) => {
      // Check if response status indicates success
      if (response.ok) {
        // Show success toast notification
        showToast("User updated successfully", "success");
        // Close the edit user modal
        document.getElementById("editUserModal").style.display = "none";
        // Clear the form fields
        document.getElementById("editUserForm").reset();
        // Reload users to reflect changes
        loadUsers();
      } else {
        // Show error toast if request failed
        showToast("Failed to update user", "error");
      }
    })
    // Catch and log any errors from the API request
    .catch((error) => {
      // Log error to console
      console.error("Error updating user:", error);
      // Show error toast notification
      showToast("Error updating user", "error");
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
  const projectName = document.getElementById("projectName").value;
  // Get the project location value from the form
  const projectLocation = document.getElementById("projectLocation").value;
  // Get the project city value from the form
  const projectCity = document.getElementById("projectCity").value;
  // Get the project description value from the form
  const projectDescription =
    document.getElementById("projectDescription").value;
  // Get the project start date from the form
  const projectStartDate = document.getElementById("projectStartDate").value;
  // Get the project end date from the form
  const projectEndDate = document.getElementById("projectEndDate").value;
  // Get the total budget from the form
  const projectTotalBudget =
    document.getElementById("projectTotalBudget").value;
  // Get the allocated budget from the form
  const projectAllocatedBudget = document.getElementById(
    "projectAllocatedBudget",
  ).value;
  // Get the contractor name from the form
  const contractorName = document.getElementById("contractorName").value;
  // Get the contractor contact number from the form
  const contractorContact = document.getElementById("contractorContact").value;
  // Get the contractor license number from the form
  const contractorLicense = document.getElementById("contractorLicense").value;
  // Get the contractor insurance number from the form
  const contractorInsurance = document.getElementById(
    "contractorInsurance",
  ).value;
  // Get the insurance details from the form
  const insuranceDetails = document.getElementById("insuranceDetails").value;
  // Get the safety certifications from the form
  const safetyCertifications = document.getElementById(
    "safetyCertifications",
  ).value;
  // Get the project manager ID value from the form
  const projectManager = document.getElementById("projectManagerSelect").value;
  const projectManagerId = parseInt(projectManager);
  // Get the site engineer IDs from the checkbox list
  const siteEngineers = getCheckedValues("siteEngineerSelect");
  // Get the supervisor IDs from the checkbox list (optional)
  const supervisors = getCheckedValues("supervisorSelect");
  // Get template assignment details
  const templateIds = getCheckedValues("templateSelect");
  const repetitionType = document.getElementById("repetitionType").value;
  const repetitionDays = document.getElementById("repetitionDays").value;
  if (!projectManager || isNaN(projectManagerId)) {
    showToast("Please select a project manager", "error");
    return;
  }

  if (!siteEngineers || siteEngineers.length === 0) {
    showToast("Please select at least one site engineer", "error");
    return;
  }

  if (!templateIds || templateIds.length === 0) {
    showToast("Please select at least one template", "error");
    return;
  }

  // Get the JWT token from localStorage for authentication
  const token = localStorage.getItem("auth_token");
  // Make API request to create new project with all construction fields
  fetch("/api/projects", {
    // Set HTTP method to POST for creating new resource
    method: "POST",
    // Set header for JSON content type
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
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
      work_status: "ongoing",
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
        insurance: contractorInsurance,
      },
      // Total budget amount
      total_budget: projectTotalBudget,
      // Allocated budget amount
      budget_allocated: projectAllocatedBudget,
      // Insurance details object
      insurance_details: {
        details: insuranceDetails,
      },
      // Safety certifications object
      safety_certifications: {
        certifications: safetyCertifications,
      },
      // Project manager ID
      projectManagers: [projectManagerId],
      // Site engineer IDs
      siteEngineers: siteEngineers,
      // Supervisor IDs (optional)
      supervisors: supervisors,
      // Template assignment details
      repetition_type: repetitionType || null,
      repetition_days: repetitionDays
        ? repetitionDays
            .split(",")
            .map((d) => parseInt(d.trim()))
            .filter((d) => !isNaN(d))
        : [],
    }),
  })
    // Handle the response from the API
    .then((response) => {
      // Check if response status indicates success
      if (response.ok) {
        return response.json().then((data) => {
          // Show success toast notification
          showToast("Project created successfully", "success");
          // Clear the form fields
          document.getElementById("createProjectForm").reset();
          clearCheckboxSelections("siteEngineerSelect");
          clearCheckboxSelections("supervisorSelect");
          clearCheckboxSelections("templateSelect");
          // Hide template repetition days input
          document.getElementById("repetitionDaysGroup").style.display = "none";
          // Reload projects to display the new project immediately
          loadProjects();

          // If templates were assigned, set them up for the project
          if (templateIds.length > 0 && data && data.id) {
            templateIds.forEach((templateId) => {
              assignTemplateToProject(
                data.id,
                templateId,
                repetitionType,
                repetitionDays,
              );
            });
          }
        });
      } else {
        return response.json().then((data) => {
          // Show error toast if request failed
          showToast(data.message || "Failed to create project", "error");
        });
      }
    })
    // Catch and log any errors from the API request
    .catch((error) => {
      // Log error to console
      console.error("Error creating project:", error);
      // Show error notification
      showToast("Error creating project", "error");
    });
}

/**
 * Load templates into the project creation form dropdown
 * Fetches all templates created by superadmin
 */
function loadTemplatesForDropdown() {
  const token = localStorage.getItem("auth_token");
  const templateContainer = document.getElementById("templateSelect");

  if (!templateContainer) {
    console.warn("Template select container not found");
    return;
  }

  fetch("/api/templates/library?status=pushed", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
    .then((response) => {
      if (!response.ok) throw new Error("Failed to load templates");
      return response.json();
    })
    .then((data) => {
      // Handle both response formats
      const templates =
        data.success && data.templates
          ? data.templates
          : Array.isArray(data)
            ? data
            : [];
      const items = templates.map((template) => ({
        id: template.id,
        name: template.name + (template.is_default ? " (Default)" : ""),
      }));
      renderCheckboxList("templateSelect", items, "No templates available.");
      console.log("Templates loaded in checkbox list:", templates.length);
    })
    .catch((error) => {
      console.error("Error loading templates for checkbox list:", error);
      renderCheckboxList("templateSelect", [], "Error loading templates.");
    });
}

/**
 * Assign a template to a project with repetition schedule
 * This creates the link between project and template
 */
function assignTemplateToProject(
  projectId,
  templateId,
  repetitionType,
  repetitionDays,
) {
  const token = localStorage.getItem("auth_token");

  // Parse repetition days if needed
  let repetitionDaysArray = [];
  if (repetitionDays) {
    if (typeof repetitionDays === "string") {
      repetitionDaysArray = repetitionDays
        .split(",")
        .map((d) => parseInt(d.trim()))
        .filter((d) => !isNaN(d));
    } else if (Array.isArray(repetitionDays)) {
      repetitionDaysArray = repetitionDays;
    }
  }

  fetch("/api/project-templates", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      project_id: projectId,
      template_id: parseInt(templateId),
      repetition_type: repetitionType,
      repetition_days: repetitionDaysArray,
    }),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        showToast("Template assigned to project successfully", "success");
      }
    })
    .catch((error) => {
      console.error("Error assigning template to project:", error);
    });
}

function buildProjectOptionsHtml() {
  const options = (allProjects || [])
    .filter((project) => !!project && !!project.id)
    .map(
      (project) =>
        `<option value="${project.id}">${project.name || `Project ${project.id}`}</option>`,
    )
    .join("");

  return `<option value="">Select project</option>${options}`;
}

function pushTemplateToProject(templateId, mode) {
  const token = localStorage.getItem("auth_token");
  const projectSelect = document.getElementById(`templatePushProject_${templateId}`);
  const repetitionTypeEl = document.getElementById(
    `templatePushRepetitionType_${templateId}`,
  );
  const repetitionDaysEl = document.getElementById(
    `templatePushRepetitionDays_${templateId}`,
  );
  const scheduledAtEl = document.getElementById(`templatePushSchedule_${templateId}`);

  if (!projectSelect || !projectSelect.value) {
    showToast("Please select a project to push", "error");
    return;
  }

  const payload = {
    project_id: Number(projectSelect.value),
    repetition_type: repetitionTypeEl ? repetitionTypeEl.value : "daily",
    repetition_days: repetitionDaysEl
      ? repetitionDaysEl.value
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean)
      : [],
  };

  if (mode === "schedule") {
    if (!scheduledAtEl || !scheduledAtEl.value) {
      showToast("Please pick a future date/time for schedule", "error");
      return;
    }
    payload.scheduled_at = new Date(scheduledAtEl.value).toISOString();
  }

  fetch(`/api/templates/${templateId}/push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })
    .then((response) => response.json())
    .then((data) => {
      if (!data.success) {
        showToast(data.error || "Failed to push template", "error");
        return;
      }
      showToast(
        data.scheduled ? "Template scheduled successfully" : "Template pushed successfully",
        "success",
      );
      loadTemplates();
    })
    .catch((error) => {
      console.error("Error pushing template:", error);
      showToast("Error pushing template", "error");
    });
}

function exportProjectWorkbook(projectId) {
  const token = localStorage.getItem("auth_token");
  fetch(`/api/project-templates/${projectId}/superadmin-export`, {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then((response) => {
      if (!response.ok) throw new Error("Export failed");
      return response.blob();
    })
    .then((blob) => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `project-${projectId}-superadmin-export.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      showToast("Project export downloaded", "success");
    })
    .catch((error) => {
      console.error("Error exporting project workbook:", error);
      showToast("Failed to export project workbook", "error");
    });
}

/**
 * Load users for populating dropdown menus in project creation form
 * Makes GET request to /api/superadmin/users and filters by role
 */
function loadUsersForDropdowns() {
  // Get the JWT token from localStorage for authentication
  const token = localStorage.getItem("auth_token");
  // Make API request to fetch all users
  fetch("/api/superadmin/users", {
    // Set request headers with Authorization token
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
    // Convert response to JSON
    .then((response) => response.json())
    // Handle the users data
    .then((users) => {
      // Filter users with project manager role
      const projectManagers = users.filter((u) => u.role === "project_manager");
      // Filter users with site engineer role
      const siteEngineers = users.filter((u) => u.role === "site_engineer");
      // Filter users with supervisor role
      const supervisors = users.filter((u) => u.role === "supervisor");
      // Get the project manager select element
      const pmSelect = document.getElementById("projectManagerSelect");
      // Clear existing options except the default one
      pmSelect.innerHTML = '<option value="">Select Project Manager</option>';
      // Loop through project managers and add as options
      projectManagers.forEach((pm) => {
        // Create a new option element
        const option = document.createElement("option");
        // Set the option value to the user ID
        option.value = pm.id;
        // Set the option text to the user name
        option.textContent = pm.name;
        // Append the option to the select element
        pmSelect.appendChild(option);
      });
      // Render site engineers checkbox list
      renderCheckboxList(
        "siteEngineerSelect",
        siteEngineers,
        "No site engineers found.",
      );
      // Render supervisors checkbox list
      renderCheckboxList(
        "supervisorSelect",
        supervisors,
        "No supervisors found.",
      );
    })
    // Catch and log any errors from the API request
    .catch((error) =>
      console.error("Error loading users for dropdowns:", error),
    );
}

/**
 * Setup navigation between different dashboard sections
 * Adds click handlers to nav links to show/hide sections
 */
function setupNavigation() {
  // Get all navigation links
  const navLinks = document.querySelectorAll(".nav-link");
  // Loop through each navigation link
  navLinks.forEach((link) => {
    // Add click event listener to the link
    link.addEventListener("click", function (e) {
      // Prevent default link behavior
      e.preventDefault();
      // Get the section name from the data attribute
      const sectionName = this.getAttribute("data-section");
      // Get the corresponding section element
      const section = document.getElementById(sectionName);
      // Check if section exists
      if (!section) {
        // Log error if section not found
        console.error("Section not found:", sectionName);
        // Exit function if section missing
        return;
      }
      // Get all content sections
      const sections = document.querySelectorAll(".content-section");
      // Hide all content sections by setting display to none
      sections.forEach((s) => {
        // Hide section with display none
        s.style.display = "none";
        // Remove active class from section
        s.classList.remove("active");
      });
      // Get all nav links
      const links = document.querySelectorAll(".nav-link");
      // Remove active class from all nav links
      links.forEach((l) => l.classList.remove("active"));
      // Show the selected section by setting display to block
      section.style.display = "block";
      // Add active class to section for styling
      section.classList.add("active");
      // Add active class to clicked nav link
      this.classList.add("active");
      // Load data when specific sections are clicked
      if (sectionName === "manageUsers") {
        // Load users when manage users section is clicked
        loadUsers();
      } else if (sectionName === "permissions") {
        // Load the permissions data
        loadPermissionsTable();
      } else if (sectionName === "projectsSection") {
        // Load projects when projects section is clicked
        loadProjects();
      } else if (sectionName === "documentsSection") {
        // Load documents when documents section is clicked
        loadAllDocuments();
      } else if (sectionName === "budgetExtensionsSection") {
        loadBudgetExtensionRequests();
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
  const addUserBtn = document.getElementById("addUserBtn");
  // Add click event listener to add user button
  if (addUserBtn) {
    // Show the add user modal when button clicked
    addUserBtn.addEventListener("click", function () {
      // Display the add user modal with flexbox
      document.getElementById("addUserModal").style.display = "flex";
    });
  }
  // Get the add user form
  const addUserForm = document.getElementById("addUserForm");
  // Add submit event listener to add user form
  if (addUserForm) {
    // Handle form submission
    addUserForm.addEventListener("submit", handleAddUser);
  }
  // Get the edit user form
  const editUserForm = document.getElementById("editUserForm");
  // Add submit event listener to edit user form
  if (editUserForm) {
    // Handle form submission
    editUserForm.addEventListener("submit", handleEditUser);
  }
  // Get the create project form
  const createProjectForm = document.getElementById("createProjectForm");
  // Add submit event listener to create project form
  if (createProjectForm) {
    // Handle form submission
    createProjectForm.addEventListener("submit", handleCreateProject);
  }

  // Set up template selection dropdown
  const templateSelect = document.getElementById("templateSelect");
  if (templateSelect) {
    // Load templates when page loads
    loadTemplatesForDropdown();
  }

  // Set up repetition type dropdown visibility
  const repetitionType = document.getElementById("repetitionType");
  if (repetitionType) {
    // Show/hide repetition days input based on selection
    repetitionType.addEventListener("change", function () {
      const repetitionDaysGroup = document.getElementById(
        "repetitionDaysGroup",
      );
      if (this.value === "weekly" || this.value === "monthly") {
        repetitionDaysGroup.style.display = "block";
      } else {
        repetitionDaysGroup.style.display = "none";
      }
    });
  }

  // Get the user search input
  const userSearch = document.getElementById("userSearch");
  // Add input event listener to user search
  if (userSearch) {
    // Filter users on each keystroke
    userSearch.addEventListener("input", filterUsers);
  }
  // Get the role filter select
  const roleFilter = document.getElementById("roleFilter");
  // Add change event listener to role filter
  if (roleFilter) {
    // Filter users when role selection changes
    roleFilter.addEventListener("change", filterUsers);
  }
  // Get the document project filter select
  const documentProjectFilter = document.getElementById(
    "documentProjectFilter",
  );
  // Add change event listener to document project filter
  if (documentProjectFilter) {
    // Filter documents when project selection changes
    documentProjectFilter.addEventListener("change", filterDocuments);
  }
  // Get the document type filter select
  const documentTypeFilter = document.getElementById("documentTypeFilter");
  // Add change event listener to document type filter
  if (documentTypeFilter) {
    // Filter documents when document type selection changes
    documentTypeFilter.addEventListener("change", filterDocuments);
  }
  const budgetRequestProjectFilter = document.getElementById(
    "budgetRequestProjectFilter",
  );
  if (budgetRequestProjectFilter) {
    budgetRequestProjectFilter.addEventListener(
      "change",
      loadBudgetExtensionRequests,
    );
  }
  const budgetRequestStatusFilter = document.getElementById(
    "budgetRequestStatusFilter",
  );
  if (budgetRequestStatusFilter) {
    budgetRequestStatusFilter.addEventListener(
      "change",
      loadBudgetExtensionRequests,
    );
  }
  // Get all modal close buttons
  const closeButtons = document.querySelectorAll(".close-btn, .close-button");
  // Loop through each close button
  closeButtons.forEach((btn) => {
    // Add click event listener to close button
    btn.addEventListener("click", function () {
      // Find parent modal and hide it
      const modal = this.closest(".modal");
      // Check if modal exists
      if (modal) {
        // Hide the modal
        modal.style.display = "none";
      }
    });
  });
  // Get all modals on the page
  const modals = document.querySelectorAll(".modal");
  // Loop through each modal
  modals.forEach((modal) => {
    // Add click event listener to modal element
    modal.addEventListener("click", function (e) {
      // Check if click was on modal backdrop (not content)
      if (e.target === this) {
        // Hide the modal if backdrop clicked
        this.style.display = "none";
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
  const token = localStorage.getItem("auth_token");
  // Make API request to fetch all projects
  fetch("/api/projects", {
    // Set request headers with Authorization token
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
    // Check if response is successful
    .then((response) => {
      // If response is not OK, throw an error
      if (!response.ok) {
        // Log the error status
        console.error("Response status:", response.status);
        // Throw error with status
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      // Convert response to JSON if successful
      return response.json();
    })
    // Handle the projects data
    .then((data) => {
      // Store all projects in global variable
      allProjects = data || [];
      // Log projects to console for debugging
      console.log("Projects loaded:", allProjects);
      // Reinitialize budget chart with new project data
      initBudgetChart();
      // Display ongoing projects
      displayOngoingProjects();
      // Display past projects
      displayPastProjects();
      populateBudgetRequestProjectFilter();
    })
    // Catch and log any errors from the API request
    .catch((error) => {
      // Log error to console with full details
      console.error("Error loading projects:", error);
      // Display error message to user
      showToast("Failed to load projects: " + error.message, "error");
    });
}

/**
 * Display ongoing/active projects in the Ongoing Projects tab
 * Filters allProjects array for work_status = 'ongoing' or 'active'
 */
function displayOngoingProjects() {
  // Filter projects with ongoing or active status
  const ongoingProjects = allProjects.filter(
    (p) => p.work_status === "ongoing" || p.work_status === "active",
  );
  // Get the ongoing projects list container
  const container = document.getElementById("ongoingProjectsList");
  // Clear any existing content
  container.innerHTML = "";
  // Check if there are ongoing projects
  if (!ongoingProjects || ongoingProjects.length === 0) {
    // Display message if no ongoing projects
    container.innerHTML =
      '<p style="text-align: center; color: #999; padding: 2rem;">No ongoing projects at this time</p>';
    // Exit function early
    return;
  }
  // Loop through each ongoing project
  ongoingProjects.forEach((project) => {
    // Create project card HTML for each project
    const projectCard = document.createElement("div");
    // Add CSS class for project card styling
    projectCard.className = "project-card";
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
          <span class="project-detail-value">${project.location || "-"}</span>
        </div>
        <!-- City detail -->
        <div class="project-detail">
          <span class="project-detail-label">City:</span>
          <span class="project-detail-value">${project.city || "-"}</span>
        </div>
        <!-- Start date detail -->
        <div class="project-detail">
          <span class="project-detail-label">Start Date:</span>
          <span class="project-detail-value">${project.start_date ? new Date(project.start_date).toLocaleDateString() : "-"}</span>
        </div>
        <!-- End date detail -->
        <div class="project-detail">
          <span class="project-detail-label">End Date:</span>
          <span class="project-detail-value">${project.end_date ? new Date(project.end_date).toLocaleDateString() : "-"}</span>
        </div>
        <!-- Total budget detail -->
        <div class="project-detail">
          <span class="project-detail-label">Budget:</span>
          <span class="project-detail-value">₹${project.total_budget ? parseFloat(project.total_budget).toLocaleString() : "0"}</span>
        </div>
        <!-- Contractor name detail -->
        <div class="project-detail">
          <span class="project-detail-label">Contractor:</span>
          <span class="project-detail-value">${project.contractor_name || "-"}</span>
        </div>
      </div>
      <div class="project-card-footer">
        <!-- View details button -->
        <button class="btn-view-details" onclick="viewProjectDetails(${project.id})">View Details</button>
        <button class="btn-view-details" onclick="openAssignTemplatesModal(${project.id}, '${(project.name || "").replace(/'/g, "\\'")}')">Assign Templates</button>
        <button class="btn-view-details" onclick="exportProjectWorkbook(${project.id})">Download Excel</button>
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
  const pastProjects = allProjects.filter(
    (p) => p.work_status === "past" || p.work_status === "completed",
  );
  // Get the past projects list container
  const container = document.getElementById("pastProjectsList");
  // Clear any existing content
  container.innerHTML = "";
  // Check if there are past projects
  if (!pastProjects || pastProjects.length === 0) {
    // Display message if no past projects
    container.innerHTML =
      '<p style="text-align: center; color: #999; padding: 2rem;">No past projects</p>';
    // Exit function early
    return;
  }
  // Loop through each past project
  pastProjects.forEach((project) => {
    // Create project card HTML for each project
    const projectCard = document.createElement("div");
    // Add CSS class for project card styling
    projectCard.className = "project-card";
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
          <span class="project-detail-value">${project.location || "-"}</span>
        </div>
        <!-- City detail -->
        <div class="project-detail">
          <span class="project-detail-label">City:</span>
          <span class="project-detail-value">${project.city || "-"}</span>
        </div>
        <!-- Start date detail -->
        <div class="project-detail">
          <span class="project-detail-label">Start Date:</span>
          <span class="project-detail-value">${project.start_date ? new Date(project.start_date).toLocaleDateString() : "-"}</span>
        </div>
        <!-- End date detail -->
        <div class="project-detail">
          <span class="project-detail-label">End Date:</span>
          <span class="project-detail-value">${project.end_date ? new Date(project.end_date).toLocaleDateString() : "-"}</span>
        </div>
        <!-- Total budget detail -->
        <div class="project-detail">
          <span class="project-detail-label">Budget:</span>
          <span class="project-detail-value">₹${project.total_budget ? parseFloat(project.total_budget).toLocaleString() : "0"}</span>
        </div>
        <!-- Contractor name detail -->
        <div class="project-detail">
          <span class="project-detail-label">Contractor:</span>
          <span class="project-detail-value">${project.contractor_name || "-"}</span>
        </div>
      </div>
      <div class="project-card-footer">
        <!-- View details button -->
        <button class="btn-view-details" onclick="viewProjectDetails(${project.id})">View Details</button>
        <button class="btn-view-details" onclick="openAssignTemplatesModal(${project.id}, '${(project.name || "").replace(/'/g, "\\'")}')">Assign Templates</button>
        <button class="btn-view-details" onclick="exportProjectWorkbook(${project.id})">Download Excel</button>
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
  const project = allProjects.find((p) => p.id === projectId);
  // Check if project was found
  if (!project) {
    // Show error message if project not found
    showToast("Project not found", "error");
    // Exit function
    return;
  }
  // Parse contractor details JSON if available
  const contractorDetails =
    typeof project.contractor_details === "string"
      ? JSON.parse(project.contractor_details)
      : project.contractor_details;
  // Parse insurance details JSON if available
  const insuranceDetails =
    typeof project.insurance_details === "string"
      ? JSON.parse(project.insurance_details)
      : project.insurance_details;
  // Parse safety certifications JSON if available
  const safetyCerts =
    typeof project.safety_certifications === "string"
      ? JSON.parse(project.safety_certifications)
      : project.safety_certifications;
  // Create detailed project information HTML
  const detailsHtml = `
    <div style="background: white; border-radius: 8px; padding: 2rem;">
      <!-- Project header with title -->
      <h2>${project.name}</h2>
      <!-- Project description -->
      <p style="color: #666; margin: 1rem 0;">${project.description || "No description provided"}</p>
      
      <!-- Basic Information Section -->
      <h3 style="color: var(--primary-color); margin-top: 1.5rem;">Basic Information</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 0.5rem; font-weight: 600;">Location:</td>
          <td style="padding: 0.5rem;">${project.location || "-"}</td>
        </tr>
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 0.5rem; font-weight: 600;">City:</td>
          <td style="padding: 0.5rem;">${project.city || "-"}</td>
        </tr>
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 0.5rem; font-weight: 600;">Status:</td>
          <td style="padding: 0.5rem;">${project.work_status || "-"}</td>
        </tr>
      </table>
      
      <!-- Timeline Section -->
      <h3 style="color: var(--primary-color); margin-top: 1.5rem;">Timeline</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 0.5rem; font-weight: 600;">Start Date:</td>
          <td style="padding: 0.5rem;">${project.start_date ? new Date(project.start_date).toLocaleDateString() : "-"}</td>
        </tr>
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 0.5rem; font-weight: 600;">End Date:</td>
          <td style="padding: 0.5rem;">${project.end_date ? new Date(project.end_date).toLocaleDateString() : "-"}</td>
        </tr>
      </table>
      
      <!-- Budget Section -->
      <h3 style="color: var(--primary-color); margin-top: 1.5rem;">Budget Details</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 0.5rem; font-weight: 600;">Total Budget:</td>
          <td style="padding: 0.5rem;">₹${project.total_budget ? parseFloat(project.total_budget).toLocaleString() : "0"}</td>
        </tr>
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 0.5rem; font-weight: 600;">Allocated Budget:</td>
          <td style="padding: 0.5rem;">₹${project.budget_allocated ? parseFloat(project.budget_allocated).toLocaleString() : "0"}</td>
        </tr>
      </table>
      
      <!-- Contractor Section -->
      <h3 style="color: var(--primary-color); margin-top: 1.5rem;">Contractor Information</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 0.5rem; font-weight: 600;">Name:</td>
          <td style="padding: 0.5rem;">${project.contractor_name || "-"}</td>
        </tr>
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 0.5rem; font-weight: 600;">Contact:</td>
          <td style="padding: 0.5rem;">${project.contractor_contact || "-"}</td>
        </tr>
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 0.5rem; font-weight: 600;">License:</td>
          <td style="padding: 0.5rem;">${project.contractor_license || "-"}</td>
        </tr>
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 0.5rem; font-weight: 600;">Insurance #:</td>
          <td style="padding: 0.5rem;">${project.contractor_insurance_number || "-"}</td>
        </tr>
      </table>
      
      <!-- Safety Section -->
      <h3 style="color: var(--primary-color); margin-top: 1.5rem;">Safety & Compliance</h3>
      <p style="padding: 0.5rem; white-space: pre-wrap;">${safetyCerts && Object.keys(safetyCerts).length > 0 ? JSON.stringify(safetyCerts, null, 2) : "No safety certifications recorded"}</p>
    </div>
  `;
  // Remove existing modal if any
  const existingModal = document.getElementById("viewProjectDetailsModal");
  if (existingModal) existingModal.remove();

  // Create modal container
  const modal = document.createElement("div");
  modal.id = "viewProjectDetailsModal";
  modal.className = "modal";
  modal.style.display = "flex";
  modal.style.justifyContent = "center";
  modal.style.alignItems = "center";
  modal.style.position = "fixed";
  modal.style.top = "0";
  modal.style.left = "0";
  modal.style.width = "100%";
  modal.style.height = "100%";
  modal.style.backgroundColor = "rgba(0,0,0,0.5)";
  modal.style.zIndex = "1000";

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
  modal.addEventListener("click", function (e) {
    if (e.target === this) {
      this.remove();
    }
  });

  // Display the detailed information in a simple alert (could be modal in production)
  showToast("Project details loaded successfully.", "success");
}

// FIX: Bug7/Feature5 - Assign templates for existing projects with prechecked active assignments.
async function openAssignTemplatesModal(projectId, projectName) {
  const token = localStorage.getItem("auth_token");
  if (!token) return;

  let modal = document.getElementById("assignTemplatesModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "assignTemplatesModal";
    modal.className = "modal";
    modal.style.display = "none";
    modal.style.justifyContent = "center";
    modal.style.alignItems = "center";
    modal.innerHTML = `
      <div class="modal-dialog" style="max-width: 760px; width: 95%; max-height: 85vh; overflow-y: auto; background: #fff; border-radius: 10px;">
        <div class="modal-header" style="padding: 18px 22px; border-bottom: 1px solid #eee; display:flex; justify-content: space-between; align-items:center;">
          <h3 style="margin:0;">Assign Templates</h3>
          <button type="button" class="close-btn" onclick="document.getElementById('assignTemplatesModal').style.display='none';" style="border:none;background:none;font-size:24px;cursor:pointer;">×</button>
        </div>
        <div style="padding: 20px;">
          <div style="margin-bottom: 12px;"><strong>Project:</strong> <span id="assignTemplatesProjectName"></span></div>
          <div id="assignTemplatesCheckboxes" style="display:grid; gap:8px; margin-bottom:16px;"></div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
            <div>
              <label>Repetition Type</label>
              <select id="assignTemplatesRepetitionType" style="width:100%; padding:8px; border:1px solid #ddd; border-radius:4px;">
                <option value="daily">daily</option>
                <option value="weekly">weekly</option>
                <option value="monthly">monthly</option>
              </select>
            </div>
            <div>
              <label>Repetition Days (comma-separated)</label>
              <input id="assignTemplatesRepetitionDays" type="text" placeholder="Mon,Tue,Wed" style="width:100%; padding:8px; border:1px solid #ddd; border-radius:4px;" />
            </div>
          </div>
          <div style="margin-bottom:16px;">
            <button class="btn btn-primary" onclick="assignCheckedTemplatesToProject()">Assign</button>
          </div>
          <h4 style="margin:0 0 8px 0;">Already Assigned</h4>
          <div id="assignedTemplatesList" style="display:grid; gap:8px;"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.style.display = "none";
    });
  }

  modal.dataset.projectId = String(projectId);
  document.getElementById("assignTemplatesProjectName").textContent =
    projectName;

  const [templatesRes, assignedRes] = await Promise.all([
    fetch("/api/templates", { headers: { Authorization: `Bearer ${token}` } }),
    fetch(`/api/project-templates/${projectId}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  ]);

  const templatesData = await templatesRes.json();
  const assignedData = await assignedRes.json();

  const templates = templatesData.templates || templatesData.data || [];
  const assigned = assignedData.data || [];
  const assignedTemplateIds = new Set(assigned.map((a) => a.template_id));

  const boxes = document.getElementById("assignTemplatesCheckboxes");
  boxes.innerHTML =
    templates
      .map(
        (t) => `
    <label style="display:flex; align-items:center; gap:8px; padding:8px; border:1px solid #eee; border-radius:6px;">
      <input type="checkbox" value="${t.id}" ${assignedTemplateIds.has(t.id) ? "checked" : ""} />
      <span>${t.name}</span>
    </label>
  `,
      )
      .join("") ||
    '<div style="color:#999;">No active templates available.</div>';

  const assignedList = document.getElementById("assignedTemplatesList");
  assignedList.innerHTML =
    assigned
      .map(
        (a) => `
    <div style="display:flex; justify-content:space-between; align-items:center; border:1px solid #eee; border-radius:6px; padding:8px 10px;">
      <span>${a.template?.name || a.name || "Template"}</span>
      <button class="btn btn-small btn-danger" onclick="removeAssignedTemplate(${a.id}, ${projectId})">Remove</button>
    </div>
  `,
      )
      .join("") || '<div style="color:#999;">No assigned templates.</div>';

  modal.style.display = "flex";
}

// FIX: Bug7 - Assign all checked templates to selected project.
async function assignCheckedTemplatesToProject() {
  const modal = document.getElementById("assignTemplatesModal");
  const projectId = parseInt(modal?.dataset.projectId || "0");
  if (!projectId) return;

  const repetitionType = document.getElementById(
    "assignTemplatesRepetitionType",
  ).value;
  const repetitionDaysRaw = document.getElementById(
    "assignTemplatesRepetitionDays",
  ).value;
  const repetitionDays = repetitionDaysRaw
    ? repetitionDaysRaw
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean)
    : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const checked = Array.from(
    document.querySelectorAll(
      "#assignTemplatesCheckboxes input[type='checkbox']:checked",
    ),
  )
    .map((el) => parseInt(el.value))
    .filter((v) => !isNaN(v));

  if (checked.length === 0) {
    showToast("Select at least one template", "error");
    return;
  }

  await Promise.all(
    checked.map((templateId) =>
      assignTemplateToProject(
        projectId,
        templateId,
        repetitionType,
        repetitionDays,
      ),
    ),
  );

  showToast("Templates assigned successfully", "success");
  openAssignTemplatesModal(
    projectId,
    document.getElementById("assignTemplatesProjectName").textContent ||
      "Project",
  );
}

// FIX: Feature5 - Remove assignment by project_templates.id and reload modal list.
async function removeAssignedTemplate(projectTemplateId, projectId) {
  const token = localStorage.getItem("auth_token");
  const response = await fetch(`/api/project-templates/${projectTemplateId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    showToast("Failed to remove template assignment", "error");
    return;
  }

  showToast("Template assignment removed", "success");
  openAssignTemplatesModal(
    projectId,
    document.getElementById("assignTemplatesProjectName").textContent ||
      "Project",
  );
}

/**
 * Switch the modal to show a form for editing the project
 */
window.editProjectDetails = function (projectId) {
  const project = allProjects.find((p) => p.id === projectId);
  if (!project) return;
  const content = document.getElementById("viewProjectContent");

  const roStyle =
    "width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; background-color: #f5f5f5; color: #666; cursor: not-allowed;";
  const rwStyle =
    "width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;";

  const nameAttr = project.name
    ? `readonly style="${roStyle}"`
    : `style="${rwStyle}"`;
  const locAttr = project.location
    ? `readonly style="${roStyle}"`
    : `style="${rwStyle}"`;
  const cityAttr = project.city
    ? `readonly style="${roStyle}"`
    : `style="${rwStyle}"`;

  const startDateVal = project.start_date
    ? new Date(project.start_date).toISOString().split("T")[0]
    : "";
  const startDateAttr = startDateVal
    ? `readonly style="${roStyle}"`
    : `style="${rwStyle}"`;

  const endDateVal = project.end_date
    ? new Date(project.end_date).toISOString().split("T")[0]
    : "";
  const endDateAttr = endDateVal
    ? `readonly style="${roStyle}"`
    : `style="${rwStyle}"`;

  const budgetAttr =
    project.total_budget && parseFloat(project.total_budget) > 0
      ? `readonly style="${roStyle}"`
      : `style="${rwStyle}"`;

  content.innerHTML = `
    <h2 style="margin-bottom: 1rem;">Edit Project: ${project.name}</h2>
    <form id="editProjectFormInModal" onsubmit="submitEditProject(event, ${project.id})">
      <div class="form-group" style="margin-bottom: 1rem;">
        <label style="display: block; font-weight: 600; margin-bottom: 0.5rem; text-align: left;">Project Name *</label>
        <input type="text" name="name" value="${project.name || ""}" required ${nameAttr}>
      </div>
      <div class="form-group" style="margin-bottom: 1rem;">
        <label style="display: block; font-weight: 600; margin-bottom: 0.5rem; text-align: left;">Location *</label>
        <input type="text" name="location" value="${project.location || ""}" required ${locAttr}>
      </div>
      <div class="form-group" style="margin-bottom: 1rem;">
        <label style="display: block; font-weight: 600; margin-bottom: 0.5rem; text-align: left;">City *</label>
        <input type="text" name="city" value="${project.city || ""}" required ${cityAttr}>
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
        <input type="number" name="total_budget" value="${project.total_budget || ""}" step="0.01" ${budgetAttr}>
      </div>
      <div class="form-group" style="margin-bottom: 1rem;">
        <label style="display: block; font-weight: 600; margin-bottom: 0.5rem; text-align: left;">Allocated Budget (Phase wise) (₹)</label>
        <input type="number" name="budget_allocated" value="${project.budget_allocated || ""}" step="0.01" style="${rwStyle}" placeholder="Enter allocated budget">
      </div>
      <div class="form-group" style="margin-bottom: 1rem;">
        <label style="display: block; font-weight: 600; margin-bottom: 0.5rem; text-align: left;">Contractor Name</label>
        <input type="text" name="contractor_name" value="${project.contractor_name || ""}" style="${rwStyle}">
      </div>
      <div style="margin-top: 1.5rem; text-align: right;">
        <button type="button" class="btn btn-secondary" onclick="viewProjectDetails(${project.id})" style="padding: 10px 20px; background: #eee; border: none; border-radius: 6px; cursor: pointer; margin-right: 10px;">Cancel</button>
        <button type="submit" class="btn btn-primary" style="background: linear-gradient(135deg, #1a5490, #2e7db1); color: white; border: none; padding: 10px 20px; border-radius: 6px; font-weight: 600; cursor: pointer;">Save Changes</button>
      </div>
    </form>
  `;
};

/**
 * Handle submit for editing project
 */
window.submitEditProject = function (event, projectId) {
  event.preventDefault();
  const formData = new FormData(event.target);
  const data = Object.fromEntries(formData.entries());

  // Format dates appropriately or omit if empty
  if (!data.start_date) delete data.start_date;
  if (!data.end_date) delete data.end_date;
  if (!data.total_budget) delete data.total_budget;

  const token = localStorage.getItem("auth_token");
  fetch("/api/projects/" + projectId, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  })
    .then((response) => {
      if (!response.ok) throw new Error("Failed to update project");
      return response.json();
    })
    .then((updatedProject) => {
      showToast("Project updated successfully", "success");
      document.getElementById("viewProjectDetailsModal").remove();
      loadProjects(); // refresh projects list
    })
    .catch((error) => {
      console.error("Error updating project:", error);
      showToast("Error updating project: " + error.message, "error");
    });
};

/**
 * Handle project tab switching
 * Shows selected tab content and hides others
 */
function setupProjectTabs() {
  // Get all tab buttons
  const tabButtons = document.querySelectorAll(".tab-button");
  // Loop through each tab button
  tabButtons.forEach((button) => {
    // Add click event listener to each tab button
    button.addEventListener("click", function () {
      // Get the tab name from data attribute
      const tabName = this.getAttribute("data-tab");
      // Get all tab content divs
      const tabContents = document.querySelectorAll(".tab-content");
      // Loop through all tab contents
      tabContents.forEach((content) => {
        // Hide all tab contents
        content.style.display = "none";
        // Remove active class from all tabs
        content.classList.remove("active");
      });
      // Get all tab buttons
      const buttons = document.querySelectorAll(".tab-button");
      // Loop through all buttons to remove active class
      buttons.forEach((btn) => {
        // Remove active class from all buttons
        btn.classList.remove("active");
      });
      // Show the selected tab content
      document.getElementById(tabName).style.display = "block";
      // Add active class to the selected tab content
      document.getElementById(tabName).classList.add("active");
      // Add active class to the clicked button
      this.classList.add("active");
    });
  });
}

/**
 * Load all documents from all projects
 * Fetches documents with project names and uploader information
 */
function loadAllDocuments() {
  // Get the JWT token from localStorage for authentication
  const token = localStorage.getItem("auth_token");

  // Get user role from localStorage
  const userRole = localStorage.getItem("user_role");

  // Determine if we should filter documents by assigned projects
  // Superadmin can see all documents, others see only their assigned projects
  const shouldFilterByAssigned = userRole !== "superadmin" ? "true" : "false";

  // Make API request to fetch documents with optional project filtering
  const url =
    "/api/documents" +
    (shouldFilterByAssigned === "true" ? "?filter_by_assigned=true" : "");

  fetch(url, {
    // Set request headers with Authorization token
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
    // Check if response is successful
    .then((response) => {
      // If response is not OK, throw an error
      if (!response.ok) {
        // Log the error status
        console.error("Response status:", response.status);
        // Throw error with status
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      // Convert response to JSON if successful
      return response.json();
    })
    // Handle the documents data
    .then((data) => {
      // Store all documents in global variable
      allDocuments = data || [];
      // Log documents to console for debugging
      console.log("Documents loaded:", allDocuments);
      // Populate project filter dropdown with unique projects
      populateDocumentProjectFilter();
      // Display all documents in the table
      displayDocumentsTable(allDocuments);
    })
    // Catch and log any errors from the API request
    .catch((error) => {
      // Log error to console with full details
      console.error("Error loading documents:", error);
      // Display error message to user
      showToast("Failed to load documents: " + error.message, "error");
    });
}

/**
 * Populate the project filter dropdown with unique project names
 * Gets list of unique projects from allDocuments array
 */
function populateDocumentProjectFilter() {
  // Get the project filter select element
  const projectFilter = document.getElementById("documentProjectFilter");
  // Get unique project names from all documents
  const uniqueProjects = new Map();
  allDocuments.forEach((doc) => {
    if (!doc || doc.project_id === null || doc.project_id === undefined) return;
    if (!uniqueProjects.has(doc.project_id)) {
      uniqueProjects.set(doc.project_id, doc.project_name || "Unknown Project");
    }
  });
  // Clear existing options except the first one
  while (projectFilter.options.length > 1) {
    // Remove options at index 1
    projectFilter.remove(1);
  }
  // Loop through each unique project
  uniqueProjects.forEach((name, id) => {
    // Create new option element
    const option = document.createElement("option");
    // Set the option value to project ID
    option.value = id;
    // Set the option text to project name
    option.textContent = name;
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
  const tableBody = document.getElementById("documentsTable");
  // Clear any existing rows in the table
  tableBody.innerHTML = "";
  // Check if there are documents to display
  if (!documents || documents.length === 0) {
    // Create a message row if no documents exist
    tableBody.innerHTML =
      '<tr><td colspan="7" style="text-align: center;">No documents found</td></tr>';
    // Exit function early if no documents
    return;
  }
  // Loop through each document to create table rows
  documents.forEach((doc) => {
    // Create a new table row element
    const row = document.createElement("tr");
    // Get file extension from original filename
    const fileExt = doc.original_name
      ? doc.original_name.split(".").pop().toUpperCase()
      : "UNKNOWN";
    const docStatus = String(doc.doc_status || "draft").toLowerCase();
    const statusLabel = docStatus
      ? docStatus.charAt(0).toUpperCase() + docStatus.slice(1)
      : "Draft";
    const statusClass =
      docStatus === "approved"
        ? "success"
        : docStatus === "rejected"
          ? "danger"
          : docStatus === "submitted" || docStatus === "pending"
            ? "warning"
            : "secondary";
    // Set the HTML content of the row with document data
    row.innerHTML = `
      <td>${doc.project_name || "Unknown"}</td>
      <td>${doc.title || doc.original_name || "Untitled"}</td>
      <td>${doc.uploaded_by_name || "Unknown"}</td>
      <td>${new Date(doc.created_at).toLocaleDateString()}</td>
      <td><span class="badge badge-${fileExt === "PDF" ? "danger" : fileExt === "ZIP" ? "info" : "warning"}">${fileExt}</span></td>
      <td><span class="badge badge-${statusClass}">${statusLabel}</span></td>
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
  const projectValue = document.getElementById("documentProjectFilter").value;
  // Get the document type filter select value
  const typeValue = document.getElementById("documentTypeFilter").value;
  // Filter documents based on project and type criteria
  const filteredDocuments = allDocuments.filter((doc) => {
    // Check if document project matches filter (or all projects if filter is empty)
    const matchesProject = !projectValue || doc.project_id == projectValue;
    // Check if document type matches filter (or all types if filter is empty)
    let matchesType = true;
    // Only check type if filter has a value
    if (typeValue) {
      // Get the file extension
      const fileExt = doc.original_name
        ? doc.original_name.split(".").pop().toLowerCase()
        : "";
      // Check based on type filter
      if (typeValue === "pdf" && fileExt !== "pdf") {
        matchesType = false;
      } else if (
        typeValue === "image" &&
        !["png", "jpg", "jpeg", "gif"].includes(fileExt)
      ) {
        matchesType = false;
      } else if (
        typeValue === "archive" &&
        !["zip", "rar", "7z"].includes(fileExt)
      ) {
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
  const link = document.createElement("a");
  // Set the href to the file path
  link.href = filePath;
  // Set the download attribute with filename
  link.download = fileName || "document";
  // Append link to body temporarily
  document.body.appendChild(link);
  // Click the link to trigger download
  link.click();
  // Remove the link from body
  document.body.removeChild(link);
  // Show success notification
  showToast("Download started: " + (fileName || "document"), "success");
}

function populateBudgetRequestProjectFilter() {
  const filter = document.getElementById("budgetRequestProjectFilter");
  if (!filter) return;

  while (filter.options.length > 1) {
    filter.remove(1);
  }

  allProjects.forEach((project) => {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.name;
    filter.appendChild(option);
  });
}

function loadBudgetExtensionRequests() {
  const token = localStorage.getItem("auth_token");
  const projectFilter = document.getElementById("budgetRequestProjectFilter");
  const statusFilter = document.getElementById("budgetRequestStatusFilter");

  const projectValue = projectFilter ? projectFilter.value : "";
  const statusValue = statusFilter ? statusFilter.value : "";

  const params = new URLSearchParams();
  if (projectValue) params.append("project_id", projectValue);
  if (statusValue) params.append("status", statusValue);

  const url = `/api/budget-extensions/admin${params.toString() ? "?" + params.toString() : ""}`;

  fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
    .then((response) => response.json())
    .then((data) => {
      populateBudgetRequestProjectFilter();
      displayBudgetExtensionRequests(Array.isArray(data) ? data : []);
    })
    .catch((error) => {
      console.error("Error loading budget requests:", error);
      showToast("Failed to load budget requests", "error");
    });
}

function displayBudgetExtensionRequests(requests) {
  const tableBody = document.getElementById("budgetRequestsTable");
  if (!tableBody) return;

  if (!requests || requests.length === 0) {
    tableBody.innerHTML =
      '<tr><td colspan="8" style="text-align:center;">No requests found</td></tr>';
    return;
  }

  tableBody.innerHTML = requests
    .map((request) => {
      const statusClass =
        request.status === "approved"
          ? "badge-success"
          : request.status === "rejected"
            ? "badge-danger"
            : "badge-warning";
      const percentUsed = Number(request.percent_used_before || 0).toFixed(1);
      const actionButtons =
        request.status === "pending"
          ? `<button class="btn btn-small btn-success" onclick="approveBudgetExtension(${request.id})">Approve</button>
             <button class="btn btn-small btn-danger" onclick="rejectBudgetExtension(${request.id})">Reject</button>`
          : "-";
      return `
        <tr>
          <td>${request.project_name || "Unknown"}</td>
          <td>${request.requested_by_name || "Unknown"}</td>
          <td>${formatCurrency(request.budget_before)}</td>
          <td>${formatCurrency(request.requested_amount)}</td>
          <td>${percentUsed}% (${formatCurrency(request.spent_before)})</td>
          <td><span class="badge ${statusClass}">${request.status}</span></td>
          <td>${new Date(request.created_at).toLocaleDateString()}</td>
          <td>${actionButtons}</td>
        </tr>
      `;
    })
    .join("");
}

function approveBudgetExtension(requestId) {
  if (!confirm("Approve this budget extension request?")) return;
  const note = prompt("Approval note (optional):", "Approved") || "";

  const token = localStorage.getItem("auth_token");
  fetch(`/api/budget-extensions/${requestId}/approve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ review_note: note }),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.error) throw new Error(data.error);
      showToast("Budget extension approved", "success");
      loadBudgetExtensionRequests();
      loadProjects();
    })
    .catch((error) => {
      console.error("Approval error:", error);
      showToast(error.message || "Failed to approve", "error");
    });
}

function rejectBudgetExtension(requestId) {
  if (!confirm("Reject this budget extension request?")) return;
  const note = prompt("Rejection note (optional):", "Rejected") || "";

  const token = localStorage.getItem("auth_token");
  fetch(`/api/budget-extensions/${requestId}/reject`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ review_note: note }),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.error) throw new Error(data.error);
      showToast("Budget extension rejected", "warning");
      loadBudgetExtensionRequests();
    })
    .catch((error) => {
      console.error("Rejection error:", error);
      showToast(error.message || "Failed to reject", "error");
    });
}

/**
 * Logout the current user and redirect to login page
 * Makes POST request to /api/auth/logout
 */
function logoutUser() {
  // Make API request to logout
  fetch("/api/auth/logout", {
    // Set HTTP method to POST
    method: "POST",
  })
    // Handle the response
    .then((response) => {
      // Clear authentication token from localStorage
      localStorage.removeItem("auth_token");
      // Redirect to login page after logout
      window.location.href = "/";
    })
    // Catch and log any errors
    .catch((error) => {
      // Log error to console
      console.error("Error logging out:", error);
      // Clear localStorage anyway
      localStorage.removeItem("auth_token");
      // Redirect to home page
      window.location.href = "/";
    });
}

/**
 * Display a toast notification message to the user
 * @param {string} message - The message to display
 * @param {string} type - The type of notification ('success', 'error', 'info')
 */
function showToast(message, type) {
  // Get the toast container element
  const toastContainer = document.getElementById("toastContainer");
  // Create a new div element for the toast
  const toast = document.createElement("div");
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
  templateType: "form",
  rowLimit: null,
};

// FIX: Bug2 - Inline draft state for adding a field without prompt dialogs.
let templateFieldDraft = {
  name: "",
  label: "",
  type: "text",
  required: false,
  options: "",
};


function normalizeTableColumnsForDesigner(columnsInput) {
  if (!Array.isArray(columnsInput)) return [];

  return columnsInput
    .map((column, index) => {
      if (typeof column === "string") {
        const name = column.trim();
        if (!name) return null;
        return {
          id: `column_${Date.now()}_${index}`,
          name,
          isLocked: false,
          fixedValue: null,
          rowFixedValues: {},
        };
      }

      if (!column || typeof column !== "object") return null;
      const name = String(column.name || "").trim();
      if (!name) return null;

      return {
        id: String(column.id || `column_${Date.now()}_${index}`),
        name,
        isLocked: !!column.isLocked,
        fixedValue:
          column.fixedValue === undefined || column.fixedValue === null
            ? null
            : String(column.fixedValue),
        rowFixedValues:
          column.rowFixedValues && typeof column.rowFixedValues === "object"
            ? column.rowFixedValues
            : {},
      };
    })
    .filter(Boolean)
    .map((column) => ({
      ...column,
      isLocked: !!column.isLocked,
    }));
}

function parseRowFixedValuesInput(raw) {
  if (!raw || !String(raw).trim()) return {};

  const result = {};
  String(raw)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const parts = entry.split(":");
      if (parts.length !== 2) return;
      const oneBasedIndex = parseInt(parts[0].trim(), 10);
      if (!Number.isInteger(oneBasedIndex) || oneBasedIndex <= 0) return;
      result[String(oneBasedIndex - 1)] = parts[1].trim();
    });

  return result;
}

function stringifyRowFixedValues(map) {
  if (!map || typeof map !== "object") return "";
  return Object.keys(map)
    .filter((key) => /^\d+$/.test(key))
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => `${Number(key) + 1}:${map[key]}`)
    .join(", ");
}

function summarizeTableColumnConfig(column) {
  const flags = [];

  if (column.isLocked) flags.push("Locked");
  if (column.fixedValue !== null && column.fixedValue !== undefined && column.fixedValue !== "") {
    flags.push(`Fixed=${column.fixedValue}`);
  }
  const rowFixedSummary = stringifyRowFixedValues(column.rowFixedValues);
  if (rowFixedSummary) {
    flags.push(`Row fixed: ${rowFixedSummary}`);
  }
  return flags.length > 0 ? flags.join(" | ") : "Editable";
}

/**
 * Update template type UI - switch between Simple Fields and Rows & Columns
 */
function updateTemplateTypeUI() {
  const templateType = document.querySelector(
    'input[name="templateType"]:checked',
  ).value;
  templateCreationState.templateType = templateType;

  const simpleFieldsSection = document.getElementById("simpleFieldsSection");
  const tableColumnsSection = document.getElementById("tableColumnsSection");

  if (templateType === "form") {
    simpleFieldsSection.style.display = "block";
    tableColumnsSection.style.display = "none";
  } else {
    simpleFieldsSection.style.display = "none";
    tableColumnsSection.style.display = "block";
    renderColumnsContainer();
  }

  updateTemplatePreview();
}

/**
 * Add a new field to the template
 */
function addTemplateField() {
  // FIX: Bug2 - Validate and add field from inline form.
  const name = (templateFieldDraft.name || "").trim();
  const label = (templateFieldDraft.label || "").trim();
  const type = templateFieldDraft.type || "text";
  const required = !!templateFieldDraft.required;

  if (!name || !/^[a-zA-Z0-9_]+$/.test(name)) {
    showToast("Field Name must be letters/numbers/underscore only", "error");
    return;
  }

  if (!label) {
    showToast("Display Label is required", "error");
    return;
  }

  let options = [];
  if (type === "select") {
    options = (templateFieldDraft.options || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    if (options.length === 0) {
      showToast("Select field requires options (comma-separated)", "error");
      return;
    }
  }

  const newField = {
    id: "field_" + Date.now(),
    name,
    label,
    type,
    required,
    options,
  };

  templateCreationState.fields.push(newField);
  templateFieldDraft = {
    name: "",
    label: "",
    type: "text",
    required: false,
    options: "",
  };
  renderFieldsContainer();
  updateTemplatePreview();
  showToast(`Field "${label}" added`, "success");
}

// FIX: Bug2 - Inline input state update for field builder.
function onTemplateFieldDraftChange(key, value) {
  templateFieldDraft[key] = value;

  // FIX: Bug2 - Avoid re-render on each keypress so cursor/focus does not jump.
  if (key === "type") {
    const optionsInput = document.getElementById("templateFieldOptionsInput");
    if (optionsInput) {
      optionsInput.disabled = value !== "select";
      if (value !== "select") {
        templateFieldDraft.options = "";
        optionsInput.value = "";
      }
    }
  }
}

/**
 * Delete a field from the template
 */
function deleteTemplateField(fieldId) {
  templateCreationState.fields = templateCreationState.fields.filter(
    (f) => f.id !== fieldId,
  );
  renderFieldsContainer();
  updateTemplatePreview();
  showToast("Field deleted", "success");
}

/**
 * Render the fields container with all fields
 */
function renderFieldsContainer() {
  const container = document.getElementById("fieldsContainer");
  if (!container) return;

  // FIX: Bug2 - Inline field builder with validation-friendly inputs.
  const inlineBuilder = `
    <div style="display: grid; grid-template-columns: 1.5fr 1.5fr 1fr 0.7fr 1.3fr auto; gap: 10px; padding: 12px 15px; border-bottom: 1px solid #e0e0e0; background: #f8fbff; align-items: center;">
      <input type="text" placeholder="field_name" value="${templateFieldDraft.name}" oninput="onTemplateFieldDraftChange('name', this.value)" style="padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px;" />
      <input type="text" placeholder="Display Label" value="${templateFieldDraft.label}" oninput="onTemplateFieldDraftChange('label', this.value)" style="padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px;" />
      <select id="templateFieldTypeSelect" onchange="onTemplateFieldDraftChange('type', this.value)" style="padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px;">
        <option value="text" ${templateFieldDraft.type === "text" ? "selected" : ""}>text</option>
        <option value="number" ${templateFieldDraft.type === "number" ? "selected" : ""}>number</option>
        <option value="decimal" ${templateFieldDraft.type === "decimal" ? "selected" : ""}>decimal</option>
        <option value="date" ${templateFieldDraft.type === "date" ? "selected" : ""}>date</option>
        <option value="textarea" ${templateFieldDraft.type === "textarea" ? "selected" : ""}>textarea</option>
        <option value="select" ${templateFieldDraft.type === "select" ? "selected" : ""}>select</option>
      </select>
      <label style="display:flex; align-items:center; gap:6px; font-size:12px;"><input type="checkbox" ${templateFieldDraft.required ? "checked" : ""} onchange="onTemplateFieldDraftChange('required', this.checked)" /> Req</label>
      <input id="templateFieldOptionsInput" type="text" placeholder="option1, option2" value="${templateFieldDraft.options}" ${templateFieldDraft.type === "select" ? "" : "disabled"} oninput="onTemplateFieldDraftChange('options', this.value)" style="padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px;" />
      <button type="button" onclick="addTemplateField()" style="background: #1a5490; color: white; border: none; padding: 8px 10px; border-radius: 4px; cursor: pointer; font-size: 12px;">Add</button>
    </div>
  `;

  if (templateCreationState.fields.length === 0) {
    container.innerHTML =
      inlineBuilder +
      '<div style="padding: 20px; color: #999; text-align: center;">No fields added yet.</div>';
    return;
  }

  container.innerHTML =
    inlineBuilder +
    templateCreationState.fields
      .map(
        (field) => `
    <div style="display: grid; grid-template-columns: 2fr 2fr 1.2fr 1fr; gap: 12px; padding: 12px 15px; border-bottom: 1px solid #e0e0e0; align-items: center;">
      <div style="font-size: 13px; color: #333; font-weight: 500;">${field.name}${field.required ? " *" : ""}</div>
      <div style="font-size: 13px; color: #666;">${field.label}</div>
      <div style="font-size: 13px; color: #999;">${field.type}${field.type === "select" ? ` (${(field.options || []).join(", ")})` : ""}</div>
      <div style="text-align: center;">
        <button type="button" onclick="deleteTemplateField('${field.id}')" 
          style="background: #ff6b6b; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; transition: all 0.3s;"
          onmouseover="this.style.background='#ff5252';"
          onmouseout="this.style.background='#ff6b6b';">
          Delete
        </button>
      </div>
    </div>
  `,
      )
      .join("");
}

/**
 * Add a new column to the table template
 */
function addTableColumn() {
  const columnName = prompt("Enter column name (e.g., Activity, Quantity):");
  if (!columnName) return;

  templateCreationState.columns.push({
    id: "column_" + Date.now(),
    name: String(columnName).trim(),
    isLocked: false,
    fixedValue: null,
    rowFixedValues: {},
  });

  renderColumnsContainer();
  updateTemplatePreview();
  showToast(`Column "${columnName}" added`, "success");
}

/**
 * Delete a column from the table template
 */
function deleteTableColumn(columnId) {
  templateCreationState.columns = templateCreationState.columns.filter(
    (col) => col.id !== columnId,
  );
  renderColumnsContainer();
  updateTemplatePreview();
  showToast("Column deleted", "success");
}

/**
 * Update column name in table template
 */
function updateTableColumnName(columnId, newName) {
  const column = templateCreationState.columns.find(
    (col) => col.id === columnId,
  );
  if (column) {
    column.name = newName || "Column";
    renderColumnsContainer();
    updateTemplatePreview();
  }
}

function configureTableColumn(columnId) {
  const column = templateCreationState.columns.find((entry) => entry.id === columnId);
  if (!column) return;

  const lockModeRaw = prompt(
    `Lock mode for "${column.name}":\n0 = Editable\n1 = Entire column fixed value\n2 = Row-wise fixed values`,
    column.fixedValue !== null ? "1" : Object.keys(column.rowFixedValues || {}).length > 0 ? "2" : "0",
  );
  if (lockModeRaw === null) return;
  const lockMode = String(lockModeRaw).trim();

  let fixedValue = null;
  let rowFixedValues = {};
  if (lockMode === "1") {
    const value = prompt(
      `Fixed value for all rows in "${column.name}":`,
      column.fixedValue !== null && column.fixedValue !== undefined
        ? String(column.fixedValue)
        : "",
    );
    if (value === null) return;
    fixedValue = String(value).trim();
  } else if (lockMode === "2") {
    const rowWiseInput = prompt(
      `Row-wise fixed values for "${column.name}"\nFormat: 1:10, 2:25.5, 3:ABC`,
      stringifyRowFixedValues(column.rowFixedValues),
    );
    if (rowWiseInput === null) return;
    rowFixedValues = parseRowFixedValuesInput(rowWiseInput);
  }

  column.fixedValue = fixedValue;
  column.rowFixedValues = rowFixedValues;
  column.isLocked = lockMode === "1" || lockMode === "2";

  renderColumnsContainer();
  updateTemplatePreview();
  showToast(`Updated configuration for ${column.name}`, "success");
}

/**
 * Render the table columns container
 */
function renderColumnsContainer() {
  const container = document.getElementById("columnsContainer");
  if (!container) return;

  if (templateCreationState.columns.length === 0) {
    container.innerHTML =
      '<div style="padding: 20px; color: #999; text-align: center;">No columns added yet. Click "Add Column" to create one.</div>';
    return;
  }

  container.innerHTML = templateCreationState.columns
    .map(
      (column) => `
    <div style="display: grid; grid-template-columns: 1fr auto auto; gap: 12px; padding: 12px 15px; border-bottom: 1px solid #e0e0e0; align-items: center;">
      <div>
        <input type="text" value="${column.name}" placeholder="Column name" 
        onchange="updateTableColumnName('${column.id}', this.value)"
        style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px;" />
        <div style="font-size: 11px; color: #666; margin-top: 6px;">${summarizeTableColumnConfig(column)}</div>
      </div>
      <button type="button" onclick="configureTableColumn('${column.id}')" 
        style="background: #2e7db1; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; transition: all 0.3s;"
        onmouseover="this.style.background='#1a5490';"
        onmouseout="this.style.background='#2e7db1';">
        Configure
      </button>
      <button type="button" onclick="deleteTableColumn('${column.id}')" 
        style="background: #ff6b6b; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; transition: all 0.3s;"
        onmouseover="this.style.background='#ff5252';"
        onmouseout="this.style.background='#ff6b6b';">
        Delete
      </button>
    </div>
  `,
    )
    .join("");
}

/**
 * Add a new row to the template
 */
function addTemplateRow() {
  const numCellsInput = prompt(
    "How many columns should this row have? (e.g., 3)",
    "3",
  );
  if (!numCellsInput || isNaN(numCellsInput)) return;

  const numCells = parseInt(numCellsInput);
  if (numCells < 1) {
    showToast("Row must have at least 1 column", "error");
    return;
  }

  const cells = Array(numCells)
    .fill(null)
    .map((_, i) => ({
      id: "cell_" + Date.now() + "_" + i,
      label: `Column ${i + 1}`,
      colspan: 1,
      rowspan: 1,
    }));

  const newRow = {
    id: "row_" + Date.now(),
    cells: cells,
  };

  templateCreationState.rows.push(newRow);
  renderRowsContainer();
  updateTemplatePreview();
  showToast(`Row with ${numCells} columns added`, "success");
}

/**
 * Add a new column to all rows
 */
function addTemplateColumn() {
  if (templateCreationState.rows.length === 0) {
    showToast("Add a row first", "error");
    return;
  }

  templateCreationState.rows.forEach((row) => {
    row.cells.push({
      id: "cell_" + Date.now() + "_" + Math.random(),
      label: `Column ${row.cells.length}`,
      colspan: 1,
      rowspan: 1,
    });
  });

  renderRowsContainer();
  updateTemplatePreview();
  showToast("Column added to all rows", "success");
}

/**
 * Delete a row from the template
 */
function deleteTemplateRow(rowId) {
  templateCreationState.rows = templateCreationState.rows.filter(
    (r) => r.id !== rowId,
  );
  renderRowsContainer();
  updateTemplatePreview();
  showToast("Row deleted", "success");
}

/**
 * Update cell label in row
 */
function updateCellLabel(rowId, cellId, newLabel) {
  const row = templateCreationState.rows.find((r) => r.id === rowId);
  if (row) {
    const cell = row.cells.find((c) => c.id === cellId);
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
  const container = document.getElementById("rowsContainer");
  if (!container) return;

  if (templateCreationState.rows.length === 0) {
    container.innerHTML =
      '<div style="padding: 20px; color: #999; text-align: center;">No rows added yet. Click "Add Row" to create one.</div>';
    return;
  }

  container.innerHTML = `
    <div style="overflow-x: auto;">
      <table style="width: 100%; border-collapse: collapse;">
        <tbody>
          ${templateCreationState.rows
            .map(
              (row, rowIndex) => `
            <tr style="border-bottom: 1px solid #e0e0e0;">
              ${row.cells
                .map(
                  (cell) => `
                <td style="padding: 12px; border-right: 1px solid #e0e0e0; text-align: center; position: relative;">
                  <input type="text" value="${cell.label}" placeholder="Cell label" 
                    onchange="updateCellLabel('${row.id}', '${cell.id}', this.value)"
                    style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px;" />
                </td>
              `,
                )
                .join("")}
              <td style="padding: 12px; text-align: center;">
                <button type="button" onclick="deleteTemplateRow('${row.id}')" 
                  style="background: #ff6b6b; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; transition: all 0.3s;"
                  onmouseover="this.style.background='#ff5252';"
                  onmouseout="this.style.background='#ff6b6b';">
                  Delete Row
                </button>
              </td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * Update template preview
 */
function updateTemplatePreview() {
  const preview = document.getElementById("templatePreview");
  const templateType = templateCreationState.templateType;

  if (templateType === "form") {
    if (
      templateCreationState.fields.length === 0 &&
      templateCreationState.rows.length === 0
    ) {
      preview.innerHTML =
        '<p style="color: #999; padding: 15px;">Preview will show form fields here...</p>';
      return;
    }

    if (templateCreationState.fields.length > 0) {
      preview.innerHTML = `
        <div style="padding: 15px;">
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background: #f0f0f0;">
                ${templateCreationState.fields
                  .map(
                    (field) => `
                  <th style="padding: 10px; border: 1px solid #ddd; text-align: left; font-weight: 600; font-size: 12px;">${field.label}</th>
                `,
                  )
                  .join("")}
              </tr>
            </thead>
            <tbody>
              <tr>
                ${templateCreationState.fields
                  .map(
                    (field) => `
                  <td style="padding: 10px; border: 1px solid #ddd; color: #999; font-size: 12px;">Sample ${field.type}...</td>
                `,
                  )
                  .join("")}
              </tr>
            </tbody>
          </table>
        </div>
      `;
      return;
    }

    preview.innerHTML = `
      <div style="overflow-x: auto; padding: 15px;">
        <table style="width: 100%; border-collapse: collapse; border: 1px solid #ddd;">
          <tbody>
            ${templateCreationState.rows
              .map(
                (row) => `
              <tr>
                ${row.cells
                  .map(
                    (cell) => `
                  <td style="padding: 15px; border: 1px solid #ddd; text-align: center; font-weight: 600; color: #333; background: #f9f9f9;">${cell.label}</td>
                `,
                  )
                  .join("")}
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
    return;
  }

  if (templateCreationState.columns.length === 0) {
    preview.innerHTML =
      '<p style="color: #999; padding: 15px;">Preview will show table columns here...</p>';
    return;
  }

  preview.innerHTML = `
    <div style="overflow-x: auto; padding: 15px;">
      <table style="width: 100%; border-collapse: collapse; border: 1px solid #ddd;">
        <thead>
          <tr style="background: #f0f0f0;">
            ${templateCreationState.columns
              .map(
                (column) => `
              <th style="padding: 10px; border: 1px solid #ddd; text-align: left; font-weight: 600; font-size: 12px;">${column.name}</th>
            `,
              )
              .join("")}
          </tr>
        </thead>
        <tbody>
          <tr>
            ${templateCreationState.columns
              .map(
                () => `
              <td style="padding: 10px; border: 1px solid #ddd; color: #999; font-size: 12px;">Row value...</td>
            `,
              )
              .join("")}
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

/**
 * Save template to database (create new or update existing)
 */
function saveTemplateToDatabase() {
  const token = localStorage.getItem("auth_token");
  if (!token) {
    showToast("Authentication required", "error");
    return;
  }

  const templateName = document.getElementById("templateName").value.trim();
  const templateDescription = document
    .getElementById("templateDescription")
    .value.trim();
  const isDefault = document.getElementById("isDefaultTemplate").checked;
  const templateType = templateCreationState.templateType;
  const saveAsDraft = !!document.getElementById("templateSaveAsDraft")?.checked;
  const isEditing = templateCreationState.editingTemplateId;
  const rowLimitRaw = document.getElementById("tableRowLimit")
    ? document.getElementById("tableRowLimit").value
    : "";
  const rowLimit = rowLimitRaw ? parseInt(rowLimitRaw) : null;

  if (!templateName) {
    showToast("Please enter a template name", "error");
    return;
  }

  if (
    templateType === "form" &&
    templateCreationState.fields.length === 0 &&
    templateCreationState.rows.length === 0
  ) {
    showToast("Please add at least one field or row", "error");
    return;
  }

  if (templateType === "table" && templateCreationState.columns.length === 0) {
    showToast("Please add at least one column", "error");
    return;
  }

  const templateData = {
    name: templateName,
    description: templateDescription,
    is_default: isDefault,
    template_type: templateType,
    fields: templateType === "form" ? templateCreationState.fields : [],
    rows: templateType === "form" ? templateCreationState.rows : [],
    columns:
      templateType === "table"
        ? normalizeTableColumnsForDesigner(templateCreationState.columns)
        : [],
    row_limit: templateType === "table" ? rowLimit : null,
    status: saveAsDraft ? "draft" : "pushed",
  };

  // Use PUT for updates, POST for new templates
  const method = isEditing ? "PUT" : "POST";
  const url = isEditing ? `/api/templates/${isEditing}` : "/api/templates";

  fetch(url, {
    method: method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(templateData),
  })
    .then((response) => {
      if (!response.ok) {
        return response.json().then((err) => Promise.reject(err));
      }
      return response.json();
    })
    .then((data) => {
      const actionText = isEditing ? "updated" : "saved";
      showToast(
        `Template "${templateName}" ${actionText} successfully!`,
        "success",
      );

      // Reset form
      document.getElementById("createTemplateForm").reset();
      const draftToggle = document.getElementById("templateSaveAsDraft");
      if (draftToggle) draftToggle.checked = false;
      templateCreationState = {
        fields: [],
        rows: [],
        columns: [],
        templateType: "form",
        rowLimit: null,
      };
      templateFieldDraft = {
        name: "",
        label: "",
        type: "text",
        required: false,
        options: "",
      };
      renderFieldsContainer();
      renderColumnsContainer();
      updateTemplatePreview();

      // Change button back to "Save"
      const saveBtn = document.querySelector(
        '[onclick="saveTemplateToDatabase()"]',
      );
      if (saveBtn) {
        saveBtn.textContent = "💾 Save Template";
        saveBtn.dataset.editing = "false";
      }

      // Close modal
      document.getElementById("createTemplateModal").style.display = "none";

      // Reload templates list
      loadTemplates();
    })
    .catch((error) => {
      console.error("Error saving template:", error);
      const message =
        error && (error.error || error.message)
          ? error.error || error.message
          : "Unknown error";
      showToast(`Error saving template: ${message}`, "error");
    });
}

/**
 * Load templates from API and display them in the templates list
 */
function loadTemplates() {
  const token = localStorage.getItem("auth_token");
  if (!token) return;

  if (!allProjects || allProjects.length === 0) {
    loadProjects();
  }

  fetch("/api/templates/library", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
    .then((response) => {
      if (!response.ok) throw new Error("Failed to load templates");
      return response.json();
    })
    .then((data) => {
      const templatesList = document.getElementById("templatesList");
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

      templatesList.innerHTML = templates
        .map(
          (template) => `
        <div style="background: white; border: 2px solid #e0e0e0; border-radius: 8px; padding: 20px; display: grid; grid-template-columns: 1fr auto; gap: 20px; align-items: start; transition: all 0.3s;">
          <div>
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
              <h3 style="margin: 0; color: #1a5490; font-size: 16px; font-weight: 700;">${template.name}</h3>
              ${
                template.is_default
                  ? `
                <span style="background: linear-gradient(135deg, #ffd700, #ffed4e); color: #333; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">⭐ Default</span>
              `
                  : ""
              }
            </div>
            <p style="margin: 0 0 10px 0; color: #666; font-size: 13px;">${template.description || "No description"}</p>
            <div style="display: flex; gap: 15px; font-size: 12px; color: #999;">
              <span><i class="fas fa-layer-group"></i> ${template.template_type === "table" ? "Table Template" : "Form Template"}</span>
              <span><i class="fas fa-columns"></i> ${template.template_type === "table" ? (template.columns?.length || 0) + " columns" : (template.fields?.length || 0) + " fields"}</span>
              <span><i class="fas fa-tag"></i> ${template.status || "pushed"}</span>
              <span><i class="fas fa-calendar"></i> ${new Date(template.created_at).toLocaleDateString()}</span>
            </div>
            <div style="margin-top: 12px; display: grid; grid-template-columns: 1.2fr 1fr 1fr 1fr auto auto; gap: 8px; align-items: center;">
              <select id="templatePushProject_${template.id}" style="padding: 7px; border: 1px solid #ddd; border-radius: 6px; font-size: 12px;">
                ${buildProjectOptionsHtml()}
              </select>
              <select id="templatePushRepetitionType_${template.id}" style="padding: 7px; border: 1px solid #ddd; border-radius: 6px; font-size: 12px;">
                <option value="daily">daily</option>
                <option value="weekly">weekly</option>
                <option value="monthly">monthly</option>
              </select>
              <input id="templatePushRepetitionDays_${template.id}" type="text" placeholder="Mon,Tue,Wed" style="padding: 7px; border: 1px solid #ddd; border-radius: 6px; font-size: 12px;" />
              <input id="templatePushSchedule_${template.id}" type="datetime-local" style="padding: 7px; border: 1px solid #ddd; border-radius: 6px; font-size: 12px;" />
              <button onclick="pushTemplateToProject(${template.id}, 'schedule')" style="background: #ff9f43; color: white; border: none; padding: 7px 10px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 12px;">Schedule</button>
              <button onclick="pushTemplateToProject(${template.id}, 'now')" style="background: #10ac84; color: white; border: none; padding: 7px 10px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 12px;">Push Now</button>
            </div>
            ${template.status === "scheduled" && template.scheduled_at ? `<div style="margin-top: 6px; font-size: 11px; color: #b56f00;">Scheduled at: ${new Date(template.scheduled_at).toLocaleString()}</div>` : ""}
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
      `,
        )
        .join("");
    })
    .catch((error) => {
      console.error("Error loading templates:", error);
      document.getElementById("templatesList").innerHTML = `
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
  const token = localStorage.getItem("auth_token");

  // FIX: Feature3 - Fetch single template directly.
  fetch(`/api/templates/${templateId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
    .then((response) => response.json())
    .then((data) => {
      const template = data.template;

      if (!template) {
        showToast("Template not found", "error");
        return;
      }

      // Populate the form with template data
      document.getElementById("templateName").value = template.name || "";
      document.getElementById("templateDescription").value =
        template.description || "";
      document.getElementById("isDefaultTemplate").checked =
        template.is_default || false;
      const draftToggle = document.getElementById("templateSaveAsDraft");
      if (draftToggle) {
        draftToggle.checked = (template.status || "pushed") === "draft";
      }

      const templateType =
        template.template_type ||
        (template.columns && template.columns.length > 0 ? "table" : "form");

      if (templateType === "table") {
        document.querySelector(
          'input[name="templateType"][value="table"]',
        ).checked = true;
        templateCreationState = {
          fields: [],
          rows: [],
          columns: normalizeTableColumnsForDesigner(template.columns || []),
          templateType: "table",
          rowLimit: template.row_limit || null,
          editingTemplateId: templateId,
        };
      } else {
        document.querySelector(
          'input[name="templateType"][value="form"]',
        ).checked = true;
        templateCreationState = {
          fields: template.fields || [],
          rows: template.rows || [],
          columns: [],
          templateType: "form",
          rowLimit: null,
          editingTemplateId: templateId,
        };
      }

      // Update UI and preview
      updateTemplateTypeUI();
      templateFieldDraft = {
        name: "",
        label: "",
        type: "text",
        required: false,
        options: "",
      };
      renderFieldsContainer();
      renderColumnsContainer();
      updateTemplatePreview();

      // Change button text to "Update" instead of "Save"
      const saveBtn = document.querySelector(
        '[onclick="saveTemplateToDatabase()"]',
      );
      if (saveBtn) {
        saveBtn.textContent = "💾 Update Template";
        saveBtn.dataset.editing = "true";
      }

      // Open modal
      const rowLimitInput = document.getElementById("tableRowLimit");
      if (rowLimitInput) {
        rowLimitInput.value =
          templateType === "table" && template.row_limit
            ? template.row_limit
            : "";
      }

      document.getElementById("createTemplateModal").style.display = "flex";
      showToast(`Editing template: ${template.name}`, "info");
    })
    .catch((error) => {
      console.error("Error loading template for editing:", error);
      showToast("Failed to load template for editing", "error");
    });
}

/**
 * Delete a template
 */
function deleteTemplate(templateId, templateName) {
  if (
    !confirm(`Are you sure you want to delete the template "${templateName}"?`)
  ) {
    return;
  }

  const token = localStorage.getItem("auth_token");
  if (!token) {
    showToast("Authentication required", "error");
    return;
  }

  fetch(`/api/templates/${templateId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
    .then((response) => {
      if (!response.ok) throw new Error("Failed to delete template");
      return response.json();
    })
    .then((data) => {
      showToast(`Template "${templateName}" deleted successfully`, "success");
      loadTemplates();
    })
    .catch((error) => {
      console.error("Error deleting template:", error);
      showToast(`Error deleting template: ${error.message}`, "error");
    });
}

/**
 * Open create template modal
 */
function openCreateTemplateModal() {
  templateCreationState = {
    fields: [],
    rows: [],
    columns: [],
    templateType: "form",
    rowLimit: null,
  };
  templateFieldDraft = {
    name: "",
    label: "",
    type: "text",
    required: false,
    options: "",
  };
  const formRadio = document.querySelector(
    'input[name="templateType"][value="form"]',
  );
  if (formRadio) formRadio.checked = true;
  renderFieldsContainer();
  renderColumnsContainer();
  updateTemplatePreview();
  const rowLimitInput = document.getElementById("tableRowLimit");
  if (rowLimitInput) rowLimitInput.value = "";
  document.getElementById("createTemplateModal").style.display = "flex";
}
