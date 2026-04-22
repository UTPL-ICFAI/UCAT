/**
 * Template Submissions Module
 * Handles daily template submissions for site engineers
 */

// Store current submission context
let currentSubmissionContext = {
  projectId: null,
  templateId: null,
  projectTemplateId: null,
  template: null,
  originalSubmissionId: null,
};

function syncTemplateSubmissionProject(projectId) {
  const select = document.getElementById("submissionProjectSelect");
  if (!select) return;

  if (!projectId) {
    currentSubmissionContext.projectId = null;
    currentSubmissionContext.originalSubmissionId = null;
    select.disabled = false;
    return;
  }

  const value = String(projectId);
  const existing = Array.from(select.options).find(
    (opt) => opt.value === value,
  );
  if (!existing) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = `Project ${value}`;
    select.appendChild(option);
  }

  select.value = value;
  select.disabled = true;
  currentSubmissionContext.projectId = value;
  loadTemplatesForProject();
  loadSubmissionHistory();
}

function normalizeTemplate(template) {
  const templateType =
    template.template_type ||
    (template.columns && template.columns.length > 0 ? "table" : "form");
  const detailedColumns = normalizeTableColumns(template.columns);
  return {
    ...template,
    template_type: templateType,
    fields: Array.isArray(template.fields) ? template.fields : [],
    rows: Array.isArray(template.rows) ? template.rows : [],
    columns: detailedColumns,
  };
}

function normalizeFormulaType(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === "AVG") return "AVERAGE";
  if (["SUM", "TOTAL", "AVERAGE", "MIN", "MAX"].includes(normalized)) {
    return normalized;
  }
  return null;
}

function normalizeTableColumns(columnsInput) {
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
          formulaType: null,
          formulaExpression: null,
          formulaScope: "row",
          formulaSourceColumns: [],
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
        formulaType: normalizeFormulaType(column.formulaType),
        formulaExpression:
          column.formulaExpression === undefined ||
          column.formulaExpression === null
            ? null
            : String(column.formulaExpression),
        formulaScope:
          String(column.formulaScope || "row").toLowerCase() === "column"
            ? "column"
            : "row",
        formulaSourceColumns: Array.isArray(column.formulaSourceColumns)
          ? column.formulaSourceColumns
              .map((entry) => String(entry || "").trim())
              .filter(Boolean)
          : [],
      };
    })
    .filter(Boolean)
    .map((column) => ({
      ...column,
      isLocked:
        !!column.isLocked || !!column.formulaType || !!column.formulaExpression,
    }));
}

function getTemplateColumns() {
  const template = currentSubmissionContext.template || {};
  return normalizeTableColumns(template.columns);
}

function toNumeric(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function aggregateFormula(values, formulaType) {
  if (!Array.isArray(values) || values.length === 0) return "";

  switch (formulaType) {
    case "SUM":
    case "TOTAL":
      return String(values.reduce((acc, item) => acc + item, 0));
    case "AVERAGE":
      return String(values.reduce((acc, item) => acc + item, 0) / values.length);
    case "MIN":
      return String(Math.min(...values));
    case "MAX":
      return String(Math.max(...values));
    default:
      return "";
  }
}

function letterToIndex(letters) {
  let index = 0;
  String(letters || "")
    .toUpperCase()
    .split("")
    .forEach((char) => {
      index = index * 26 + (char.charCodeAt(0) - 64);
    });
  return Math.max(0, index - 1);
}

function valueForFormulaRef(token, rowIndex, rows, columns) {
  const match = String(token || "").toUpperCase().match(/^([A-Z]+)(\d+)?$/);
  if (!match) return null;
  const colIdx = letterToIndex(match[1]);
  const col = columns[colIdx];
  if (!col) return null;
  const targetRowIdx = match[2] ? parseInt(match[2], 10) - 1 : rowIndex;
  const row = rows[targetRowIdx];
  if (!row) return null;
  const input = row.querySelector(`input[data-column="${col.name}"]`);
  if (!input) return null;
  return toNumeric(input.value);
}

function evaluateFormulaExpression(expression, rowIndex, rows, columns) {
  const raw = String(expression || "").trim();
  if (!raw) return "";
  const expr = raw.startsWith("=") ? raw.slice(1).trim() : raw;

  const ifMatch = expr.match(/^IF\((.+),(.+),(.+)\)$/i);
  if (ifMatch) {
    const condition = ifMatch[1]
      .replace(/([A-Z]+\d*)/g, (token) => {
        const value = valueForFormulaRef(token, rowIndex, rows, columns);
        return value === null ? "0" : String(value);
      })
      .replace(/=/g, "==")
      .replace(/>==/g, ">=")
      .replace(/<==/g, "<=")
      .replace(/!==/g, "!=");

    let pass = false;
    try {
      pass = !!Function(`return (${condition});`)();
    } catch (error) {
      pass = false;
    }
    const trueValue = ifMatch[2].trim().replace(/^"|"$/g, "");
    const falseValue = ifMatch[3].trim().replace(/^"|"$/g, "");
    return pass ? trueValue : falseValue;
  }

  const sumMatch = expr.match(/^SUM\(([A-Z]+\d*):([A-Z]+\d*)\)$/i);
  if (sumMatch) {
    const startCell = String(sumMatch[1]).toUpperCase();
    const endCell = String(sumMatch[2]).toUpperCase();
    const startCol = letterToIndex(startCell.match(/^([A-Z]+)/)[1]);
    const endCol = letterToIndex(endCell.match(/^([A-Z]+)/)[1]);
    const startRow = startCell.match(/(\d+)$/)
      ? parseInt(startCell.match(/(\d+)$/)[1], 10) - 1
      : 0;
    const endRow = endCell.match(/(\d+)$/)
      ? parseInt(endCell.match(/(\d+)$/)[1], 10) - 1
      : rows.length - 1;

    let total = 0;
    for (let r = Math.max(0, startRow); r <= Math.min(endRow, rows.length - 1); r += 1) {
      for (let c = Math.max(0, startCol); c <= Math.min(endCol, columns.length - 1); c += 1) {
        const col = columns[c];
        if (!col) continue;
        const input = rows[r].querySelector(`input[data-column="${col.name}"]`);
        if (!input) continue;
        const numeric = toNumeric(input.value);
        if (numeric !== null) total += numeric;
      }
    }
    return String(total);
  }

  const arithmetic = expr.replace(/([A-Z]+\d*)/g, (token) => {
    const value = valueForFormulaRef(token, rowIndex, rows, columns);
    return value === null ? "0" : String(value);
  });

  try {
    const result = Function(`return (${arithmetic});`)();
    if (result === null || result === undefined || Number.isNaN(result)) return "";
    return String(result);
  } catch (error) {
    return "";
  }
}

function applyColumnPoliciesToRow(tr, rowIndex) {
  const columns = getTemplateColumns();

  columns.forEach((column) => {
    const input = tr.querySelector(`input[data-column="${column.name}"]`);
    if (!input) return;

    const rowFixedValues = column.rowFixedValues || {};
    const hasRowFixed = Object.prototype.hasOwnProperty.call(
      rowFixedValues,
      String(rowIndex),
    );

    let enforcedValue = null;
    if (hasRowFixed) {
      enforcedValue = rowFixedValues[String(rowIndex)];
    } else if (
      column.fixedValue !== null &&
      column.fixedValue !== undefined &&
      column.fixedValue !== ""
    ) {
      enforcedValue = column.fixedValue;
    }

    if (enforcedValue !== null && enforcedValue !== undefined) {
      input.value = String(enforcedValue);
    }

    const shouldDisable = !!column.formulaType || !!column.isLocked;
    input.disabled = shouldDisable;
    input.style.background = shouldDisable ? "#f3f4f6" : "";
    input.style.cursor = shouldDisable ? "not-allowed" : "";
  });
}

function reindexTemplateTableRows() {
  const tableBody = document.getElementById("templateTableBody");
  if (!tableBody) return;

  Array.from(tableBody.querySelectorAll("tr")).forEach((tr, rowIndex) => {
    tr.querySelectorAll("input[data-column]").forEach((input) => {
      input.setAttribute("data-row-index", String(rowIndex));
    });
    applyColumnPoliciesToRow(tr, rowIndex);
  });
}

function recomputeTemplateTableFormulas() {
  const tableBody = document.getElementById("templateTableBody");
  if (!tableBody) return;

  const rows = Array.from(tableBody.querySelectorAll("tr"));
  const columns = getTemplateColumns();
  const columnNames = columns.map((column) => column.name);

  columns.forEach((column) => {
    if (!column.formulaType) return;

    const sources = Array.isArray(column.formulaSourceColumns)
      ? column.formulaSourceColumns.filter(Boolean)
      : [];
    const effectiveSources =
      sources.length > 0
        ? sources
        : columnNames.filter((name) => name !== column.name);

    if (column.formulaScope === "column") {
      const acrossValues = [];
      rows.forEach((tr) => {
        effectiveSources.forEach((source) => {
          const sourceInput = tr.querySelector(`input[data-column="${source}"]`);
          if (!sourceInput) return;
          const numeric = toNumeric(sourceInput.value);
          if (numeric !== null) acrossValues.push(numeric);
        });
      });

      const aggregate = aggregateFormula(acrossValues, column.formulaType);
      rows.forEach((tr) => {
        const formulaInput = tr.querySelector(`input[data-column="${column.name}"]`);
        if (formulaInput) formulaInput.value = aggregate;
      });
      return;
    }

    rows.forEach((tr) => {
      const perRowValues = effectiveSources
        .map((source) => {
          const sourceInput = tr.querySelector(`input[data-column="${source}"]`);
          return sourceInput ? toNumeric(sourceInput.value) : null;
        })
        .filter((value) => value !== null);

      const formulaInput = tr.querySelector(`input[data-column="${column.name}"]`);
      if (formulaInput) {
        formulaInput.value = aggregateFormula(perRowValues, column.formulaType);
      }
    });
  });

  columns.forEach((column) => {
    if (!column.formulaExpression) return;
    rows.forEach((tr, rowIndex) => {
      const formulaInput = tr.querySelector(`input[data-column="${column.name}"]`);
      if (!formulaInput) return;
      formulaInput.value = evaluateFormulaExpression(
        column.formulaExpression,
        rowIndex,
        rows,
        columns,
      );
    });
  });
}

/**
 * Load projects for submission project select
 */
function loadProjectsForSubmissions() {
  const token = localStorage.getItem("auth_token");

  fetch("/api/projects", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
    .then((response) => response.json())
    .then((data) => {
      const projects = Array.isArray(data)
        ? data
        : data.success && Array.isArray(data.data)
          ? data.data
          : [];
      const select = document.getElementById("submissionProjectSelect");
      if (!select) return;

      select.innerHTML = '<option value="">Choose a project...</option>';

      projects.forEach((project) => {
        const option = document.createElement("option");
        option.value = project.id;
        option.textContent = project.name;
        select.appendChild(option);
      });

      if (typeof currentProjectId !== "undefined" && currentProjectId) {
        syncTemplateSubmissionProject(currentProjectId);
      }
    })
    .catch((error) => console.error("Error loading projects:", error));
}

/**
 * Load templates assigned to selected project
 */
function loadTemplatesForProject() {
  const projectId = document.getElementById("submissionProjectSelect").value;
  if (!projectId) {
    document.getElementById("submissionTemplateSelect").innerHTML =
      '<option value="">Choose a template...</option>';
    document.getElementById("templateFormContainer").style.display = "none";
    return;
  }

  const token = localStorage.getItem("auth_token");

  fetch(`/api/project-templates/${projectId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.success && Array.isArray(data.data)) {
        const select = document.getElementById("submissionTemplateSelect");
        select.innerHTML = '<option value="">Choose a template...</option>';

        data.data.forEach((assignment) => {
          const normalizedTemplate = normalizeTemplate(
            assignment.template || {},
          );
          const option = document.createElement("option");
          option.value = assignment.template_id;
          option.dataset.projectTemplateId = assignment.id;
          option.dataset.templateData = JSON.stringify(normalizedTemplate);
          option.textContent = normalizedTemplate.name || "Template";
          select.appendChild(option);
        });
      }
    })
    .catch((error) => console.error("Error loading templates:", error));
}

/**
 * Handle template selection change
 */
function onTemplateSelected() {
  const select = document.getElementById("submissionTemplateSelect");
  clearResubmitBanner();
  currentSubmissionContext.originalSubmissionId = null;
  const selectedOption = select.options[select.selectedIndex];

  if (!select.value) {
    document.getElementById("templateFormContainer").style.display = "none";
    return;
  }

  try {
    currentSubmissionContext.templateId = select.value;
    currentSubmissionContext.projectId = document.getElementById(
      "submissionProjectSelect",
    ).value;
    currentSubmissionContext.projectTemplateId =
      selectedOption.dataset.projectTemplateId;
    currentSubmissionContext.template = JSON.parse(
      selectedOption.dataset.templateData,
    );

    renderTemplateForm();
    document.getElementById("templateFormContainer").style.display = "block";
  } catch (error) {
    console.error("Error parsing template data:", error);
  }
}

/**
 * Render template form dynamically based on template structure
 */
function renderTemplateForm() {
  const template = currentSubmissionContext.template;
  if (!template) return;

  const form = document.getElementById("dynamicTemplateForm");
  const title = document.getElementById("templateFormTitle");

  title.textContent = template.name;

  // Build form HTML based on template fields
  let formHTML = "";

  if (template.template_type === "table") {
    formHTML = renderTableTemplate(template);
  } else if (template.rows && template.rows.length > 0) {
    // Render template with rows structure
    formHTML = renderRowBasedTemplate(template);
  } else if (template.fields && template.fields.length > 0) {
    // Render simple field-based template
    formHTML = renderFieldBasedTemplate(template);
  }

  form.innerHTML = formHTML;

  if (template.template_type === "table") {
    addTemplateTableRow();
  }
}

/**
 * Render table-based template (columns + rows)
 */
function renderTableTemplate(template) {
  const columns = getTemplateColumns();
  const rowLimit = template.row_limit || null;

  let html = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
      <button type="button" class="btn btn-secondary" onclick="addTemplateTableRow()">+ Add Row</button>
      ${rowLimit ? `<span style="font-size: 12px; color: #666;">Row limit: ${rowLimit}</span>` : ""}
    </div>
    <div style="overflow-x: auto; border: 1px solid #e5e7eb; border-radius: 6px;">
      <table style="width: 100%; border-collapse: collapse;" id="templateTable">
        <thead>
          <tr style="background: #f0f0f0;">
            ${columns
              .map((col) => {
                const meta = [];
                if (col.formulaType) {
                  meta.push(`${col.formulaType}${col.formulaScope === "column" ? " (across rows)" : ""}`);
                }
                if (col.formulaExpression) {
                  meta.push(`expr`);
                }
                if (col.isLocked) meta.push("locked");
                return `<th style="padding: 10px; border: 1px solid #ddd; text-align: left; font-weight: 600; font-size: 12px;">${col.name}${meta.length > 0 ? `<div style="font-size: 10px; color: #666; font-weight: 500; margin-top: 2px;">${meta.join(" | ")}</div>` : ""}</th>`;
              })
              .join("")}
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
  const columns = getTemplateColumns();
  const rowLimit = template.row_limit || null;
  const tableBody = document.getElementById("templateTableBody");
  if (!tableBody) return;

  if (rowLimit && tableBody.children.length >= rowLimit) {
    showToast("Row limit reached for this template", "warning");
    return;
  }

  const rowIndex = tableBody.children.length;
  const row = document.createElement("tr");
  row.innerHTML = `
    ${columns
      .map(
        (col) => `
      <td style="padding: 8px; border: 1px solid #ddd;">
        <input type="text" class="form-control" data-column="${col.name}" data-row-index="${rowIndex}" oninput="recomputeTemplateTableFormulas()" />
      </td>
    `,
      )
      .join("")}
    <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">
      <button type="button" class="btn btn-small btn-danger" onclick="removeTemplateTableRow(this)">Remove</button>
    </td>
  `;

  tableBody.appendChild(row);
  applyColumnPoliciesToRow(row, rowIndex);
  recomputeTemplateTableFormulas();
}

function removeTemplateTableRow(buttonEl) {
  const tr = buttonEl && typeof buttonEl.closest === "function" ? buttonEl.closest("tr") : null;
  if (!tr) return;
  tr.remove();
  reindexTemplateTableRows();
  recomputeTemplateTableFormulas();
}

/**
 * Render field-based template (simple columns)
 */
function renderFieldBasedTemplate(template) {
  let html =
    '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px;">';

  template.fields.forEach((field, index) => {
    html += `
      <div class="form-group">
        <label>${field.label}${field.required ? " *" : ""}</label>
        ${renderFieldInput(field, index, field.label)}
      </div>
    `;
  });

  html += "</div>";
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
        // FIX: Bug3 - Cells may be objects; always render by label when present.
        const cellLabel =
          typeof cell === "object" ? cell.label || "Cell" : cell;
        const isRequired = typeof cell === "object" ? !!cell.required : false;
        const fieldKey = `row_${rowIndex}_cell_${cellIndex}`;
        html += `
          <div class="form-group">
            <label>${cellLabel}${isRequired ? " *" : ""}</label>
            <input type="text" name="${fieldKey}" class="form-control" placeholder="Enter value" data-row-label="${row.label}" data-cell-label="${cellLabel}" ${isRequired ? "required" : ""} />
          </div>
        `;
      });
    }

    html += "</div></div>";
  });

  // Also render standalone fields if any
  if (template.fields && template.fields.length > 0) {
    html +=
      '<div style="border: 1px solid #ddd; border-radius: 6px; padding: 15px; background: #f9f9f9;"><h4 style="margin: 0 0 15px 0;">Additional Information</h4><div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">';

    template.fields.forEach((field, index) => {
      html += `
        <div class="form-group">
          <label>${field.label}${field.required ? " *" : ""}</label>
          ${renderFieldInput(field, index, field.label)}
        </div>
      `;
    });

    html += "</div></div>";
  }

  html += "</div>";
  return html;
}

/**
 * Render individual field input based on field type
 */
function renderFieldInput(field, index, label) {
  const fieldName = `field_${index}`;
  const required = field.required ? "required" : "";
  const dataAttr = label ? `data-field-label="${label}"` : "";

  switch (field.type) {
    case "number":
      return `<input type="number" name="${fieldName}" class="form-control" step="0.01" ${required} ${dataAttr} />`;
    case "decimal":
      return `<input type="number" name="${fieldName}" class="form-control" step="0.01" ${required} ${dataAttr} />`;
    case "date":
      return `<input type="date" name="${fieldName}" class="form-control" ${required} ${dataAttr} />`;
    case "textarea":
      return `<textarea name="${fieldName}" class="form-control" rows="3" ${required} ${dataAttr}></textarea>`;
    case "select":
      const options = Array.isArray(field.options) ? field.options : [];
      return `<select name="${fieldName}" class="form-control" ${required} ${dataAttr}><option value="">Select...</option>${options.map((opt) => `<option value="${String(opt).replace(/"/g, "&quot;")}">${opt}</option>`).join("")}</select>`;
    case "text":
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
    showToast("Please select a template first", "error");
    return;
  }

  const template = currentSubmissionContext.template;
  const formEl = document.getElementById("dynamicTemplateForm");
  const data = {};

  if (template.template_type === "table") {
    recomputeTemplateTableFormulas();
    const tableBody = document.getElementById("templateTableBody");
    const rows = [];
    const columns = getTemplateColumns();
    const columnNames = columns.map((column) => column.name);

    if (tableBody) {
      Array.from(tableBody.querySelectorAll("tr")).forEach((row) => {
        const rowData = {};
        let hasValue = false;

        row.querySelectorAll("input[data-column]").forEach((input) => {
          const column = input.getAttribute("data-column");
          const value = input.value;
          rowData[column] = value;
          if (String(value).trim() !== "") hasValue = true;
        });

        columnNames.forEach((columnName) => {
          if (!Object.prototype.hasOwnProperty.call(rowData, columnName)) {
            rowData[columnName] = "";
          }
        });

        if (hasValue) rows.push(rowData);
      });
    }

    if (rows.length === 0) {
      showToast("Please add at least one row of data", "error");
      return;
    }

    data.columns = columnNames;
    data.rows = rows;
  } else {
    const fields = [];
    const rows = [];
    const rowMap = {};

    if (formEl) {
      formEl.querySelectorAll("[data-field-label]").forEach((input) => {
        fields.push({
          label: input.getAttribute("data-field-label"),
          value: input.value,
        });
      });

      formEl.querySelectorAll("[data-row-label]").forEach((input) => {
        const rowLabel = input.getAttribute("data-row-label");
        const cellLabel = input.getAttribute("data-cell-label");
        if (!rowMap[rowLabel]) {
          rowMap[rowLabel] = { label: rowLabel, cells: [] };
        }
        rowMap[rowLabel].cells.push({ label: cellLabel, value: input.value });
      });
    }

    Object.values(rowMap).forEach((row) => rows.push(row));

    if (fields.length === 0 && rows.length === 0) {
      showToast("Please fill out the template before submitting", "error");
      return;
    }

    data.fields = fields;
    data.rows = rows;
  }

  // Get submission date
  const submissionDate = document.getElementById("submissionDate").value;
  if (!submissionDate) {
    showToast("Please select submission date", "error");
    return;
  }

  const token = localStorage.getItem("auth_token");

  // Submit template data
  fetch(
    `/api/project-templates/${currentSubmissionContext.projectTemplateId}/submit`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        data: data,
        submissionDate: submissionDate,
        originalSubmissionId: currentSubmissionContext.originalSubmissionId,
      }),
    },
  )
    .then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          payload.error ||
            payload.message ||
            `Failed to submit template (${response.status})`,
        );
      }
      return payload;
    })
    .then((data) => {
      if (data.success) {
        // FIX: Bug9 - Distinguish overwrite from new submission.
        if (data.updated) {
          showToast("Submission updated for this date", "warning");
        } else {
          showToast("Template submitted successfully", "success");
        }
        clearResubmitBanner();
        currentSubmissionContext.originalSubmissionId = null;
        document.getElementById("dynamicTemplateForm").reset();
        loadSubmissionHistory();
      } else {
        showToast(
          data.error || data.message || "Failed to submit template",
          "error",
        );
      }
    })
    .catch((error) => {
      console.error("Error submitting template:", error);
      showToast(error.message || "Error submitting template", "error");
    });
}

/**
 * Load submission history for current project
 */
function loadSubmissionHistory() {
  const projectId = currentSubmissionContext.projectId;
  // FIX: Bug8 - Guard against null project id to avoid /null/submissions requests.
  if (!projectId) return;

  const token = localStorage.getItem("auth_token");

  fetch(`/api/project-templates/${projectId}/submissions`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.success && Array.isArray(data.data)) {
        const tbody = document.getElementById("submissionsTableBody");

        if (data.data.length === 0) {
          tbody.innerHTML =
            '<tr><td colspan="5" style="text-align: center; padding: 20px;">No submissions yet</td></tr>';
          return;
        }

        tbody.innerHTML = data.data
          .map(
            (submission) => `
          <tr>
            <td>${submission.template?.name || "N/A"}</td>
            <td>${formatDate(submission.submission_date)}</td>
            <td><span class="status-badge status-${submission.status}">${submission.status}</span></td>
            <td>${formatDate(submission.created_at)}</td>
            <td>
              <button class="btn btn-sm" onclick="viewSubmissionDetail(${submission.id})">View</button>
              ${submission.status === "rejected" ? `<button class="btn btn-sm btn-warning" onclick="resubmitRejectedSubmission(${submission.id})">Resubmit</button>` : ""}
            </td>
          </tr>
        `,
          )
          .join("");
      }
    })
    .catch((error) => console.error("Error loading submissions:", error));
}

/**
 * View submission details
 */
function viewSubmissionDetail(submissionId) {
  const token = localStorage.getItem("auth_token");

  fetch(`/api/project-templates/submission/${submissionId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        const submission = data.data;
        const modalContent = document.getElementById("submissionModalContent");

        let html = `
          <div style="margin-bottom: 20px;">
            <p><strong>Template:</strong> ${submission.template?.name || "N/A"}</p>
            <p><strong>Date:</strong> ${formatDate(submission.submission_date)}</p>
            <p><strong>Status:</strong> <span class="status-badge status-${submission.status}">${submission.status}</span></p>
            <p><strong>Submitted On:</strong> ${formatDate(submission.created_at)}</p>
        `;

        if (
          submission.status === "approved" ||
          submission.status === "rejected"
        ) {
          html += `<p><strong>Reviewed By:</strong> ${submission.reviewed_by || "N/A"}</p>`;
          if (submission.review_comment) {
            html += `<p><strong>Review Comment:</strong> ${submission.review_comment}</p>`;
          }
        }

        html += "</div>";

        // Display submitted data
        html += "<h4>Submitted Data:</h4>";
        html += renderSubmissionData(submission);

        modalContent.innerHTML = html;
        document.getElementById("submissionModalTitle").textContent =
          `${submission.template?.name || "Submission"} - ${formatDate(submission.submission_date)}`;
        document.getElementById("viewSubmissionModal").style.display = "flex";
      }
    })
    .catch((error) =>
      console.error("Error loading submission details:", error),
    );
}

function renderSubmissionData(submission) {
  const snapshot = submission.template_snapshot || submission.template || {};
  const templateType = snapshot.template_type || "form";
  const data = submission.data || {};

  if (templateType === "table" && Array.isArray(data.rows)) {
    const columns = normalizeTableColumns(snapshot.columns || data.columns || []).map(
      (column) => column.name,
    );
    const headerCells = columns
      .map(
        (col) =>
          `<th style="padding: 8px; border: 1px solid #ddd; text-align: left;">${col}</th>`,
      )
      .join("");
    const bodyRows = data.rows
      .map(
        (row) => `
      <tr>
        ${columns.map((col) => `<td style="padding: 8px; border: 1px solid #ddd;">${row[col] || ""}</td>`).join("")}
      </tr>
    `,
      )
      .join("");

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
    const fieldRows = data.fields
      .map(
        (field) => `
      <tr>
        <td style="padding: 8px; border: 1px solid #ddd; font-weight: 600;">${field.label}</td>
        <td style="padding: 8px; border: 1px solid #ddd;">${field.value || "-"}</td>
      </tr>
    `,
      )
      .join("");

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
    const rowBlocks = data.rows
      .map((row) => {
        const cells = Array.isArray(row.cells) ? row.cells : [];
        const cellRows = cells
          .map(
            (cell) => `
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd; font-weight: 600;">${typeof cell === "object" ? cell.label || "Cell" : cell}</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${typeof cell === "object" ? cell.value || "-" : "-"}</td>
        </tr>
      `,
          )
          .join("");

        return `
        <div style="margin-bottom: 12px;">
          <div style="font-weight: 600; margin-bottom: 6px;">${row.label || "Row"}</div>
          <table style="width: 100%; border-collapse: collapse;">
            <tbody>${cellRows}</tbody>
          </table>
        </div>
      `;
      })
      .join("");

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
  const projectSelect = document.getElementById("submissionProjectSelect");
  const templateSelect = document.getElementById("submissionTemplateSelect");
  const dateInput = document.getElementById("submissionDate");
  const form = document.getElementById("dynamicTemplateForm");

  if (projectSelect) {
    loadProjectsForSubmissions();
    projectSelect.addEventListener("change", () => {
      currentSubmissionContext.projectId = projectSelect.value || null;
      loadTemplatesForProject();
      loadSubmissionHistory();
    });
  }

  if (templateSelect) {
    templateSelect.addEventListener("change", onTemplateSelected);
  }

  if (dateInput) {
    dateInput.addEventListener("change", loadSubmissionHistory);
    if (!dateInput.value) {
      dateInput.valueAsDate = new Date();
    }
  }

  if (form) {
    form.addEventListener("submit", handleTemplateSubmit);
  }
}

// FIX: Feature2 - Resubmit rejected entry by loading old data back into the same-date form.
function showResubmitBanner(comment) {
  const container = document.getElementById("templateFormContainer");
  if (!container) return;

  let banner = document.getElementById("resubmitBanner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "resubmitBanner";
    banner.style.background = "#fff8db";
    banner.style.border = "1px solid #f0cf6d";
    banner.style.padding = "10px 12px";
    banner.style.marginBottom = "12px";
    banner.style.borderRadius = "6px";
    container.insertBefore(banner, container.firstChild);
  }

  banner.innerHTML = `<strong>You are resubmitting a rejected entry.</strong> Review comment: ${comment || "No comment provided."}`;
}

function clearResubmitBanner() {
  const banner = document.getElementById("resubmitBanner");
  if (banner) banner.remove();
}

function prefillTemplateFormFromSubmission(submission) {
  const formEl = document.getElementById("dynamicTemplateForm");
  if (!formEl) return;

  const data = submission.data || {};

  if (Array.isArray(data.fields)) {
    data.fields.forEach((field) => {
      const input = formEl.querySelector(`[data-field-label="${field.label}"]`);
      if (input) input.value = field.value || "";
    });
  }

  if (Array.isArray(data.rows)) {
    const rowInputs = Array.from(
      formEl.querySelectorAll("[data-row-label][data-cell-label]"),
    );
    data.rows.forEach((row) => {
      const cells = Array.isArray(row.cells) ? row.cells : [];
      cells.forEach((cell) => {
        const cellLabel =
          typeof cell === "object" ? cell.label || "Cell" : String(cell);
        const cellValue = typeof cell === "object" ? cell.value || "" : "";
        const match = rowInputs.find(
          (inp) =>
            inp.getAttribute("data-row-label") === row.label &&
            inp.getAttribute("data-cell-label") === cellLabel,
        );
        if (match) match.value = cellValue;
      });
    });
  }

  if (
    Array.isArray(data.rows) &&
    currentSubmissionContext.template?.template_type === "table"
  ) {
    const tableBody = document.getElementById("templateTableBody");
    if (tableBody) {
      tableBody.innerHTML = "";
      data.rows.forEach((rowObj) => {
        addTemplateTableRow();
        const tr = tableBody.lastElementChild;
        if (!tr) return;
        tr.querySelectorAll("input[data-column]").forEach((input) => {
          const col = input.getAttribute("data-column");
          input.value = rowObj[col] || "";
        });
      });
      reindexTemplateTableRows();
      recomputeTemplateTableFormulas();
    }
  }
}

function resubmitRejectedSubmission(submissionId) {
  const token = localStorage.getItem("auth_token");
  fetch(`/api/project-templates/submission/${submissionId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
    .then((response) => response.json())
    .then((payload) => {
      if (!payload.success) {
        showToast(
          payload.error || "Failed to load rejected submission",
          "error",
        );
        return;
      }

      const submission = payload.data;
      currentSubmissionContext.originalSubmissionId = submission.id;
      const dateInput = document.getElementById("submissionDate");
      if (dateInput) dateInput.value = submission.submission_date;

      const projectSelect = document.getElementById("submissionProjectSelect");
      if (projectSelect) projectSelect.value = String(submission.project_id);
      currentSubmissionContext.projectId = submission.project_id;

      loadTemplatesForProject();
      setTimeout(() => {
        const templateSelect = document.getElementById(
          "submissionTemplateSelect",
        );
        if (templateSelect) {
          templateSelect.value = String(submission.template_id);
          onTemplateSelected();
          prefillTemplateFormFromSubmission(submission);
          showResubmitBanner(submission.review_comment);
        }
      }, 150);
    })
    .catch((error) => {
      console.error("Error resubmitting rejected submission:", error);
      showToast("Failed to load rejected submission", "error");
    });
}

// Initialize when page loads
document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("submissionProjectSelect")) {
    initTemplateSubmissions();
  }
});
