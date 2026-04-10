/**
 * Advanced Template Designer Module
 * Allows superadmin to create professional templates with:
 * - Multiple rows with cells
 * - Cell merging (colspan, rowspan)
 * - Professional layout
 */

let templateDesignerState = {
  fields: [],
  rows: [],
  currentTemplateName: '',
  currentTemplateDescription: '',
  isDefault: false
};

/**
 * Open advanced template designer modal
 */
function openAdvancedTemplateDesigner() {
  templateDesignerState = {
    fields: [],
    rows: [],
    currentTemplateName: '',
    currentTemplateDescription: '',
    isDefault: false
  };
  
  // Show designer interface
  document.getElementById('advancedTemplateDesigner').style.display = 'flex';
  renderTemplatePreview();
}

/**
 * Add a new row to template
 */
function addTemplateRow() {
  const rowLabel = prompt('Enter row label (e.g., "Tunnel Section P1"):');
  if (!rowLabel) return;
  
  const numCells = prompt('How many cells in this row?', '3');
  if (!numCells || isNaN(numCells)) return;
  
  const cells = [];
  for (let i = 0; i < parseInt(numCells); i++) {
    cells.push(`Cell ${i + 1}`);
  }
  
  templateDesignerState.rows.push({
    label: rowLabel,
    cells: cells
  });
  
  renderTemplatePreview();
  showToast(`Row "${rowLabel}" added with ${numCells} cells`, 'success');
}

/**
 * Add a new field to template
 */
function addTemplateField() {
  const fieldLabel = prompt('Enter field label:');
  if (!fieldLabel) return;
  
  const fieldType = prompt('Field type (text/number/decimal/date/textarea):', 'text');
  const isRequired = confirm('Is this field required?');
  
  templateDesignerState.fields.push({
    label: fieldLabel,
    type: fieldType,
    required: isRequired,
    colspan: 1,
    rowspan: 1
  });
  
  renderTemplatePreview();
  showToast(`Field "${fieldLabel}" added`, 'success');
}

/**
 * Merge cells in template row
 */
function mergeCells() {
  if (templateDesignerState.rows.length === 0) {
    showToast('Add rows first before merging cells', 'error');
    return;
  }
  
  const rowIndex = prompt('Enter row index (0-based):', '0');
  if (rowIndex === null || isNaN(rowIndex)) return;
  
  const cellIndex = prompt('Enter cell index to merge (0-based):', '0');
  if (cellIndex === null || isNaN(cellIndex)) return;
  
  const colspan = prompt('colspan (number of columns to merge):', '2');
  const rowspan = prompt('rowspan (number of rows to merge):', '1');
  
  const row = templateDesignerState.rows[parseInt(rowIndex)];
  if (row && row.cells[parseInt(cellIndex)]) {
    row.cells[parseInt(cellIndex)] = {
      label: row.cells[parseInt(cellIndex)],
      colspan: parseInt(colspan),
      rowspan: parseInt(rowspan)
    };
    renderTemplatePreview();
    showToast('Cells merged successfully', 'success');
  }
}

/**
 * Delete a row from template
 */
function deleteTemplateRow(rowIndex) {
  if (confirm('Delete this row?')) {
    templateDesignerState.rows.splice(rowIndex, 1);
    renderTemplatePreview();
    showToast('Row deleted', 'success');
  }
}

/**
 * Delete a field from template
 */
function deleteTemplateField(fieldIndex) {
  if (confirm('Delete this field?')) {
    templateDesignerState.fields.splice(fieldIndex, 1);
    renderTemplatePreview();
    showToast('Field deleted', 'success');
  }
}

/**
 * Render template preview
 */
function renderTemplatePreview() {
  const preview = document.getElementById('templateDesignerPreview');
  if (!preview) return;
  
  let html = '<div style="padding: 20px;">';
  
  // Template info
  html += `
    <div style="margin-bottom: 20px; padding: 15px; background: #f9f9f9; border-radius: 6px;">
      <h4 style="margin: 0 0 10px 0;">Template Information</h4>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
        <div>
          <label>Template Name:</label>
          <input type="text" id="designerTemplateName" class="form-control" placeholder="e.g., Daily Progress Report" value="${templateDesignerState.currentTemplateName}" onchange="templateDesignerState.currentTemplateName = this.value;" />
        </div>
        <div>
          <label>Description:</label>
          <textarea id="designerTemplateDesc" class="form-control" placeholder="Brief description" onchange="templateDesignerState.currentTemplateDescription = this.value;" style="resize: none; height: 40px;">${templateDesignerState.currentTemplateDescription}</textarea>
        </div>
      </div>
      <label style="margin-top: 10px; display: flex; align-items: center; gap: 8px;">
        <input type="checkbox" id="designerIsDefault" ${templateDesignerState.isDefault ? 'checked' : ''} onchange="templateDesignerState.isDefault = this.checked;" />
        Mark as default template
      </label>
    </div>
  `;
  
  // Rows preview
  if (templateDesignerState.rows.length > 0) {
    html += '<h4 style="margin: 20px 0 10px 0;">Rows Structure Preview:</h4>';
    html += '<div style="border: 1px solid #ddd; border-radius: 6px; overflow: hidden; margin-bottom: 20px;">';
    
    templateDesignerState.rows.forEach((row, rowIndex) => {
      html += `
        <div style="border-bottom: 1px solid #ddd; padding: 15px; background: ${rowIndex % 2 === 0 ? '#f9f9f9' : 'white'};">
          <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
            <h5 style="margin: 0; color: #1a5490;">${row.label}</h5>
            <button type="button" class="btn btn-sm btn-danger" onclick="deleteTemplateRow(${rowIndex})">Delete</button>
          </div>
          <div style="display: grid; grid-template-columns: repeat(${row.cells.length}, 1fr); gap: 8px;">
            ${row.cells.map((cell, cellIndex) => {
              const cellObj = typeof cell === 'string' ? { label: cell, colspan: 1, rowspan: 1 } : cell;
              return `
                <div style="padding: 12px; background: #e3f2fd; border: 1px solid #90caf9; border-radius: 4px; text-align: center; grid-column: span ${cellObj.colspan || 1};">
                  <small>${typeof cell === 'string' ? cell : cell.label}</small>
                  ${cellObj.colspan > 1 || cellObj.rowspan > 1 ? `<br/><tiny style="color: #666;">${cellObj.colspan}×${cellObj.rowspan}</tiny>` : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    });
    
    html += '</div>';
  }
  
  // Fields preview
  if (templateDesignerState.fields.length > 0) {
    html += '<h4 style="margin: 20px 0 10px 0;">Fields:</h4>';
    html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 10px; margin-bottom: 20px;">';
    
    templateDesignerState.fields.forEach((field, fieldIndex) => {
      html += `
        <div style="padding: 12px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: start;">
            <div>
              <strong>${field.label}</strong>
              <div style="font-size: 12px; color: #666;">Type: ${field.type} ${field.required ? '(Required)' : ''}</div>
            </div>
            <button type="button" class="btn btn-xs btn-danger" onclick="deleteTemplateField(${fieldIndex})">×</button>
          </div>
        </div>
      `;
    });
    
    html += '</div>';
  }
  
  // Empty state
  if (templateDesignerState.rows.length === 0 && templateDesignerState.fields.length === 0) {
    html += '<div style="text-align: center; padding: 40px 20px; color: #999;"><p>No rows or fields added yet. Click the buttons above to start designing.</p></div>';
  }
  
  html += '</div>';
  preview.innerHTML = html;
}

/**
 * Save template from designer
 */
function saveDesignedTemplate() {
  if (!templateDesignerState.currentTemplateName) {
    showToast('Please enter a template name', 'error');
    return;
  }
  
  if (templateDesignerState.rows.length === 0 && templateDesignerState.fields.length === 0) {
    showToast('Please add at least one row or field', 'error');
    return;
  }
  
  const token = localStorage.getItem('auth_token');
  
  const templateData = {
    name: templateDesignerState.currentTemplateName,
    description: templateDesignerState.currentTemplateDescription,
    fields: templateDesignerState.fields,
    rows: templateDesignerState.rows,
    isDefault: templateDesignerState.isDefault
  };
  
  fetch('/api/templates', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(templateData)
  })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        showToast('Template created successfully', 'success');
        closeModal('advancedTemplateDesigner');
        if (window.loadTemplates) {
          loadTemplates();
        }
      } else {
        showToast(data.message || 'Failed to create template', 'error');
      }
    })
    .catch(error => {
      console.error('Error creating template:', error);
      showToast('Error creating template', 'error');
    });
}

/**
 * Load default template into designer
 */
function loadDefaultTemplate(templateName) {
  const token = localStorage.getItem('auth_token');
  
  fetch('/api/templates', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        const template = data.templates.find(t => t.name.includes(templateName));
        if (template) {
          templateDesignerState.currentTemplateName = template.name;
          templateDesignerState.currentTemplateDescription = template.description || '';
          templateDesignerState.fields = template.fields || [];
          templateDesignerState.rows = template.rows || [];
          templateDesignerState.isDefault = template.is_default || false;
          
          renderTemplatePreview();
          showToast(`Loaded template: ${template.name}`, 'success');
        }
      }
    })
    .catch(error => console.error('Error loading template:', error));
}

/**
 * Initialize advanced template designer
 */
function initAdvancedTemplateDesigner() {
  // Listen for template creation button
  const createBtn = document.getElementById('createTemplateBtn');
  if (createBtn) {
    createBtn.addEventListener('click', openAdvancedTemplateDesigner);
  }
  
  // Initialize preview on load
  renderTemplatePreview();
}

// Initialize when document is ready
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('advancedTemplateDesigner')) {
    initAdvancedTemplateDesigner();
  }
});
