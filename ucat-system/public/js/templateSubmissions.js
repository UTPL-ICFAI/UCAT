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
  isResubmitting: false,
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

function normalizeTableColumns(columnsInput) {
  if (!Array.isArray(columnsInput)) return [];

  const normalizeInputType = (columnName, value, fixedValue) => {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "distance") return "distance";

    const fixedUnit = String(fixedValue || "").trim().toLowerCase();
    if (
      !normalized &&
      (fixedUnit === "meter" || fixedUnit === "kilometer") &&
      /distance|dist|length|meter|kilometer|km/i.test(columnName)
    ) {
      return "distance";
    }

    return "text";
  };

  return columnsInput
    .map((column, index) => {
      if (typeof column === "string") {
        const name = column.trim();
        if (!name) return null;
        return {
          id: `column_${Date.now()}_${index}`,
          name,
          inputType: "text",
          isLocked: false,
          fixedValue: "",
          rowFixedValues: {},
          distanceUnit: "meter",
          unitLocked: false,
          showCost: false,
          costConfigId: null,
          costConfigName: "",
          costPerMeter: 0,
          costPerKilometer: 0,
          costCurrency: "INR",
          formulaType: null,
          role: null,
        };
      }

      if (!column || typeof column !== "object") return null;
      const name = String(column.name || "").trim();
      if (!name) return null;

      const fVal = column.fixedValue;
      const inputType = normalizeInputType(
        name,
        column.inputType || column.fieldType || column.columnType,
        fVal,
      );
      const distanceUnit = String(
        column.distanceUnit || column.unit || fVal || "meter",
      )
        .trim()
        .toLowerCase();
      const normalizedDistanceUnit =
        distanceUnit === "kilometer" ? "kilometer" : "meter";
      return {
        id: String(column.id || `column_${Date.now()}_${index}`),
        name,
        inputType,
        isLocked: !!column.isLocked && inputType !== "distance",
        fixedValue:
          inputType === "distance" || fVal === undefined || fVal === null || fVal === "null"
            ? ""
            : String(fVal),
        rowFixedValues:
          column.rowFixedValues && typeof column.rowFixedValues === "object"
            ? column.rowFixedValues
            : {},
        distanceUnit: normalizedDistanceUnit,
        unitLocked:
          column.unitLocked === true ||
          column.unit_locked === true ||
          (inputType === "distance" &&
            String(column.fixedValue || "").trim().toLowerCase() ===
              normalizedDistanceUnit),
        showCost: column.showCost === true || column.show_cost === true,
        costConfigId: column.costConfigId ?? column.cost_config_id ?? null,
        costConfigName: column.costConfigName ?? column.cost_config_name ?? "",
        costPerMeter: Number(column.costPerMeter ?? column.cost_per_meter) || 0,
        costPerKilometer: Number(column.costPerKilometer ?? column.cost_per_kilometer) || 0,
        costCurrency: column.costCurrency ?? column.cost_currency ?? "INR",
        formulaType: column.formulaType || column.formula_type || null,
        role: column.role || column.columnRole || null,
      };
    })
    .filter(Boolean);
}

function getActiveCostRates() {
  if (window.activeCostRates) {
    return {
      cost_per_meter: Number(window.activeCostRates.cost_per_meter) || 0,
      cost_per_kilometer: Number(window.activeCostRates.cost_per_kilometer) || 0,
    };
  }

  return { cost_per_meter: 0, cost_per_kilometer: 0 };
}

function normalizeRateBundle(rates) {
  if (!rates || typeof rates !== "object") return getActiveCostRates();
  return {
    cost_per_meter: Number(rates.cost_per_meter) || 0,
    cost_per_kilometer: Number(rates.cost_per_kilometer) || 0,
  };
}

function calculateDistanceCost(distance, unit, ratesInput) {
  const rates = normalizeRateBundle(ratesInput);
  const numericDistance = Number(distance);
  if (!Number.isFinite(numericDistance) || numericDistance <= 0) {
    return 0;
  }

  const normalizedUnit = String(unit || "").trim().toLowerCase();
  const rate =
    normalizedUnit === "kilometer"
      ? rates.cost_per_kilometer
      : normalizedUnit === "meter"
        ? rates.cost_per_meter
        : 0;

  return numericDistance * (Number(rate) || 0);
}

function getDistanceRateBundle(source = {}) {
  return {
    cost_per_meter: Number(source.costPerMeter ?? source.cost_per_meter) || 0,
    cost_per_kilometer: Number(source.costPerKilometer ?? source.cost_per_kilometer) || 0,
    cost_currency: source.costCurrency ?? source.cost_currency ?? "INR",
    cost_config_id: source.costConfigId ?? source.cost_config_id ?? null,
    cost_config_name: source.costConfigName ?? source.cost_config_name ?? "",
  };
}

function normalizeCostConfigName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getActiveCostConfigList() {
  const source = typeof window !== "undefined" ? window.activeCostRates : null;
  const configs = Array.isArray(source?.configs) ? source.configs : [];
  return configs.map((config) => ({
    ...config,
    normalized_name: normalizeCostConfigName(config.name),
    cost_per_meter: Number(config.cost_per_meter) || 0,
    cost_per_kilometer: Number(config.cost_per_kilometer) || 0,
    currency: config.currency || "INR",
  }));
}

function findMatchingCostConfig(workValue) {
  const normalizedWork = normalizeCostConfigName(workValue);
  if (!normalizedWork) return null;

  const configs = getActiveCostConfigList();
  return (
    configs.find(
      (config) =>
        config.normalized_name === normalizedWork ||
        normalizeCostConfigName(config.name) === normalizedWork,
    ) || null
  );
}

function formatCurrencyValue(amount) {
  return `₹${(Number(amount) || 0).toFixed(2)}`;
}

function getTableWorkValue(row, columns) {
  const preferred = (Array.isArray(columns) ? columns : [])
    .filter((column) => String(column.inputType || "text").toLowerCase() !== "distance")
    .map((column) => column.name)
    .filter(Boolean);

  const prioritized = preferred.filter((columnName) => /work|material|item|name|description|task/i.test(columnName));
  const candidateColumns = [...prioritized, ...preferred].filter(
    (columnName, index, array) => array.indexOf(columnName) === index,
  );

  for (const columnName of candidateColumns) {
    const value = row[columnName];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return "";
}

function getTableDistanceValue(row, columns) {
  const distanceColumn = (Array.isArray(columns) ? columns : []).find(
    (column) => String(column.inputType || "text").toLowerCase() === "distance",
  );

  if (distanceColumn) {
    const cellValue = row[distanceColumn.name];
    if (cellValue && typeof cellValue === "object") {
      const distanceValue = Number(cellValue.distance ?? cellValue.value);
      return {
        distance: Number.isFinite(distanceValue) ? Math.max(0, distanceValue) : 0,
        unit:
          String(cellValue.unit || cellValue.distance_unit || distanceColumn.distanceUnit || "meter")
            .trim()
            .toLowerCase() === "kilometer"
            ? "kilometer"
            : "meter",
        columnName: distanceColumn.name,
      };
    }

    const numericDistance = Number(cellValue);
    return {
      distance: Number.isFinite(numericDistance) ? Math.max(0, numericDistance) : 0,
      unit:
        String(distanceColumn.distanceUnit || "meter").trim().toLowerCase() === "kilometer"
          ? "kilometer"
          : "meter",
      columnName: distanceColumn.name,
    };
  }

  for (const [key, value] of Object.entries(row || {})) {
    if (!/distance|dist|length/i.test(String(key || ""))) continue;
    const numericDistance = Number(value);
    if (Number.isFinite(numericDistance)) {
      return {
        distance: Math.max(0, numericDistance),
        unit: "meter",
        columnName: key,
      };
    }
  }

  return { distance: 0, unit: "meter", columnName: null };
}

function calculateTableRowAmountFromValues(row, columns) {
  const workValue = getTableWorkValue(row, columns);
  const distanceInfo = getTableDistanceValue(row, columns);
  const matchedConfig = findMatchingCostConfig(workValue);

  if (!matchedConfig || !workValue || distanceInfo.distance <= 0) {
    return {
      work: workValue,
      distance: distanceInfo.distance,
      unit: distanceInfo.unit,
      rate: 0,
      amount: 0,
      cost_config_id: null,
      cost_config_name: "",
      cost_currency: "INR",
      columnName: distanceInfo.columnName,
    };
  }

  const rate =
    distanceInfo.unit === "kilometer"
      ? Number(matchedConfig.cost_per_kilometer) || 0
      : Number(matchedConfig.cost_per_meter) || 0;
  const amount = distanceInfo.distance * rate;

  console.debug("Table row amount matched", {
    work: workValue,
    matched_config: matchedConfig.name,
    rate,
    amount,
  });

  return {
    work: workValue,
    distance: distanceInfo.distance,
    unit: distanceInfo.unit,
    rate,
    amount,
    cost_config_id: matchedConfig.id || null,
    cost_config_name: matchedConfig.name || "",
    cost_currency: matchedConfig.currency || "INR",
    columnName: distanceInfo.columnName,
  };
}

function updateTemplateTableRowAmount(rowEl) {
  if (!rowEl) return;
  const tableBody = document.getElementById("templateTableBody");
  if (!tableBody) return;

  const columns = getTemplateColumns();
  const rowData = {};

  rowEl.querySelectorAll("input[data-column]").forEach((input) => {
    const columnName = input.getAttribute("data-column");
    const columnDef = columns.find((column) => column.name === columnName);
    if (String(columnDef?.inputType || "text").toLowerCase() === "distance") {
      const wrapper = input.closest("[data-distance-table-column]");
      const unitInput = wrapper ? wrapper.querySelector("[data-distance-unit]") : null;
      const rawDistance = Number(input.value);
      const normalizedDistance = Number.isFinite(rawDistance) ? Math.max(0, rawDistance) : 0;
      rowData[columnName] = {
        type: "distance",
        distance: normalizedDistance,
        value: normalizedDistance,
        unit: unitInput ? unitInput.value : wrapper?.getAttribute("data-distance-unit-value") || "meter",
      };
      return;
    }

    rowData[columnName] = String(input.value || "");
  });

  const amountCell = rowEl.querySelector("[data-row-amount]");
  if (!amountCell) return;

  const rowCost = calculateTableRowAmountFromValues(rowData, columns);
  amountCell.textContent = formatCurrencyValue(rowCost.amount);
  rowEl.dataset.rowAmount = String(rowCost.amount || 0);
  rowEl.dataset.rowRate = String(rowCost.rate || 0);
  rowEl.dataset.rowWork = rowCost.work || "";
  rowEl.dataset.rowUnit = rowCost.unit || "meter";
}

function bindTemplateTableRowCostListeners(rowEl) {
  if (!rowEl || rowEl.dataset.costTrackingBound === "true") return;

  const refreshRowAmount = () => updateTemplateTableRowAmount(rowEl);
  rowEl.querySelectorAll("input[data-column], [data-distance-unit]").forEach((element) => {
    element.addEventListener("input", refreshRowAmount);
    element.addEventListener("change", refreshRowAmount);
  });

  rowEl.dataset.costTrackingBound = "true";
  refreshRowAmount();
}

function formatSubmissionFieldValue(field) {
  if (!field) return "-";
  if (String(field.type || "").toLowerCase() === "distance") {
    const distanceValue = field.distance !== undefined ? field.distance : field.value;
    const unitValue = field.unit || "meter";
    const distanceText =
      distanceValue === null || distanceValue === undefined || distanceValue === ""
        ? "-"
        : distanceValue;
    return `${distanceText} ${unitValue}`.trim();
  }
  const value = field.value !== undefined ? field.value : field.distance;
  return value === null || value === undefined || value === "" ? "-" : value;
}

function formatTableCellValue(value) {
  if (value && typeof value === "object") {
    const isDistance =
      String(value.type || "").toLowerCase() === "distance" ||
      Object.prototype.hasOwnProperty.call(value, "distance");
    if (isDistance) {
      const distanceValue =
        value.distance !== undefined ? value.distance : value.value;
      const unitValue = value.unit || value.distance_unit || "meter";
      const distanceText =
        distanceValue === null ||
        distanceValue === undefined ||
        distanceValue === ""
          ? ""
          : distanceValue;
      return `${distanceText} ${unitValue}`.trim() || "-";
    }
  }

  return value === null || value === undefined || value === "" ? "-" : value;
}

function renderCostSummarySection(costSummary) {
  if (
    !costSummary ||
    !Array.isArray(costSummary.breakdown) ||
    costSummary.breakdown.length === 0
  ) {
    return "";
  }

  const rows = costSummary.breakdown
    .map(
      (item) => `
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd;">${item.label || "Distance"}</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${item.distance || 0}</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${item.unit || "meter"}</td>
          <td style="padding: 8px; border: 1px solid #ddd;">₹${Number(item.rate || 0).toFixed(2)}</td>
        </tr>
      `,
    )
    .join("");

  return `
    <div class="cost-summary" style="margin-top: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px;">
        <strong>Cost Summary</strong>
        <span>Total: ₹${Number(costSummary.total_amount ?? costSummary.total_cost ?? 0).toFixed(2)}</span>
      </div>
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="background: #f5f5f5;">
            <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Field</th>
            <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Distance</th>
            <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Unit</th>
            <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Rate</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function updateDistanceFieldCost(fieldKey) {
  const wrapper = document.querySelector(`[data-distance-field="${fieldKey}"]`);
  if (!wrapper) return;

  const distanceInput = wrapper.querySelector("[data-distance-distance]");
  const unitSelect = wrapper.querySelector("[data-distance-unit]");
  const costPreview = wrapper.querySelector("[data-distance-cost]");

  if (!distanceInput || !costPreview) return;

  const distanceValue = Number(distanceInput.value);
  const unitValue = unitSelect
    ? unitSelect.value
    : wrapper.getAttribute("data-distance-unit-value") || "meter";
  const costValue = calculateDistanceCost(distanceValue, unitValue, {
    cost_per_meter: wrapper.getAttribute("data-distance-rate-meter"),
    cost_per_kilometer: wrapper.getAttribute("data-distance-rate-kilometer"),
  });
  costPreview.textContent = `Estimated cost: ₹${Number(costValue || 0).toFixed(2)}`;
}

function bindDistanceFieldEvents() {
  document.querySelectorAll("[data-distance-field]").forEach((wrapper) => {
    const fieldKey = wrapper.getAttribute("data-distance-field");
    const distanceInput = wrapper.querySelector("[data-distance-distance]");
    const unitSelect = wrapper.querySelector("[data-distance-unit]");

    if (distanceInput) {
      distanceInput.addEventListener("input", () => updateDistanceFieldCost(fieldKey));
    }
    if (unitSelect) {
      unitSelect.addEventListener("change", () => updateDistanceFieldCost(fieldKey));
    }

    updateDistanceFieldCost(fieldKey);
  });
}

window.addEventListener("ucat-cost-rates-updated", () => {
  bindDistanceFieldEvents();
});

function getTemplateColumns() {
  const template = currentSubmissionContext.template || {};
  return normalizeTableColumns(template.columns);
}

function applyColumnPoliciesToRow(tr, rowIndex) {
  const columns = getTemplateColumns();

  columns.forEach((column) => {
    if (String(column.inputType || "text").toLowerCase() === "distance") {
      const wrapper = tr.querySelector(
        `[data-distance-table-column="${column.name}"]`,
      );
      if (!wrapper) return;

      const input = wrapper.querySelector("[data-distance-value]");
      const unitInput = wrapper.querySelector("[data-distance-unit]");
      if (!input) return;

      wrapper.setAttribute("data-distance-rate-meter", String(column.costPerMeter || 0));
      wrapper.setAttribute("data-distance-rate-kilometer", String(column.costPerKilometer || 0));

      if (unitInput) {
        unitInput.value = column.distanceUnit || "meter";
        unitInput.disabled = !!column.unitLocked;
        unitInput.style.background = column.unitLocked ? "#FFCDD2" : "#FFFFFF";
        unitInput.style.color = column.unitLocked ? "#333" : "black";
        unitInput.style.cursor = column.unitLocked ? "not-allowed" : "";
      }

      if (column.isLocked && column.fixedValue !== "") {
        input.value = String(column.fixedValue);
      } else if (!input.value || input.value === "null") {
        input.value = "";
      }

      input.disabled = !!column.isLocked;
      input.style.background = column.isLocked ? "#FFCDD2" : "#FFFFFF";
      input.style.color = column.isLocked ? "#333" : "black";
      input.style.cursor = column.isLocked ? "not-allowed" : "";
      return;
    }

    const input = tr.querySelector(`input[data-column="${column.name}"]`);
    if (!input) return;

    const rowFixedValues = column.rowFixedValues || {};
    const hasRowFixed = Object.prototype.hasOwnProperty.call(
      rowFixedValues,
      String(rowIndex),
    );

    let enforcedValue = "";
    if (hasRowFixed) {
      enforcedValue = rowFixedValues[String(rowIndex)];
    } else if (column.fixedValue !== "") {
      enforcedValue = column.fixedValue;
    }

    if (enforcedValue !== "" && enforcedValue !== "null") {
      input.value = String(enforcedValue);
    } else if (!input.value || input.value === "null") {
      input.value = "";
    }

    const shouldDisable = !!column.isLocked;
    input.disabled = shouldDisable;
    input.style.background = shouldDisable ? "#FFCDD2" : "#FFFFFF";
    input.style.color = shouldDisable ? "#333" : "black";
    input.style.cursor = shouldDisable ? "not-allowed" : "";
  });

  updateTemplateTableRowAmount(tr);
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
  if (!currentSubmissionContext.isResubmitting) {
    clearResubmitBanner();
    currentSubmissionContext.originalSubmissionId = null;
  } else {
    currentSubmissionContext.isResubmitting = false;
  }
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

  bindDistanceFieldEvents();

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
          <tr style="background: #FFF9C4;">
            ${columns
              .map((col) => {
                const distanceMeta =
                  String(col.inputType || "text").toLowerCase() === "distance" && col.costConfigName
                    ? `<div style="font-size: 10px; color: #666; margin-top: 4px;">${col.costConfigName}</div>`
                    : "";
                return `<th style="padding: 10px; border: 1px solid #ddd; text-align: left; font-weight: 600; font-size: 12px; color: #333;">${col.name}${distanceMeta}</th>`;
              })
              .join("")}
            <th style="padding: 10px; border: 1px solid #ddd; text-align: center; font-weight: 600; font-size: 12px; color: #333;">Action</th>
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
      .map((col) => {
        if (String(col.inputType || "text").toLowerCase() === "distance") {
          const unitOptions = ["meter", "kilometer"]
            .map(
              (unit) => `<option value="${unit}" ${unit === (col.distanceUnit || "meter") ? "selected" : ""}>${unit}</option>`,
            )
            .join("");
          const unitControl = col.unitLocked
            ? `<span class="distance-unit-label">${col.distanceUnit || "meter"}</span><input type="hidden" value="${col.distanceUnit || "meter"}" data-distance-unit />`
            : `<select class="form-control" data-distance-unit>${unitOptions}</select>`;

          return `
      <td style="padding: 8px; border: 1px solid #ddd;">
        <div data-distance-table-column="${col.name}" data-distance-unit-value="${col.distanceUnit || "meter"}" data-distance-unit-locked="${col.unitLocked ? "true" : "false"}" data-distance-show-cost="${col.showCost ? "true" : "false"}" data-distance-rate-meter="${col.costPerMeter || 0}" data-distance-rate-kilometer="${col.costPerKilometer || 0}" style="display: flex; gap: 8px; align-items: center;">
          <input type="number" class="form-control" min="0" step="0.01" data-column="${col.name}" data-distance-value />
          ${unitControl}
        </div>
      </td>
    `;
        }

        return `
      <td style="padding: 8px; border: 1px solid #ddd;">
        <input type="text" class="form-control" data-column="${col.name}" data-row-index="${rowIndex}" />
      </td>
    `;
      })
      .join("")}
    <td style="padding: 8px; border: 1px solid #ddd; text-align: right; font-weight: 600;" data-row-amount>₹0.00</td>
    <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">
      <button type="button" class="btn btn-small btn-danger" onclick="removeTemplateTableRow(this)">Remove</button>
    </td>
  `;

  tableBody.appendChild(row);
  applyColumnPoliciesToRow(row, rowIndex);
  bindTemplateTableRowCostListeners(row);
}

function removeTemplateTableRow(buttonEl) {
  const tr =
    buttonEl && typeof buttonEl.closest === "function"
      ? buttonEl.closest("tr")
      : null;
  if (!tr) return;
  tr.remove();
  reindexTemplateTableRows();

  const tableBody = document.getElementById("templateTableBody");
  if (tableBody) {
    Array.from(tableBody.querySelectorAll("tr")).forEach((rowEl) => {
      updateTemplateTableRowAmount(rowEl);
    });
  }
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
  const fieldType = String(field.type || "text").toLowerCase();

  switch (fieldType) {
    case "number":
      return `<input type="number" name="${fieldName}" class="form-control" step="0.01" ${required} ${dataAttr} />`;
    case "decimal":
      return `<input type="number" name="${fieldName}" class="form-control" step="0.01" ${required} ${dataAttr} />`;
    case "date":
      return `<input type="date" name="${fieldName}" class="form-control" ${required} ${dataAttr} />`;
    case "distance": {
      const unitValue =
        String(field.unit || "meter").toLowerCase() === "kilometer"
          ? "kilometer"
          : "meter";
      const unitLocked = !!field.unit_locked;
      const showCost = !!field.show_cost;
      const rateBundle = getDistanceRateBundle(field);

      return `
        <div class="distance-field" data-distance-field="${fieldName}" data-distance-unit-value="${unitValue}" data-distance-unit-locked="${unitLocked ? "true" : "false"}" data-distance-show-cost="${showCost ? "true" : "false"}" data-distance-rate-meter="${rateBundle.cost_per_meter}" data-distance-rate-kilometer="${rateBundle.cost_per_kilometer}" data-cost-config-id="${rateBundle.cost_config_id || ""}" data-cost-config-name="${rateBundle.cost_config_name || ""}">
          <div class="distance-input-row">
            <input type="number" name="${fieldName}_distance" class="form-control" min="0" step="0.01" ${required} ${dataAttr} data-field-type="distance" data-distance-distance />
            ${unitLocked ? `<span class="distance-unit-label">${unitValue}</span><input type="hidden" name="${fieldName}_unit" value="${unitValue}" data-distance-unit />` : `<select name="${fieldName}_unit" class="form-control" data-distance-unit><option value="meter" ${unitValue === "meter" ? "selected" : ""}>meter</option><option value="kilometer" ${unitValue === "kilometer" ? "selected" : ""}>kilometer</option></select>`}
          </div>
          ${rateBundle.cost_config_name ? `<div class="distance-cost-preview">Rate source: ${rateBundle.cost_config_name}</div>` : ""}
          ${showCost ? `<div class="distance-cost-preview" data-distance-cost>Estimated cost: ₹0.00</div>` : ""}
        </div>
      `;
    }
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
    const tableBody = document.getElementById("templateTableBody");
    const rows = [];
    const columns = getTemplateColumns();
    const columnMap = new Map(columns.map((column) => [column.name, column]));
    const columnNames = columns.map((column) => column.name);

    if (tableBody) {
      Array.from(tableBody.querySelectorAll("tr")).forEach((row) => {
        const rowData = {};
        let hasValue = false;

        row.querySelectorAll("input[data-column]").forEach((input) => {
          const column = input.getAttribute("data-column");
          const columnDef = columnMap.get(column);

          if (String(columnDef?.inputType || "text").toLowerCase() === "distance") {
            const wrapper = input.closest("[data-distance-table-column]");
            const unitInput = wrapper ? wrapper.querySelector("[data-distance-unit]") : null;
            const rawDistance = input.value;
            const numericDistance = Number(rawDistance);
            const normalizedDistance =
              rawDistance === null || rawDistance === undefined || rawDistance === ""
                ? null
                : Number.isFinite(numericDistance)
                  ? Math.max(0, numericDistance)
                  : null;
            const unitValue = unitInput
              ? unitInput.value
              : wrapper?.getAttribute("data-distance-unit-value") || "meter";

            rowData[column] = {
              type: "distance",
              distance: normalizedDistance,
              value: normalizedDistance,
              unit: unitValue,
              cost_per_meter: Number(wrapper?.getAttribute("data-distance-rate-meter") || columnDef?.costPerMeter || 0),
              cost_per_kilometer: Number(wrapper?.getAttribute("data-distance-rate-kilometer") || columnDef?.costPerKilometer || 0),
              cost_currency: columnDef?.costCurrency || "INR",
              cost_config_id: columnDef?.costConfigId || null,
              cost_config_name: columnDef?.costConfigName || "",
              unit_locked:
                wrapper?.getAttribute("data-distance-unit-locked") === "true",
              show_cost:
                wrapper?.getAttribute("data-distance-show-cost") === "true",
            };

            if (normalizedDistance !== null) hasValue = true;
            return;
          }

          const value = input.value;
          rowData[column] =
            value === null || value === undefined || value === "null"
              ? ""
              : String(value);
          if (rowData[column].trim() !== "") hasValue = true;
        });

        columnNames.forEach((columnName) => {
          if (
            !Object.prototype.hasOwnProperty.call(rowData, columnName) ||
            rowData[columnName] === null ||
            rowData[columnName] === undefined ||
            rowData[columnName] === "null"
          ) {
            rowData[columnName] = "";
          }
        });

        const tableRowCost = calculateTableRowAmountFromValues(rowData, columns);
        rowData.work = tableRowCost.work || rowData.work || "";
        rowData.rate = tableRowCost.rate || 0;
        rowData.amount = tableRowCost.amount || 0;
        rowData.cost_config_id = tableRowCost.cost_config_id || null;
        rowData.cost_config_name = tableRowCost.cost_config_name || "";
        rowData.cost_currency = tableRowCost.cost_currency || "INR";

        if (Object.prototype.hasOwnProperty.call(rowData, tableRowCost.columnName || "")) {
          const originalDistanceCell = rowData[tableRowCost.columnName];
          if (originalDistanceCell && typeof originalDistanceCell === "object") {
            rowData.distance_value = tableRowCost.distance;
            rowData.distance_unit = tableRowCost.unit;
          } else {
            rowData.distance = tableRowCost.distance;
            rowData.unit = tableRowCost.unit;
          }
        } else {
          rowData.distance = tableRowCost.distance;
          rowData.unit = tableRowCost.unit;
        }

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
        const fieldLabel = input.getAttribute("data-field-label");
        const fieldType = String(input.getAttribute("data-field-type") || "text").toLowerCase();
        const templateField = Array.isArray(currentSubmissionContext.template?.fields)
          ? currentSubmissionContext.template.fields.find(
              (item) => String(item.label || item.name || "").trim() === fieldLabel,
            )
          : null;

        if (fieldType === "distance") {
          const wrapper = input.closest("[data-distance-field]");
          const unitInput = wrapper ? wrapper.querySelector("[data-distance-unit]") : null;
          const rawDistance = Number(input.value);
          const normalizedDistance = Number.isFinite(rawDistance)
            ? Math.max(0, rawDistance)
            : null;
          const unitValue = unitInput
            ? unitInput.value
            : wrapper?.getAttribute("data-distance-unit-value") || "meter";

          fields.push({
            label: fieldLabel,
            type: "distance",
            distance: normalizedDistance,
            value: normalizedDistance,
            unit: unitValue,
            cost_per_meter: Number(wrapper?.getAttribute("data-distance-rate-meter") || templateField?.costPerMeter || 0),
            cost_per_kilometer: Number(wrapper?.getAttribute("data-distance-rate-kilometer") || templateField?.costPerKilometer || 0),
            cost_currency: templateField?.costCurrency || "INR",
            cost_config_id: templateField?.costConfigId || null,
            cost_config_name: templateField?.costConfigName || "",
            unit_locked:
              wrapper?.getAttribute("data-distance-unit-locked") === "true",
            show_cost:
              wrapper?.getAttribute("data-distance-show-cost") === "true",
          });
          return;
        }

        fields.push({
          label: fieldLabel,
          type: fieldType,
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
          <div style="margin-bottom: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
            <div>
              <p><strong>Template:</strong> ${submission.template?.name || "N/A"}</p>
              <p><strong>Date:</strong> ${formatDate(submission.submission_date)}</p>
            </div>
            <div>
              <p><strong>Status:</strong> <span class="status-badge status-${submission.status}">${submission.status}</span></p>
              <p><strong>Submitted On:</strong> ${formatDate(submission.created_at)}</p>
              ${submission.reviewed_by_name ? `<p><strong>Reviewed By:</strong> ${submission.reviewed_by_name}</p>` : ""}
            </div>
          </div>

          <h4>Submitted Data:</h4>
        `;

        html += renderSubmissionData(submission);

        if (submission.status !== "submitted") {
          html += `
            <div style="margin-top: 15px; padding: 15px; background: #f0f0f0; border-radius: 6px;">
              <p><strong>Review Comment:</strong> ${submission.review_comment || "No comment provided"}</p>
            </div>
          `;
        }

        modalContent.innerHTML = html;
        document.getElementById("submissionModalTitle").textContent =
          `${submission.template?.name || "Submission"} - ${formatDate(submission.submission_date)}`;
        if (typeof openModal === "function") {
          openModal("viewSubmissionModal");
        } else {
          document.getElementById("viewSubmissionModal").style.display = "flex";
        }
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
    const columnDefs = normalizeTableColumns(
      snapshot.columns || data.columns || [],
    );
    const columns = columnDefs.map((column) => column.name);
    const labelColumn =
      columnDefs.find((column) => !column.formulaType)?.name || columns[0];
    const headerCells = columns
      .map(
        (col) =>
          `<th style="padding: 8px; border: 1px solid #ddd; text-align: left;">${col}</th>`,
      )
      .join("");
    const bodyRows = data.rows
      .map((row) => {
        const isSummary = row && row.__summaryType;
        return `
      <tr style="${isSummary ? "background: #fff8db;" : ""}">
        ${columns
          .map((col) => {
            let value =
              row[col] === null || row[col] === undefined || row[col] === "null"
                ? ""
                : row[col];
            value = formatTableCellValue(value);
            if (
              isSummary &&
              labelColumn &&
              col === labelColumn &&
              (value === "" || value === null || value === undefined)
            ) {
              value = row.__summaryLabel || "";
            }
            return `<td style="padding: 8px; border: 1px solid #ddd;${isSummary ? " font-weight: 600; border-top: 2px solid #f0cf6d; background: #fff8db;" : ""}">${value}</td>`;
          })
          .join("")}
      </tr>
    `;
      })
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
        <td style="padding: 8px; border: 1px solid #ddd;">${formatSubmissionFieldValue(field)}</td>
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
      ${renderCostSummarySection(data._cost_summary)}
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
      ${renderCostSummarySection(data._cost_summary)}
    `;
  }

  return `
    <div style="background: #f5f5f5; padding: 15px; border-radius: 6px;">
      <pre style="margin: 0;">${JSON.stringify(data, null, 2)}</pre>
    </div>
    ${renderCostSummarySection(data._cost_summary)}
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
      if (!input) return;

      if (String(field.type || "").toLowerCase() === "distance") {
        input.value = field.distance ?? field.value ?? "";
        const wrapper = input.closest("[data-distance-field]");
        const unitInput = wrapper ? wrapper.querySelector("[data-distance-unit]") : null;
        if (unitInput && field.unit) {
          unitInput.value = field.unit;
        }
        if (wrapper) {
          updateDistanceFieldCost(wrapper.getAttribute("data-distance-field"));
        }
      } else {
        input.value = field.value || "";
      }
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
        if (rowObj && rowObj.__summaryType) return;
        addTemplateTableRow();
        const tr = tableBody.lastElementChild;
        if (!tr) return;
        tr.querySelectorAll("input[data-column]").forEach((input) => {
          const col = input.getAttribute("data-column");
          const columnDef = getTemplateColumns().find((item) => item.name === col);
          const cellValue = rowObj[col];

          if (String(columnDef?.inputType || "text").toLowerCase() === "distance" && cellValue && typeof cellValue === "object") {
            input.value = cellValue.distance ?? cellValue.value ?? "";
            const wrapper = input.closest("[data-distance-table-column]");
            const unitInput = wrapper ? wrapper.querySelector("[data-distance-unit]") : null;
            if (unitInput && cellValue.unit) {
              unitInput.value = cellValue.unit;
            }
            return;
          }

          input.value = rowObj[col] || "";
        });
      });
      reindexTemplateTableRows();
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
      currentSubmissionContext.isResubmitting = true;
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
