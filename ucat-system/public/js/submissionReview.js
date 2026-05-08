/**
 * Submission Review Module
 * Handles PM/Superadmin review and approval of template submissions
 */

let currentReviewSubmission = null;
let pmSubmissionsCache = [];
let submissionComparisonChart = null;

function getAuthHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${localStorage.getItem("auth_token")}`,
    ...extra,
  };
}

function effectivePMProjectId() {
  if (typeof currentProjectId !== "undefined" && currentProjectId) {
    return String(currentProjectId);
  }
  return "";
}

function renderSelectProjectPlaceholder() {
  const tbody = document.getElementById("submissionsTableBody");
  if (!tbody) return;
  tbody.innerHTML =
    '<tr><td colspan="6" style="text-align:center; padding:20px; color:#777;">Open a project to view submissions</td></tr>';
}

function resolveSubmissionTemplateName(submission) {
  if (!submission) return "N/A";

  const snapshot = submission.template_snapshot || {};
  const template = submission.template || {};
  return (
    snapshot.name ||
    snapshot.template_name ||
    template.name ||
    submission.template_name ||
    "N/A"
  );
}

function normalizeCostRateBundle(source = {}) {
  return {
    cost_per_meter: Number(source.cost_per_meter ?? source.costPerMeter) || 0,
    cost_per_kilometer:
      Number(source.cost_per_kilometer ?? source.costPerKilometer) || 0,
  };
}

function formatMoney(amount) {
  return `₹${(Number(amount) || 0).toFixed(2)}`;
}

function getFallbackActiveCostRates() {
  if (typeof window !== "undefined" && window.activeCostRates) {
    return normalizeCostRateBundle(window.activeCostRates);
  }

  return { cost_per_meter: 0, cost_per_kilometer: 0 };
}

/**
 * Load submissions for selected project
 */
function loadPMSubmissions() {
  const currentProjectId = effectivePMProjectId();
  if (!currentProjectId) {
    pmSubmissionsCache = [];
    renderSelectProjectPlaceholder();
    return;
  }

  const templateFilterEl = document.getElementById("pmSubmissionTemplateFilter");
  const statusFilterEl = document.getElementById("pmSubmissionStatusFilter");
  const dateFilterEl = document.getElementById("pmSubmissionDateFilter");
  const templateFilter = templateFilterEl ? templateFilterEl.value : "";
  const statusFilter = statusFilterEl ? statusFilterEl.value : "";
  const dateFilter = dateFilterEl ? dateFilterEl.value : "";

  fetch(`/api/project-templates/${currentProjectId}/submissions`, {
    headers: getAuthHeaders(),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.success && Array.isArray(data.data)) {
        let submissions = data.data;

        if (templateFilter)
          submissions = submissions.filter(
            (s) => String(s.template_id) === String(templateFilter),
          );
        if (statusFilter)
          submissions = submissions.filter((s) => s.status === statusFilter);
        if (dateFilter)
          submissions = submissions.filter(
            (s) => s.submission_date === dateFilter,
          );

        pmSubmissionsCache = submissions;
        renderPMSubmissions(submissions);
        loadTemplatesForFilter(submissions);
      } else {
        pmSubmissionsCache = [];
        renderPMSubmissions([]);
      }
    })
    .catch((error) => {
      console.error("Error loading submissions:", error);
      renderPMSubmissions([]);
      showToast("Failed to load submissions", "error");
    });
}

/**
 * Load templates for filter dropdown
 */
function loadTemplatesForFilter(submissions = pmSubmissionsCache) {
  const currentProjectId = effectivePMProjectId();
  if (!currentProjectId) return;

  const select = document.getElementById("pmSubmissionTemplateFilter");
  if (!select) return;

  const currentValue = select.value;
  const uniqueTemplates = new Map();

  (Array.isArray(submissions) ? submissions : []).forEach((submission) => {
    const templateId = String(submission.template_id || "");
    if (!templateId) return;

    if (!uniqueTemplates.has(templateId)) {
      uniqueTemplates.set(templateId, {
        template_id: templateId,
        name: resolveSubmissionTemplateName(submission),
      });
    }
  });

  select.innerHTML = '<option value="">All Templates</option>';
  Array.from(uniqueTemplates.values()).forEach((template) => {
    const option = document.createElement("option");
    option.value = template.template_id;
    option.textContent = template.name || "Template";
    select.appendChild(option);
  });

  select.value = currentValue;
}

function getTemplateColumnsFromSubmission(submission) {
  const templateColumns = submission?.template?.columns;
  if (Array.isArray(templateColumns) && templateColumns.length > 0) {
    return templateColumns;
  }

  const snapshotColumns = submission?.template_snapshot?.columns;
  return Array.isArray(snapshotColumns) ? snapshotColumns : [];
}

function findTemplateColumnByName(columns, columnName) {
  return (Array.isArray(columns) ? columns : []).find((column) => {
    if (!column || typeof column !== "object") return false;
    return String(column.name || column.label || "").trim() === String(columnName || "").trim();
  });
}

function readDistanceCell(row, columnName) {
  if (!row || !columnName) return null;

  const value = row[columnName];
  if (value && typeof value === "object") {
    const parsedDistance = Number.parseFloat(value.distance ?? value.value);
    return {
      distance: Number.isFinite(parsedDistance) ? parsedDistance : null,
      unit: String(value.unit || value.distance_unit || "meter").toLowerCase(),
      cost_per_meter: Number(value.cost_per_meter ?? value.costPerMeter) || 0,
      cost_per_kilometer:
        Number(value.cost_per_kilometer ?? value.costPerKilometer) || 0,
    };
  }

  const parsedDistance = Number.parseFloat(value);
  return {
    distance: Number.isFinite(parsedDistance) ? parsedDistance : null,
    unit: "meter",
    cost_per_meter: 0,
    cost_per_kilometer: 0,
  };
}

function firstPositiveRate(...values) {
  for (const value of values) {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue) && numericValue > 0) {
      return numericValue;
    }
  }

  return 0;
}

function calculateSubmissionRowAmount(row, columnName, templateRates, summaryRates) {
  const distanceCell = readDistanceCell(row, columnName);
  if (!distanceCell || distanceCell.distance === null || distanceCell.distance <= 0) {
    return 0;
  }

  const rates = normalizeCostRateBundle({
    cost_per_meter:
      firstPositiveRate(
        distanceCell.cost_per_meter,
        templateRates.cost_per_meter,
        summaryRates.cost_per_meter,
      ),
    cost_per_kilometer:
      firstPositiveRate(
        distanceCell.cost_per_kilometer,
        templateRates.cost_per_kilometer,
        summaryRates.cost_per_kilometer,
      ),
  });

  const rateValue =
    distanceCell.unit === "kilometer"
      ? rates.cost_per_kilometer
      : rates.cost_per_meter;

  return distanceCell.distance * Number(rateValue || 0);
}

/**
 * Render submissions in table
 */
function renderPMSubmissions(submissions) {
  const tbody = document.getElementById("submissionsTableBody");
  if (!tbody) return;

  if (!Array.isArray(submissions) || submissions.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="6" style="text-align:center; padding:20px;">No submissions found</td></tr>';
    return;
  }

  tbody.innerHTML = submissions
    .map(
      (submission) => `
    <tr style="background: ${submission.status === "submitted" ? "#fffbea" : ""};">
      <td>${resolveSubmissionTemplateName(submission)}</td>
      <td>${submission.submitted_by_name || submission.submitted_by || "Unknown"}</td>
      <td>${formatDate(submission.submission_date)}</td>
      <td>
        <span class="status-badge status-${submission.status}">
          ${submission.status.charAt(0).toUpperCase() + submission.status.slice(1)}
        </span>
      </td>
      <td>${formatDate(submission.created_at)}</td>
      <td>
        <button class="btn btn-sm" onclick="reviewSubmission(${submission.id})">Review</button>
        ${submission.status === "submitted" ? `<button class="btn btn-sm btn-success" onclick="quickApprove(${submission.id})">Approve</button>` : ""}
      </td>
    </tr>
  `,
    )
    .join("");
}

/**
 * Review a submission - open modal with details
 */
function reviewSubmission(submissionId) {
  fetch(`/api/project-templates/submission/${submissionId}`, {
    headers: getAuthHeaders(),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        currentReviewSubmission = data.data;
        renderReviewModal(data.data);
        if (typeof openModal === "function") {
          openModal("reviewSubmissionModal");
        } else {
          const modal = document.getElementById("reviewSubmissionModal");
          if (modal) {
            modal.style.display = "flex";
          }
        }
      } else {
        showToast(data.error || "Failed to load submission", "error");
      }
    })
    .catch((error) => {
      console.error("Error loading submission:", error);
      showToast("Error loading submission", "error");
    });
}

/**
 * Render review modal content
 */
function renderReviewModal(submission) {
  const titleEl = document.getElementById("reviewModalTitle");
  const contentEl = document.getElementById("reviewSubmissionContent");
  if (!titleEl || !contentEl) return;

  const templateName = resolveSubmissionTemplateName(submission);
  titleEl.textContent = `${templateName} - ${formatDate(submission.submission_date)}`;

  let html = `
    <div style="margin-bottom: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
      <div>
        <p><strong>Template:</strong> ${templateName || "N/A"}</p>
        <p><strong>Submitted By:</strong> ${submission.submitted_by_name || submission.submitted_by || "Unknown"}</p>
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

  contentEl.innerHTML = html;
  renderSubmissionGraph(submission);
}

/**
 * Render submissions in table
 */
function renderSubmissionData(submission) {
  const rawData = submission.data;
  const data = typeof rawData === "string"
    ? (() => {
        try {
          return JSON.parse(rawData);
        } catch (error) {
          return { raw: rawData };
        }
      })()
    : rawData || {};
  const templateType =
    (submission.template_snapshot && submission.template_snapshot.template_type) ||
    (submission.template && submission.template.template_type) ||
    "form";
  const costSummary = data._cost_summary || {};
  const costBreakdown = Array.isArray(costSummary.breakdown)
    ? costSummary.breakdown
    : [];

  function formatCellValue(value) {
    if (value && typeof value === "object") {
      const isDistance =
        String(value.type || "").toLowerCase() === "distance" ||
        Object.prototype.hasOwnProperty.call(value, "distance");
      if (isDistance) {
        const distanceValue =
          value.distance !== undefined && value.distance !== null
            ? value.distance
            : value.value;
        const unitValue = value.unit || value.distance_unit || "meter";
        if (
          distanceValue === null ||
          distanceValue === undefined ||
          distanceValue === ""
        ) {
          return "-";
        }
        return `${distanceValue} ${unitValue}`.trim();
      }

      return value.value !== undefined ? value.value : JSON.stringify(value);
    }

    if (value === null || value === undefined || value === "null") {
      return "-";
    }

    return value;
  }

  let html = "";

  if (costBreakdown.length > 0) {
    html += `
      <div class="cost-summary" style="margin-top: 16px; background: #fff; padding: 15px; border-radius: 6px; border: 1px solid #eee;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
          <strong>Cost Summary</strong>
          <span>Total: ${formatMoney(costSummary.total_amount ?? costSummary.total_cost ?? 0)}</span>
        </div>
        <table style="width:100%; border-collapse:collapse;">
          <thead>
            <tr style="background:#f5f5f5;">
              <th style="padding:8px; border:1px solid #ddd; text-align:left;">Field</th>
              <th style="padding:8px; border:1px solid #ddd; text-align:left;">Distance</th>
              <th style="padding:8px; border:1px solid #ddd; text-align:left;">Unit</th>
              <th style="padding:8px; border:1px solid #ddd; text-align:left;">Rate</th>
            </tr>
          </thead>
          <tbody>
            ${costBreakdown.map((item) => `
              <tr>
                <td style="padding:8px; border:1px solid #ddd;">${item.label || "Distance"}</td>
                <td style="padding:8px; border:1px solid #ddd;">${item.distance || 0}</td>
                <td style="padding:8px; border:1px solid #ddd;">${item.unit || "meter"}</td>
                <td style="padding:8px; border:1px solid #ddd;">₹${Number(item.rate || 0).toFixed(2)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  if (Array.isArray(data.fields)) {
    html += `
      <div style="margin-top: 16px; background: #fff; padding: 15px; border-radius: 6px; border: 1px solid #eee;">
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background: #e0e0e0;">
              <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Field</th>
              <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Value</th>
            </tr>
          </thead>
          <tbody>
            ${data.fields
              .map(
                (field) => `
                <tr>
                  <td style="padding: 8px; border: 1px solid #ddd; font-weight: 600;">${field.label || field.name || "Field"}</td>
                  <td style="padding: 8px; border: 1px solid #ddd;">${String(field.type || "").toLowerCase() === "distance" ? formatCellValue(field) : formatCellValue(field.value !== undefined ? field.value : field.distance)}</td>
                </tr>
              `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  } else if (templateType === "table" && Array.isArray(data.rows)) {
    const columns = Array.isArray(data.columns) && data.columns.length > 0
      ? data.columns.map((column) => {
          if (typeof column === "string") {
            return { name: column, label: column };
          }

          return {
            name: column.name || column.label || "Column",
            label: column.label || column.name || "Column",
          };
        })
      : Object.keys(data.rows[0] || {}).map((columnName) => ({
          name: columnName,
          label: columnName,
        }));

    const templateColumns = getTemplateColumnsFromSubmission(submission);

    const distanceColumnIndex = columns.findIndex((column) =>
      /distance/i.test(String(column.label || column.name || "")),
    );
    const costBreakdown = Array.isArray(costSummary.breakdown)
      ? costSummary.breakdown
      : [];
    const costRates = costSummary.rates_snapshot || {};
    const fallbackRates = getFallbackActiveCostRates();
    const summaryTotalAmount = Number(costSummary.total_amount ?? costSummary.total_cost ?? 0);

    function getColumnRates(columnName) {
      const templateColumn = findTemplateColumnByName(templateColumns, columnName);
      if (!templateColumn) {
        return fallbackRates;
      }

      return normalizeCostRateBundle({
        cost_per_meter: templateColumn.costPerMeter ?? templateColumn.cost_per_meter,
        cost_per_kilometer:
          templateColumn.costPerKilometer ?? templateColumn.cost_per_kilometer,
      });
    }

    function getNumericDistance(value) {
      if (value && typeof value === "object") {
        const distanceValue =
          value.distance !== undefined && value.distance !== null
            ? value.distance
            : value.value;
        const parsedDistance = Number.parseFloat(distanceValue);
        return Number.isFinite(parsedDistance) ? parsedDistance : null;
      }

      const parsedDistance = Number.parseFloat(value);
      return Number.isFinite(parsedDistance) ? parsedDistance : null;
    }

    function getRowAmount(row, rowIndex) {
      const savedAmount = Number(row?.amount ?? row?._cost?.amount);
      if (Number.isFinite(savedAmount) && savedAmount > 0) {
        return savedAmount;
      }

      const breakdownItem = costBreakdown[rowIndex];
      if (breakdownItem && Number.isFinite(Number(breakdownItem.cost))) {
        const breakdownCost = Number(breakdownItem.cost);
        if (breakdownCost > 0) {
          return breakdownCost;
        }
      }

      if (distanceColumnIndex < 0) return 0;

      const distanceValue = row[columns[distanceColumnIndex].name];
      const numericDistance = getNumericDistance(distanceValue);
      if (numericDistance === null) return 0;

      const columnRates = getColumnRates(columns[distanceColumnIndex].name);
      const rowRates =
        distanceValue && typeof distanceValue === "object"
          ? normalizeCostRateBundle({
              cost_per_meter: firstPositiveRate(
                distanceValue.cost_per_meter,
                distanceValue.costPerMeter,
                costRates.cost_per_meter,
                columnRates.cost_per_meter,
                fallbackRates.cost_per_meter,
              ),
              cost_per_kilometer: firstPositiveRate(
                distanceValue.cost_per_kilometer,
                distanceValue.costPerKilometer,
                costRates.cost_per_kilometer,
                columnRates.cost_per_kilometer,
                fallbackRates.cost_per_kilometer,
              ),
            })
          : normalizeCostRateBundle({
              cost_per_meter: firstPositiveRate(
                costRates.cost_per_meter,
                columnRates.cost_per_meter,
                fallbackRates.cost_per_meter,
              ),
              cost_per_kilometer: firstPositiveRate(
                costRates.cost_per_kilometer,
                columnRates.cost_per_kilometer,
                fallbackRates.cost_per_kilometer,
              ),
            });

      const unitValue =
        (distanceValue && typeof distanceValue === "object" && (distanceValue.unit || distanceValue.distance_unit)) ||
        "meter";
      const rateValue =
        String(unitValue).toLowerCase() === "kilometer"
          ? Number(rowRates.cost_per_kilometer || 0)
          : Number(rowRates.cost_per_meter || 0);

      return numericDistance * rateValue;
    }

    let totalAmount = 0;

    const headerHtml = [...columns, { name: "__amount", label: "Amount" }]
      .map(
        (column) =>
          `<th style="padding: 10px; text-align: left; border: 1px solid #ddd; background: #f6f6f6;">${column.label}</th>`,
      )
      .join("");

    const bodyHtml = data.rows
      .filter((row) => row && !row.__summaryType)
      .map((row, rowIndex) => {
        const rowValues = columns
          .map((column, columnIndex) => {
            if (columnIndex !== distanceColumnIndex) {
              return `<td style="padding: 8px; border: 1px solid #ddd;">${formatCellValue(row[column.name])}</td>`;
            }

            return `<td style="padding: 8px; border: 1px solid #ddd;">${formatCellValue(row[column.name])}</td>`;
          })
          .join("");

        const totalCell =
          distanceColumnIndex >= 0
            ? (() => {
                const rowAmount = getRowAmount(row, rowIndex);
                totalAmount += rowAmount;
                return `<td style="padding: 8px; border: 1px solid #ddd; font-weight: 600;">${formatMoney(rowAmount || 0)}</td>`;
              })()
            : `<td style="padding: 8px; border: 1px solid #ddd;"></td>`;

        return `<tr>${rowValues}${totalCell}</tr>`;
      })
      .join("");

    const totalRowHtml =
      distanceColumnIndex >= 0
        ? `<tr style="background: #fafafa; font-weight: 600;"><td style="padding: 8px; border: 1px solid #ddd;" colspan="${columns.length}">Total</td><td style="padding: 8px; border: 1px solid #ddd;">${formatMoney(summaryTotalAmount > 0 ? summaryTotalAmount : totalAmount)}</td></tr>`
        : "";

    html += `
      <div style="margin-top: 16px; background: #fff; padding: 15px; border-radius: 6px; border: 1px solid #eee; overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse; min-width: 720px;">
          <thead>
            <tr>${headerHtml}</tr>
          </thead>
          <tbody>${bodyHtml}${totalRowHtml}</tbody>
        </table>
      </div>
    `;
  } else if (Array.isArray(data.rows)) {
    html += `
      <div style="margin-top: 16px; background: #fff; padding: 15px; border-radius: 6px; border: 1px solid #eee;">
        ${data.rows
          .map((row) => {
            const rowLabel = row && row.label ? row.label : "Row";
            const cells = Array.isArray(row && row.cells) ? row.cells : [];
            const rowsHtml = cells
              .map((cell) => {
                const cellLabel =
                  cell && typeof cell === "object"
                    ? cell.label || "Cell"
                    : String(cell);
                const cellValue =
                  cell && typeof cell === "object"
                    ? formatCellValue(cell.value !== undefined ? cell.value : cell.distance)
                    : "-";
                return `
                  <tr>
                    <td style="padding: 8px; border: 1px solid #ddd; font-weight: 600;">${cellLabel}</td>
                    <td style="padding: 8px; border: 1px solid #ddd;">${cellValue}</td>
                  </tr>
                `;
              })
              .join("");

            return `
              <div style="margin-bottom: 12px;">
                <div style="font-weight: 600; margin-bottom: 6px;">${rowLabel}</div>
                <table style="width: 100%; border-collapse: collapse;">
                  <tbody>${rowsHtml}</tbody>
                </table>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  if (!html) {
    html = `<div style="background: #f5f5f5; padding: 15px; border-radius: 6px;">
      <pre style="margin: 0; white-space: pre-wrap; word-break: break-word;">${JSON.stringify(data, null, 2)}</pre>
    </div>`;
  }

  return html;
}

function renderSubmissionGraph(submission) {
  const container = document.getElementById("submissionGraphContainer");
  if (!container) return;

  if (submissionComparisonChart) {
    submissionComparisonChart.destroy();
    submissionComparisonChart = null;
  }

  const snapshot = submission.template_snapshot || submission.template || {};
  const data = submission.data || {};
  const templateType = snapshot.template_type || "form";

  if (templateType !== "table" || !Array.isArray(data.rows)) {
    container.innerHTML = "";
    return;
  }

  const columns = (snapshot.columns || data.columns || [])
    .map((column) => {
      if (typeof column === "string") {
        return { name: column, role: null };
      }
      if (column && typeof column === "object") {
        return {
          name: column.name || "",
          role: column.role || column.columnRole || null,
        };
      }
      return { name: "", role: null };
    })
    .filter((c) => c.name);

  console.log("Graph columns", columns);

  const mainColumn = columns.find(
    (c) => String(c.role).toLowerCase() === "main",
  );
  const targetColumn = columns.find(
    (c) => String(c.role).toLowerCase() === "target",
  );
  const achievedColumn = columns.find(
    (c) => String(c.role).toLowerCase() === "achieved",
  );

  console.log("Graph roles", {
    mainColumn,
    targetColumn,
    achievedColumn,
  });

  if (!mainColumn || !targetColumn || !achievedColumn) {
    container.innerHTML =
      '<div style="color: #666; font-size: 12px;">Graph requires columns marked as Main label, Target, and Achieved.</div>';
    return;
  }

  const labels = [];
  const targets = [];
  const achieved = [];

  data.rows.forEach((row) => {
    if (!row || row.__summaryType) return;
    const label = row[mainColumn.name];
    if (label === undefined || label === null || label === "") return;
    const targetValue = parseFloat(row[targetColumn.name]);
    const achievedValue = parseFloat(row[achievedColumn.name]);
    if (Number.isNaN(targetValue) || Number.isNaN(achievedValue)) return;
    labels.push(String(label));
    targets.push(targetValue);
    achieved.push(achievedValue);
  });

  if (labels.length === 0) {
    container.innerHTML =
      '<div style="color: #666; font-size: 12px;">No numeric data available for graph rendering.</div>';
    return;
  }

  if (typeof Chart === "undefined") {
    container.innerHTML =
      '<div style="color: #666; font-size: 12px;">Chart library not loaded.</div>';
    return;
  }

  container.innerHTML =
    '<canvas id="submissionComparisonChart" height="120"></canvas>';
  const ctx = document
    .getElementById("submissionComparisonChart")
    .getContext("2d");

  submissionComparisonChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: targetColumn.name || "Target",
          data: targets,
          backgroundColor: "#90caf9",
        },
        {
          label: achievedColumn.name || "Achieved",
          data: achieved,
          backgroundColor: "#a5d6a7",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
        },
      },
    },
  });
}

function triggerDownloadFromBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

// FIX: Feature1 - Excel download works for all template types through backend generator.
function downloadSubmissionExcel() {
  if (!currentReviewSubmission) return;
  generateSubmissionDocument(currentReviewSubmission.id);
}

function downloadSubmissionJson() {
  if (!currentReviewSubmission) return;
  const blob = new Blob([JSON.stringify(currentReviewSubmission, null, 2)], {
    type: "application/json",
  });
  triggerDownloadFromBlob(
    blob,
    `submission_${currentReviewSubmission.id}.json`,
  );
}

// FIX: Bug5 - Use implemented backend route for Excel generation.
function generateSubmissionDocument(submissionId) {
  fetch(`/api/project-templates/submission/${submissionId}/generate-document`, {
    headers: getAuthHeaders(),
  })
    .then((response) => {
      if (!response.ok) throw new Error("Failed to generate document");
      return response.blob();
    })
    .then((blob) => {
      triggerDownloadFromBlob(blob, `submission-${submissionId}.xlsx`);
    })
    .catch((error) => {
      console.error("Error generating document:", error);
      showToast("Error generating document", "error");
    });
}

function exportSubmissionsJson() {
  if (!pmSubmissionsCache || pmSubmissionsCache.length === 0) {
    showToast("No submissions to export", "warning");
    return;
  }

  const blob = new Blob([JSON.stringify(pmSubmissionsCache, null, 2)], {
    type: "application/json",
  });
  triggerDownloadFromBlob(blob, "submissions.json");
}

// FIX: Feature6 - Bulk export now uses backend export endpoint (xlsx default).
function exportSubmissionsExcel() {
  const projectId = effectivePMProjectId();
  if (!projectId) {
    showToast("Please select a project first", "warning");
    return;
  }

  fetch(`/api/project-templates/${projectId}/submissions/export?format=xlsx`, {
    headers: getAuthHeaders(),
  })
    .then((response) => {
      if (!response.ok) throw new Error("Export failed");
      return response.blob();
    })
    .then((blob) => {
      triggerDownloadFromBlob(blob, `project-${projectId}-submissions.xlsx`);
    })
    .catch((error) => {
      console.error("Error exporting submissions:", error);
      showToast("Failed to export submissions", "error");
    });
}

// FIX: Feature6 - Backward-compatible alias; CSV action now routes to bulk export endpoint workflow.
function exportSubmissionsCsv() {
  exportSubmissionsExcel();
}

/**
 * Approve a submission
 */
function approveSubmission() {
  if (!currentReviewSubmission) return;

  fetch(
    `/api/project-templates/submission/${currentReviewSubmission.id}/approve`,
    {
      method: "POST",
      headers: getAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ status: "approved" }),
    },
  )
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        showToast("Submission approved successfully", "success");
        closeModal("reviewSubmissionModal");
        loadPMSubmissions();
      } else {
        showToast(data.message || "Failed to approve", "error");
      }
    })
    .catch((error) => {
      console.error("Error approving submission:", error);
      showToast("Error approving submission", "error");
    });
}

function rejectSubmissionModal() {
  if (typeof openModal === "function") {
    openModal("rejectReasonModal");
  } else {
    document.getElementById("rejectReasonModal").style.display = "flex";
  }
}

function confirmRejection() {
  if (!currentReviewSubmission) return;

  const reason = document.getElementById("rejectReason").value.trim();
  if (!reason) {
    showToast("Please provide a rejection reason", "error");
    return;
  }

  fetch(
    `/api/project-templates/submission/${currentReviewSubmission.id}/reject`,
    {
      method: "POST",
      headers: getAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ status: "rejected", review_comment: reason }),
    },
  )
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        showToast("Submission rejected", "success");
        closeModal("rejectReasonModal");
        closeModal("reviewSubmissionModal");
        document.getElementById("rejectReason").value = "";
        loadPMSubmissions();
      } else {
        showToast(data.message || "Failed to reject", "error");
      }
    })
    .catch((error) => {
      console.error("Error rejecting submission:", error);
      showToast("Error rejecting submission", "error");
    });
}

function quickApprove(submissionId) {
  if (!confirm("Approve this submission?")) return;

  fetch(`/api/project-templates/submission/${submissionId}/approve`, {
    method: "POST",
    headers: getAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ status: "approved" }),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        showToast("Submission approved", "success");
        loadPMSubmissions();
      } else {
        showToast(data.message || "Failed to approve", "error");
      }
    })
    .catch((error) => {
      console.error("Error approving submission:", error);
      showToast("Error approving submission", "error");
    });
}

function initSubmissionReview() {
  if (effectivePMProjectId()) loadPMSubmissions();
  else renderSelectProjectPlaceholder();
}

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("reviewSubmissionModal")) {
    initSubmissionReview();
  }
});
