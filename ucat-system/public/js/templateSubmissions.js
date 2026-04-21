/**
 * Template Submissions Module
 * Handles daily template submissions for site engineers
 */

// Store current submission context
let currentSubmissionContext = {
  projectId: null,
  templateId: null,
  projectTemplateId: null,
  template: null
};

function normalizeTemplate(template) {
  const templateType = template.template_type || (template.columns && template.columns.length > 0 ? 'table' : 'form');
  return {
    ...template,
    template_type: templateType,
    fields: Array.isArray(template.fields) ? template.fields : [],
    rows: Array.isArray(template.rows) ? template.rows : [],
    columns: Array.isArray(template.columns) ? template.columns : []
  };
}

/**
 * Load projects for submission project select
 */
function loadProjectsForSubmissions() {
  const token = localStorage.getItem('auth_token');
  
  fetch('/api/projects', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
    .then(response => response.json())
    .then(data => {
      const projects = Array.isArray(data) ? data : (data.success && Array.isArray(data.data) ? data.data : []);
      const select = document.getElementById('submissionProjectSelect');
      if (!select) return;

      select.innerHTML = '<option value="">Choose a project...</option>';

      projects.forEach(project => {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.name;
        select.appendChild(option);
      });
    })
    .catch(error => console.error('Error loading projects:', error));
}

/**
 * Load templates assigned to selected project
 */
function loadTemplatesForProject() {
  const projectId = document.getElementById('submissionProjectSelect').value;
  if (!projectId) {
    document.getElementById('submissionTemplateSelect').innerHTML = '<option value="">Choose a template...</option>';
    document.getElementById('templateFormContainer').style.display = 'none';
    return;
  }
  
  const token = localStorage.getItem('auth_token');
  
  fetch(`/api/project-templates/${projectId}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
    .then(response => response.json())
    .then(data => {
      if (data.success && Array.isArray(data.data)) {
        const select = document.getElementById('submissionTemplateSelect');
        select.innerHTML = '<option value="">Choose a template...</option>';
        
        data.data.forEach(assignment => {
          const normalizedTemplate = normalizeTemplate(assignment.template || {});
          const option = document.createElement('option');
          option.value = assignment.template_id;
          option.dataset.projectTemplateId = assignment.id;
          option.dataset.templateData = JSON.stringify(normalizedTemplate);
          option.textContent = normalizedTemplate.name || 'Template';
          select.appendChild(option);
        });
      }
    })
    .catch(error => console.error('Error loading templates:', error));
}

/**
 * Handle template selection change
 */
function onTemplateSelected() {
  const select = document.getElementById('submissionTemplateSelect');
  const selectedOption = select.options[select.selectedIndex];
  
  if (!select.value) {
    document.getElementById('templateFormContainer').style.display = 'none';
    return;
  }
  
  try {
    currentSubmissionContext.templateId = select.value;
    currentSubmissionContext.projectId = document.getElementById('submissionProjectSelect').value;
    currentSubmissionContext.projectTemplateId = selectedOption.dataset.projectTemplateId;
    currentSubmissionContext.template = JSON.parse(selectedOption.dataset.templateData);
    
    renderTemplateForm();
    document.getElementById('templateFormContainer').style.display = 'block';
  } catch (error) {
    console.error('Error parsing template data:', error);
  }
}

/**
 * Render template form dynamically based on template structure
 */
function renderTemplateForm() {
  const template = currentSubmissionContext.template;
  if (!template) return;
  
  const form = document.getElementById('dynamicTemplateForm');
  const title = document.getElementById('templateFormTitle');
  
  title.textContent = template.name;
  
  // Build form HTML based on template fields
  let formHTML = '';
  
  if (template.template_type === 'table') {
    formHTML = renderTableTemplate(template);
  } else if (template.rows && template.rows.length > 0) {
    // Render template with rows structure
    formHTML = renderRowBasedTemplate(template);
  } else if (template.fields && template.fields.length > 0) {
    // Render simple field-based template
    formHTML = renderFieldBasedTemplate(template);
  }
  
  form.innerHTML = formHTML;

  if (template.template_type === 'table') {
    addTemplateTableRow();
  }
}

/**
 * Render table-based template (columns + rows)
 */
function renderTableTemplate(template) {
  const columns = Array.isArray(template.columns) ? template.columns : [];
  const rowLimit = template.row_limit || null;

  let html = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
      <button type="button" class="btn btn-secondary" onclick="addTemplateTableRow()">+ Add Row</button>
      ${rowLimit ? `<span style="font-size: 12px; color: #666;">Row limit: ${rowLimit}</span>` : ''}
    </div>
    <div style="overflow-x: auto; border: 1px solid #e5e7eb; border-radius: 6px;">
      <table style="width: 100%; border-collapse: collapse;" id="templateTable">
        <thead>
          <tr style="background: #f0f0f0;">
            ${columns.map(col => `<th style="padding: 10px; border: 1px solid #ddd; text-align: left; font-weight: 600; font-size: 12px;">${col}</th>`).join('')}
            <th style="padding: 10px; border: 1px solid #ddd; text-align: center; font-weight: 600; font-size: 12px;">Action</th>
          </tr>
        </thead>
        <tbody id="templateTableBody"></tbody>
      </table>
    </div>
  `;

  return html;
}

function addTemplateTableRow() {
  const template = currentSubmissionContext.template;
  const columns = Array.isArray(template.columns) ? template.columns : [];
  const rowLimit = template.row_limit || null;
  const tableBody = document.getElementById('templateTableBody');
  if (!tableBody) return;

  if (rowLimit && tableBody.children.length >= rowLimit) {
    showToast('Row limit reached for this template', 'warning');
    return;
  }

  const rowIndex = tableBody.children.length;
  const row = document.createElement('tr');
  row.innerHTML = `
    ${columns.map(col => `
      <td style="padding: 8px; border: 1px solid #ddd;">
        <input type="text" class="form-control" data-column="${col}" data-row-index="${rowIndex}" />
      </td>
    `).join('')}
    <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">
      <button type="button" class="btn btn-small btn-danger" onclick="this.closest('tr').remove()">Remove</button>
    </td>
  `;

  tableBody.appendChild(row);
}

/**
 * Render field-based template (simple columns)
 */
function renderFieldBasedTemplate(template) {
  let html = '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px;">';
  
  template.fields.forEach((field, index) => {
    html += `
      <div class="form-group">
        <label>${field.label}${field.required ? ' *' : ''}</label>
        ${renderFieldInput(field, index, field.label)}
      </div>
    `;
  });
  
  html += '</div>';
  return html;
}

/**
 * Render row-based template (advanced layout with rows)
 */
function renderRowBasedTemplate(template) {
  let html = '<div style="display: grid; gap: 20px;">';
  
  // Render rows
  template.rows.forEach((row, rowIndex) => {
    html += `
      <div style="border: 1px solid #ddd; border-radius: 6px; padding: 15px; background: #f9f9f9;">
        <h4 style="margin: 0 0 15px 0; color: #333;">${row.label}</h4>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
    `;
    
    if (row.cells && Array.isArray(row.cells)) {
      row.cells.forEach((cell, cellIndex) => {
        const fieldKey = `row_${rowIndex}_cell_${cellIndex}`;
        html += `
          <div class="form-group">
            <label>${cell}</label>
            <input type="text" name="${fieldKey}" class="form-control" placeholder="Enter value" data-row-label="${row.label}" data-cell-label="${cell}" />
          </div>
        `;
      });
    }
    
    html += '</div></div>';
  });
  
  // Also render standalone fields if any
  if (template.fields && template.fields.length > 0) {
    html += '<div style="border: 1px solid #ddd; border-radius: 6px; padding: 15px; background: #f9f9f9;"><h4 style="margin: 0 0 15px 0;">Additional Information</h4><div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">';
    
    template.fields.forEach((field, index) => {
      html += `
        <div class="form-group">
          <label>${field.label}${field.required ? ' *' : ''}</label>
          ${renderFieldInput(field, index)}
        </div>
      `;
    });
    
    html += '</div></div>';
  }
  
  html += '</div>';
  return html;
}

/**
 * Render individual field input based on field type
 */
function renderFieldInput(field, index, label) {
  const fieldName = `field_${index}`;
  const required = field.required ? 'required' : '';
  const dataAttr = label ? `data-field-label="${label}"` : '';
  
  switch (field.type) {
    case 'number':
      return `<input type="number" name="${fieldName}" class="form-control" step="0.01" ${required} ${dataAttr} />`;
    case 'decimal':
      return `<input type="number" name="${fieldName}" class="form-control" step="0.01" ${required} ${dataAttr} />`;
    case 'date':
      return `<input type="date" name="${fieldName}" class="form-control" ${required} ${dataAttr} />`;
    case 'textarea':
      return `<textarea name="${fieldName}" class="form-control" rows="3" ${required} ${dataAttr}></textarea>`;
    case 'select':
      return `<select name="${fieldName}" class="form-control" ${required} ${dataAttr}><option>Select...</option></select>`;
    case 'text':
    default:
      return `<input type="text" name="${fieldName}" class="form-control" ${required} ${dataAttr} />`;
  }
}

/**
 * Handle template form submission
 */
function handleTemplateSubmit(e) {
  e.preventDefault();
  
  if (!currentSubmissionContext.projectTemplateId) {
    showToast('Please select a template first', 'error');
    return;
  }

  const template = currentSubmissionContext.template;
  const formEl = document.getElementById('dynamicTemplateForm');
  const data = {};

  if (template.template_type === 'table') {
    const tableBody = document.getElementById('templateTableBody');
    const rows = [];

    if (tableBody) {
      Array.from(tableBody.querySelectorAll('tr')).forEach(row => {
        const rowData = {};
        let hasValue = false;

        row.querySelectorAll('input[data-column]').forEach(input => {
          const column = input.getAttribute('data-column');
          const value = input.value;
          rowData[column] = value;
          if (String(value).trim() !== '') hasValue = true;
        });

        if (hasValue) rows.push(rowData);
      });
    }

    if (rows.length === 0) {
      showToast('Please add at least one row of data', 'error');
      return;
    }

    data.columns = template.columns || [];
    data.rows = rows;
  } else {
    const fields = [];
    const rows = [];
    const rowMap = {};

    if (formEl) {
      formEl.querySelectorAll('[data-field-label]').forEach(input => {
        fields.push({
          label: input.getAttribute('data-field-label'),
          value: input.value
        });
      });

      formEl.querySelectorAll('[data-row-label]').forEach(input => {
        const rowLabel = input.getAttribute('data-row-label');
        const cellLabel = input.getAttribute('data-cell-label');
        if (!rowMap[rowLabel]) {
          rowMap[rowLabel] = { label: rowLabel, cells: [] };
        }
        rowMap[rowLabel].cells.push({ label: cellLabel, value: input.value });
      });
    }

    Object.values(rowMap).forEach(row => rows.push(row));

    if (fields.length === 0 && rows.length === 0) {
      showToast('Please fill out the template before submitting', 'error');
      return;
    }

    data.fields = fields;
    data.rows = rows;
  }
  
  // Get submission date
  const submissionDate = document.getElementById('submissionDate').value;
  if (!submissionDate) {
    showToast('Please select submission date', 'error');
    return;
  }
  
  const token = localStorage.getItem('auth_token');
  
  // Submit template data
  fetch(`/api/project-templates/${currentSubmissionContext.projectTemplateId}/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      data: data,
      submissionDate: submissionDate
    })
  })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        showToast('Template submitted successfully', 'success');
        document.getElementById('dynamicTemplateForm').reset();
        loadSubmissionHistory();
      } else {
        showToast(data.message || 'Failed to submit template', 'error');
      }
    })
    .catch(error => {
      console.error('Error submitting template:', error);
      showToast('Error submitting template', 'error');
    });
}

/**
 * Load submission history for current project
 */
function loadSubmissionHistory() {
  const projectId = currentSubmissionContext.projectId;
  if (!projectId) return;
  
  const token = localStorage.getItem('auth_token');
  
  fetch(`/api/project-templates/${projectId}/submissions`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
    .then(response => response.json())
    .then(data => {
      if (data.success && Array.isArray(data.data)) {
        const tbody = document.getElementById('submissionsTableBody');
        
        if (data.data.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px;">No submissions yet</td></tr>';
          return;
        }
        
        tbody.innerHTML = data.data.map(submission => `
          <tr>
            <td>${submission.template?.name || 'N/A'}</td>
            <td>${formatDate(submission.submission_date)}</td>
            <td><span class="status-badge status-${submission.status}">${submission.status}</span></td>
            <td>${formatDate(submission.created_at)}</td>
            <td>
              <button class="btn btn-sm" onclick="viewSubmissionDetail(${submission.id})">View</button>
            </td>
          </tr>
        `).join('');
      }
    })
    .catch(error => console.error('Error loading submissions:', error));
}

/**
 * View submission details
 */
function viewSubmissionDetail(submissionId) {
  const token = localStorage.getItem('auth_token');
  
  fetch(`/api/project-templates/submissions/${submissionId}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        const submission = data.data;
        const modalContent = document.getElementById('submissionModalContent');
        
        let html = `
          <div style="margin-bottom: 20px;">
            <p><strong>Template:</strong> ${submission.template?.name || 'N/A'}</p>
            <p><strong>Date:</strong> ${formatDate(submission.submission_date)}</p>
            <p><strong>Status:</strong> <span class="status-badge status-${submission.status}">${submission.status}</span></p>
            <p><strong>Submitted On:</strong> ${formatDate(submission.created_at)}</p>
        `;
        
        if (submission.status === 'approved' || submission.status === 'rejected') {
          html += `<p><strong>Reviewed By:</strong> ${submission.reviewed_by || 'N/A'}</p>`;
          if (submission.review_comment) {
            html += `<p><strong>Review Comment:</strong> ${submission.review_comment}</p>`;
          }
        }
        
        html += '</div>';
        
        // Display submitted data
        html += '<h4>Submitted Data:</h4>';
        html += renderSubmissionData(submission);
        
        modalContent.innerHTML = html;
        document.getElementById('submissionModalTitle').textContent = `${submission.template?.name || 'Submission'} - ${formatDate(submission.submission_date)}`;
        document.getElementById('viewSubmissionModal').style.display = 'flex';
      }
    })
    .catch(error => console.error('Error loading submission details:', error));
}

function renderSubmissionData(submission) {
  const snapshot = submission.template_snapshot || submission.template || {};
  const templateType = snapshot.template_type || 'form';
  const data = submission.data || {};

  if (templateType === 'table' && Array.isArray(data.rows)) {
    const columns = snapshot.columns || data.columns || [];
    const headerCells = columns.map(col => `<th style="padding: 8px; border: 1px solid #ddd; text-align: left;">${col}</th>`).join('');
    const bodyRows = data.rows.map(row => `
      <tr>
        ${columns.map(col => `<td style="padding: 8px; border: 1px solid #ddd;">${row[col] || ''}</td>`).join('')}
      </tr>
    `).join('');

    return `
      <div style="background: #f5f5f5; padding: 15px; border-radius: 6px; overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background: #e0e0e0;">${headerCells}</tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
    `;
  }

  if (Array.isArray(data.fields)) {
    const fieldRows = data.fields.map(field => `
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
              <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Field</th>
              <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Value</th>
            </tr>
          </thead>
          <tbody>${fieldRows}</tbody>
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

/**
 * Initialize template submissions
 */
function initTemplateSubmissions() {
  const projectSelect = document.getElementById('submissionProjectSelect');
  const templateSelect = document.getElementById('submissionTemplateSelect');
  const dateInput = document.getElementById('submissionDate');
  const form = document.getElementById('dynamicTemplateForm');
  
  if (projectSelect) {
    loadProjectsForSubmissions();
    projectSelect.addEventListener('change', () => {
      loadTemplatesForProject();
      loadSubmissionHistory();
    });
  }
  
  if (templateSelect) {
    templateSelect.addEventListener('change', onTemplateSelected);
  }
  
  if (dateInput) {
    dateInput.addEventListener('change', loadSubmissionHistory);
    if (!dateInput.value) {
      dateInput.valueAsDate = new Date();
    }
  }
  
  if (form) {
    form.addEventListener('submit', handleTemplateSubmit);
  }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('submissionProjectSelect')) {
    initTemplateSubmissions();
  }
});
