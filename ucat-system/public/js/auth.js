// Auth.js - Client-side Authentication System
// This file handles all authentication logic including login, logout, and token management

// Function to display toast notifications to the user
function showToast(message, type = 'info') {
  // Get or create the toast container if it doesn't exist
  const container = document.getElementById('toastContainer') || createToastContainer();
  // Create a new div element for the toast
  const toast = document.createElement('div');
  // Add CSS classes for styling and type (success, error, warning, info)
  toast.className = `toast ${type}`;
  // Set the message text
  toast.textContent = message;
  // Append the toast to the container for display
  container.appendChild(toast);
  
  // Auto-remove toast after 3 seconds
  setTimeout(() => {
    // Apply animation to slide out
    toast.style.animation = 'slideOutRight 0.3s ease-out forwards';
    // Remove the toast element from DOM after animation completes
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Function to create the toast container if it doesn't exist
function createToastContainer() {
  // Create a new div element for the container
  const container = document.createElement('div');
  // Set the ID for reference
  container.id = 'toastContainer';
  // Add CSS class for positioning
  container.className = 'toast-container';
  // Append container to body
  document.body.appendChild(container);
  // Return the container reference
  return container;
}

// Function to show or hide the loading indicator
function showLoading(show = true) {
  // Get reference to loading element
  const loading = document.getElementById('loading');
  // Get reference to login button
  const btn = document.getElementById('loginBtn');
  // If loading element exists, toggle the 'show' class
  if (loading) {
    loading.classList.toggle('show', show);
  }
  // If button exists, disable or enable it based on loading state
  if (btn) {
    btn.disabled = show;
  }
}

// Function to display error message to user
function showError(message) {
  // Get reference to error message container
  const errorDiv = document.getElementById('errorMessage');
  // If error container exists
  if (errorDiv) {
    // Set the error message text
    errorDiv.textContent = message;
    // Add 'show' class to display the error
    errorDiv.classList.add('show');
  }
  // Also show error as a toast notification
  showToast(message, 'error');
}

// Function to clear error message from display
function clearError() {
  // Get reference to error message container
  const errorDiv = document.getElementById('errorMessage');
  // If error container exists
  if (errorDiv) {
    // Remove the 'show' class to hide the error
    errorDiv.classList.remove('show');
    // Clear the error text
    errorDiv.textContent = '';
  }
}

// Function to decode JWT token and extract user information
function decodeJWT(token) {
  // Split token into parts (header.payload.signature)
  const base64Url = token.split('.')[1];
  // Convert base64url to base64 by replacing special characters
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  // Decode base64 to string and handle special characters
  const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => {
    // Convert each character to hexadecimal format
    return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
  }).join(''));
  // Parse and return the JSON payload
  return JSON.parse(jsonPayload);
}

// Async function to handle login form submission
async function handleLogin(e) {
  // Prevent default form submission behavior
  e.preventDefault();
  // Clear any previous error messages
  clearError();
  
  // Get user ID from input field and trim whitespace
  const userId = document.getElementById('userId').value.trim();
  // Get password from input field and trim whitespace
  const password = document.getElementById('password').value.trim();
  
  // Validate that both fields are filled
  if (!userId || !password) {
    // Show error if either field is empty
    showError('Please enter both user ID and password');
    // Exit function early
    return;
  }
  
  // Show loading indicator while authenticating
  showLoading(true);
  
  // Try to perform login request
  try {
    // Send POST request to login endpoint
    const response = await fetch('/api/auth/login', {
      // Specify POST method
      method: 'POST',
      // Set content type to JSON
      headers: {
        'Content-Type': 'application/json'
      },
      // Include credentials (cookies) with request
      credentials: 'include',
      // Send user credentials as JSON
      body: JSON.stringify({ user_id: userId, password })
    });
    
    // Parse response as JSON
    const data = await response.json();
    
    // Check if response status is not OK (login failed)
    if (!response.ok) {
      // Show error message from server or generic error
      showError(data.error || 'Login failed');
      // Hide loading indicator
      showLoading(false);
      // Exit function
      return;
    }
    
    // Store JWT token in localStorage for client-side access
    if (data.token) {
      localStorage.setItem('auth_token', data.token);
    }
    // Show success message
    showToast('Login successful! Redirecting...', 'success');
    
    // Map user roles to their dashboard URLs
    const redirectMap = {
      'superadmin': '/dashboards/superadmin.html',
      'project_manager': '/dashboards/projectManager.html',
      'site_engineer': '/dashboards/siteEngineer.html',
      'supervisor': '/dashboards/supervisor.html'
    };
    
    // Get redirect URL based on user role, default to home
    const redirect = redirectMap[data.role] || '/';
    
    // Delay redirect slightly to show success toast
    setTimeout(() => {
      // Navigate to appropriate dashboard
      window.location.href = redirect;
    }, 500);
  } catch (error) {
    // Log error to browser console for debugging
    console.error('Login error:', error);
    // Show generic error message
    showError('An error occurred during login. Please try again.');
    // Hide loading indicator
    showLoading(false);
  }
}

// Function to check if user is already authenticated
function checkAuth() {
  // Try to get token from localStorage first (client-side readable)
  let token = localStorage.getItem('auth_token');
  
  // If token not in localStorage, try to get from cookie (backup)
  if (!token) {
    token = getCookie('auth_token');
  }
  
  // If token exists
  if (token) {
    // Try to decode and validate token
    try {
      // Decode the JWT token
      const decoded = decodeJWT(token);
      // Return decoded token with user information
      return decoded;
    } catch (error) {
      // Log decode error to console
      console.error('Token decode error:', error);
      // Remove invalid token from localStorage
      localStorage.removeItem('auth_token');
      // Return null to indicate no valid auth
      return null;
    }
  }
  // Return null if no token found
  return null;
}

// Function to get cookie value by name
function getCookie(name) {
  // Create search string for cookie
  const nameEQ = name + '=';
  // Split all cookies into array
  const cookies = document.cookie.split(';');
  // Loop through all cookies
  for (let i = 0; i < cookies.length; i++) {
    // Get individual cookie and remove whitespace
    let cookie = cookies[i].trim();
    // Check if this cookie matches the name we're looking for
    if (cookie.indexOf(nameEQ) === 0) {
      // Return the cookie value
      return cookie.substring(nameEQ.length, cookie.length);
    }
  }
  // Return null if cookie not found
  return null;
}

// Async function to handle logout
async function logout() {
  // Try to call logout endpoint to invalidate server-side session
  try {
    // Send POST request to logout endpoint
    await fetch('/api/auth/logout', {
      // Specify POST method
      method: 'POST',
      // Set content type to JSON
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    // Log any logout errors (non-critical)
    console.error('Logout error:', error);
  } finally {
    // Always clear token from localStorage regardless of server response
    localStorage.removeItem('auth_token');
    // Redirect to home page
    window.location.href = '/';
  }
}

// Initialize authentication on page load
document.addEventListener('DOMContentLoaded', () => {
  // Check if user is already authenticated
  const auth = checkAuth();
  // If authenticated and on login page
  if (auth && window.location.pathname === '/') {
    // Map roles to dashboard URLs
    const redirectMap = {
      'superadmin': '/dashboards/superadmin.html',
      'project_manager': '/dashboards/projectManager.html',
      'site_engineer': '/dashboards/siteEngineer.html',
      'supervisor': '/dashboards/supervisor.html'
    };
    // Get appropriate dashboard URL, default to home
    const redirect = redirectMap[auth.role] || '/';
    // Redirect already authenticated users to their dashboard
    window.location.href = redirect;
  }
  
  // Get reference to login form
  const loginForm = document.getElementById('loginForm');
  // If login form exists on page
  if (loginForm) {
    // Add event listener for form submission
    loginForm.addEventListener('submit', handleLogin);
  }
  
  // Create a style element for animations
  const style = document.createElement('style');
  // Define CSS animation for toast slide out
  style.textContent = `
    @keyframes slideOutRight {
      from {
        transform: translateX(0);
        opacity: 1;
      }
      to {
        transform: translateX(400px);
        opacity: 0;
      }
    }
  `;
  // Append style element to document head
  document.head.appendChild(style);
});
