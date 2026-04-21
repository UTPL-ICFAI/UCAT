/**
 * Submission Review Module
 * Handles PM/Superadmin review and approval of template submissions
 */

let currentReviewSubmission = null;
let pmSubmissionsCache = [];

/**
 * Load submissions for current project
 */
function loadPMSubmissions() {
  const currentProjectId = document.querySelector('[data-project-id]')?.getAttribute('data-project-id');
  if (!currentProjectId) return;
  
  const templateFilter = document.getElementById('pmSubmissionTemplateFilter')?.value || '';
  const statusFilter = document.getElementById('pmSubmissionStatusFilter')?.value || '';
  const dateFilter = document.getElementById('pmSubmissionDateFilter')?.value || '';
  
  const token = localStorage.getItem('auth_token');
  
  fetch(`/api/project-templates/${currentProjectId}/submissions`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
    .then(response => response.json())
    .then(data => {
      if (data.success && Array.isArray(data.data)) {
        let submissions = data.data;
        
        // Apply filters
        if (templateFilter) {
          submissions = submissions.filter(s => s.template_id == templateFilter);
        }
        if (statusFilter) {
          submissions = submissions.filter(s => s.status === statusFilter);
        }
        if (dateFilter) {
          submissions = submissions.filter(s => s.submission_date === dateFilter);
        }
        
        pmSubmissionsCache = submissions;
        renderPMSubmissions(submissions);
        loadTemplatesForFilter();
      }
    })
    .catch(error => console.error('Error loading submissions:', error));
}

/**
 * Load templates for filter dropdown
 */
function loadTemplatesForFilter() {
  const currentProjectId = document.querySelector('[data-project-id]')?.getAttribute('data-project-id');
  if (!currentProjectId) return;
  
  const token = localStorage.getItem('auth_token');
  
  fetch(`/api/project-templates/${currentProjectId}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
    .then(response => response.json())
    .then(data => {
      if (data.success && Array.isArray(data.data)) {
        const select = document.getElementById('pmSubmissionTemplateFilter');
        if (select) {
          const currentValue = select.value;
          select.innerHTML = '<option value="">All Templates</option>';
          
          data.data.forEach(assignment => {
            const option = document.createElement('option');
            option.value = assignment.template_id;
            option.textContent = assignment.template.name;
            select.appendChild(option);
          });
          
          select.value = currentValue;
        }
      }
    })
    .catch(error => console.error('Error loading templates:', error));
}

/**
 * Render submissions in table
 */
function renderPMSubmissions(submissions) {
  const tbody = document.getElementById('submissionsTableBody');
  if (!tbody) return;
  
  if (submissions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;">No submissions found</td></tr>';
    return;
  }
  
  tbody.innerHTML = submissions.map(submission => `
    <tr style="background: ${submission.status === 'submitted' ? '#fffbea' : ''};">
      <td>${submission.template?.name || 'N/A'}</td>
      <td>${submission.submitted_by_name || submission.submitted_by || 'Unknown'}</td>
      <td>${formatDate(submission.submission_date)}</td>
      <td>
        <span class="status-badge status-${submission.status}">
          ${submission.status.charAt(0).toUpperCase() + submission.status.slice(1)}
        </span>
      </td>
      <td>${formatDate(submission.created_at)}</td>
      <td>
        <button class="btn btn-sm" onclick="reviewSubmission(${submission.id})">Review</button>
        ${submission.status === 'submitted' ? `
          <button class="btn btn-sm btn-success" onclick="quickApprove(${submission.id})">Approve</button>
        ` : ''}
      </td>
    </tr>
  `).join('');
}

/**
 * Review a submission - open modal with details
 */
function reviewSubmission(submissionId) {
  const token = localStorage.getItem('auth_token');
  
  fetch(`/api/project-templates/submissions/${submissionId}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        currentReviewSubmission = data.data;
        renderReviewModal(data.data);
        document.getElementById('reviewSubmissionModal').style.display = 'flex';
      }
    })
    .catch(error => console.error('Error loading submission:', error));
}

/**
 * Render review modal content
 */
function renderReviewModal(submission) {
  const titleEl = document.getElementById('reviewModalTitle');
  const contentEl = document.getElementById('reviewSubmissionContent');
  
  titleEl.textContent = `${submission.template?.name || 'Submission'} - ${formatDate(submission.submission_date)}`;
  
  let html = `
    <div style="margin-bottom: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
      <div>
        <p><strong>Template:</strong> ${submission.template?.name || 'N/A'}</p>
        <p><strong>Submitted By:</strong> ${submission.submitted_by_name || submission.submitted_by || 'Unknown'}</p>
        <p><strong>Date:</strong> ${formatDate(submission.submission_date)}</p>
      </div>
      <div>
        <p><strong>Status:</strong> <span class="status-badge status-${submission.status}">${submission.status}</span></p>
        <p><strong>Submitted On:</strong> ${formatDate(submission.created_at)}</p>
        ${submission.reviewed_by ? `<p><strong>Reviewed By:</strong> ${submission.reviewed_by}</p>` : ''}
      </div>
    </div>
    
    <h4>Submitted Data:</h4>
  `;
  
  html += renderSubmissionData(submission);
  
  if (submission.status !== 'submitted') {
    html += `
      <div style="margin-top: 15px; padding: 15px; background: #f0f0f0; border-radius: 6px;">
        <p><strong>Review Comment:</strong> ${submission.review_comment || 'No comment provided'}</p>
      </div>
    `;
  }
  
  contentEl.innerHTML = html;
}

function renderSubmissionData(submission) {
  const snapshot = submission.template_snapshot || submission.template || {};
  const templateType = snapshot.template_type || 'form';
  const data = submission.data || {};

  if (templateType === 'table' && Array.isArray(data.rows)) {
    const columns = snapshot.columns || data.columns || [];
    const header = columns.map(col => `<th style="padding: 10px; text-align: left; border: 1px solid #ddd;">${col}</th>`).join('');
    const body = data.rows.map(row => `
      <tr>
        ${columns.map(col => `<td style="padding: 8px; border: 1px solid #ddd;">${row[col] || ''}</td>`).join('')}
      </tr>
    `).join('');

    return `
      <div style="background: #f5f5f5; padding: 15px; border-radius: 6px; overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse;">
          <thead><tr style="background: #e0e0e0;">${header}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    `;
  }

  if (Array.isArray(data.fields)) {
    const rows = data.fields.map(field => `
      <tr>
        <td style="padding: 8px; border: 1px solid #ddd; font-weight: 600;">${field.label}</td>
        <td style="padding: 8px; border: 1px solid #ddd;">${field.value || '-'}</td>
      </tr>
    `).join('');

    return `
      <div style="background: #f5f5f5; padding: 15px; border-radius: 6px;">
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background: #e0e0e0;">
              <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Field</th>
              <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Value</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  if (Array.isArray(data.rows)) {
    const rowBlocks = data.rows.map(row => {
      const cells = Array.isArray(row.cells) ? row.cells : [];
      const cellRows = cells.map(cell => `
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd; font-weight: 600;">${cell.label}</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${cell.value || '-'}</td>
        </tr>
      `).join('');

      return `
        <div style="margin-bottom: 12px;">
          <div style="font-weight: 600; margin-bottom: 6px;">${row.label || 'Row'}</div>
          <table style="width: 100%; border-collapse: collapse;">
            <tbody>${cellRows}</tbody>
          </table>
        </div>
      `;
    }).join('');

    return `
      <div style="background: #f5f5f5; padding: 15px; border-radius: 6px;">
        ${rowBlocks}
      </div>
    `;
  }

  return `
    <div style="background: #f5f5f5; padding: 15px; border-radius: 6px;">
      <pre style="margin: 0;">${JSON.stringify(data, null, 2)}</pre>
    </div>
  `;
}

function exportSubmissionsJson() {
  if (!pmSubmissionsCache || pmSubmissionsCache.length === 0) {
    showToast('No submissions to export', 'warning');
    return;
  }

  downloadBlob(JSON.stringify(pmSubmissionsCache, null, 2), 'application/json', 'submissions.json');
}

function exportSubmissionsCsv() {
  if (!pmSubmissionsCache || pmSubmissionsCache.length === 0) {
    showToast('No submissions to export', 'warning');
    return;
  }

  const tableSubmissions = pmSubmissionsCache.filter(sub => {
    const snapshot = sub.template_snapshot || sub.template || {};
    return (snapshot.template_type || 'form') === 'table';
  });

  if (tableSubmissions.length === 0) {
    showToast('CSV export is available only for table templates', 'warning');
    return;
  }

  const firstSnapshot = tableSubmissions[0].template_snapshot || tableSubmissions[0].template || {};
  const columns = firstSnapshot.columns || [];
  if (columns.length === 0) {
    showToast('No columns found for CSV export', 'warning');
    return;
  }

  const mismatched = tableSubmissions.some(sub => {
    const snapshot = sub.template_snapshot || sub.template || {};
    const subColumns = snapshot.columns || [];
    return subColumns.join('|') !== columns.join('|');
  });

  if (mismatched) {
    showToast('CSV export requires the same columns across submissions', 'warning');
    return;
  }

  const header = ['submission_id', 'submission_date', 'submitted_by', ...columns];
  const rows = [header];

  tableSubmissions.forEach(sub => {
    const data = sub.data || {};
    const rowItems = Array.isArray(data.rows) ? data.rows : [];

    rowItems.forEach(row => {
      rows.push([
        sub.id,
        sub.submission_date,
        sub.submitted_by_name || sub.submitted_by || '',
        ...columns.map(col => row[col] || '')
      ]);
    });
  });

  const csv = rows.map(r => r.map(escapeCsv).join(',')).join('\n');
  downloadBlob(csv, 'text/csv', 'submissions.csv');
}

function downloadSubmissionJson() {
  if (!currentReviewSubmission) return;
  downloadBlob(JSON.stringify(currentReviewSubmission, null, 2), 'application/json', `submission_${currentReviewSubmission.id}.json`);
}

function downloadSubmissionCsv() {
  if (!currentReviewSubmission) return;

  const snapshot = currentReviewSubmission.template_snapshot || currentReviewSubmission.template || {};
  const templateType = snapshot.template_type || 'form';
  if (templateType !== 'table') {
    showToast('CSV export is only available for table templates', 'warning');
    return;
  }

  const columns = snapshot.columns || [];
  const rows = [columns];
  const dataRows = currentReviewSubmission.data?.rows || [];

  dataRows.forEach(row => {
    rows.push(columns.map(col => row[col] || ''));
  });

  const csv = rows.map(r => r.map(escapeCsv).join(',')).join('\n');
  downloadBlob(csv, 'text/csv', `submission_${currentReviewSubmission.id}.csv`);
}

function escapeCsv(value) {
  const str = value === null || value === undefined ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function downloadBlob(content, contentType, filename) {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Approve a submission
 */
function approveSubmission() {
  if (!currentReviewSubmission) return;
  
  const token = localStorage.getItem('auth_token');
  
  fetch(`/api/project-templates/submissions/${currentReviewSubmission.id}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      status: 'approved'
    })
  })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        showToast('Submission approved successfully', 'success');
        closeModal('reviewSubmissionModal');
        loadPMSubmissions();
      } else {
        showToast(data.message || 'Failed to approve', 'error');
      }
    })
    .catch(error => {
      console.error('Error approving submission:', error);
      showToast('Error approving submission', 'error');
    });
}

/**
 * Open reject reason modal
 */
function rejectSubmissionModal() {
  document.getElementById('rejectReasonModal').style.display = 'flex';
}

/**
 * Confirm rejection with reason
 */
function confirmRejection() {
  if (!currentReviewSubmission) return;
  
  const reason = document.getElementById('rejectReason').value.trim();
  if (!reason) {
    showToast('Please provide a rejection reason', 'error');
    return;
  }
  
  const token = localStorage.getItem('auth_token');
  
  fetch(`/api/project-templates/submissions/${currentReviewSubmission.id}/reject`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      status: 'rejected',
      review_comment: reason
    })
  })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        showToast('Submission rejected', 'success');
        closeModal('rejectReasonModal');
        closeModal('reviewSubmissionModal');
        document.getElementById('rejectReason').value = '';
        loadPMSubmissions();
      } else {
        showToast(data.message || 'Failed to reject', 'error');
      }
    })
    .catch(error => {
      console.error('Error rejecting submission:', error);
      showToast('Error rejecting submission', 'error');
    });
}

/**
 * Quick approve submission without opening modal
 */
function quickApprove(submissionId) {
  if (!confirm('Approve this submission?')) return;
  
  const token = localStorage.getItem('auth_token');
  
  fetch(`/api/project-templates/submissions/${submissionId}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      status: 'approved'
    })
  })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        showToast('Submission approved', 'success');
        loadPMSubmissions();
      } else {
        showToast(data.message || 'Failed to approve', 'error');
      }
    })
    .catch(error => {
      console.error('Error approving submission:', error);
      showToast('Error approving submission', 'error');
    });
}

/**
 * Generate document from submission (Excel/PDF)
 */
function generateSubmissionDocument(submissionId) {
  const token = localStorage.getItem('auth_token');
  
  // This would call a document generation endpoint
  // For now, showing placeholder
  fetch(`/api/project-templates/submissions/${submissionId}/generate-document`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
    .then(response => {
      if (response.ok) {
        // Download the file
        return response.blob().then(blob => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `submission-${submissionId}.xlsx`;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
        });
      } else {
        showToast('Failed to generate document', 'error');
      }
    })
    .catch(error => {
      console.error('Error generating document:', error);
      showToast('Error generating document', 'error');
    });
}

/**
 * Initialize submission review module
 */
function initSubmissionReview() {
  // Load submissions when switching to submissions tab
  const submissionsTab = document.getElementById('submissions');
  if (submissionsTab) {
    // Initial load
    loadPMSubmissions();
  }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('reviewSubmissionModal')) {
    initSubmissionReview();
  }
});
