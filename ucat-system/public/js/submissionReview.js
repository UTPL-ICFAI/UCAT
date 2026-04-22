/**
 * Submission Review Module
 * Handles PM/Superadmin review and approval of template submissions
 */

let currentReviewSubmission = null;
let pmSubmissionsCache = [];

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

  const templateFilter =
    document.getElementById("pmSubmissionTemplateFilter")?.value || "";
  const statusFilter =
    document.getElementById("pmSubmissionStatusFilter")?.value || "";
  const dateFilter =
    document.getElementById("pmSubmissionDateFilter")?.value || "";

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
        loadTemplatesForFilter();
      } else {
        pmSubmissionsCache = [];
        renderPMSubmissions([]);
      }
    })
    .catch((error) => {
      console.error("Error loading submissions:", error);
      showToast("Failed to load submissions", "error");
    });
}

/**
 * Load templates for filter dropdown
 */
function loadTemplatesForFilter() {
  const currentProjectId = effectivePMProjectId();
  if (!currentProjectId) return;

  fetch(`/api/project-templates/${currentProjectId}`, {
    headers: getAuthHeaders(),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.success && Array.isArray(data.data)) {
        const select = document.getElementById("pmSubmissionTemplateFilter");
        if (!select) return;

        const currentValue = select.value;
        select.innerHTML = '<option value="">All Templates</option>';

        data.data.forEach((assignment) => {
          const option = document.createElement("option");
          option.value = assignment.template_id;
          option.textContent =
            assignment.template?.name || assignment.name || "Template";
          select.appendChild(option);
        });

        select.value = currentValue;
      }
    })
    .catch((error) => console.error("Error loading templates:", error));
}

/**
 * Render submissions in table
 */
function renderPMSubmissions(submissions) {
  const tbody = document.getElementById("submissionsTableBody");
  if (!tbody) return;

  if (!submissions || submissions.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="6" style="text-align:center; padding:20px;">No submissions found</td></tr>';
    return;
  }

  tbody.innerHTML = submissions
    .map(
      (submission) => `
    <tr style="background: ${submission.status === "submitted" ? "#fffbea" : ""};">
      <td>${submission.template?.name || "N/A"}</td>
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
        document.getElementById("reviewSubmissionModal").style.display = "flex";
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

  titleEl.textContent = `${submission.template?.name || "Submission"} - ${formatDate(submission.submission_date)}`;

  let html = `
    <div style="margin-bottom: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
      <div>
        <p><strong>Template:</strong> ${submission.template?.name || "N/A"}</p>
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
}

function renderSubmissionData(submission) {
  const snapshot = submission.template_snapshot || submission.template || {};
  const templateType = snapshot.template_type || "form";
  const data = submission.data || {};

  if (templateType === "table" && Array.isArray(data.rows)) {
    const columns = snapshot.columns || data.columns || [];
    const header = columns
      .map(
        (col) =>
          `<th style="padding: 10px; text-align: left; border: 1px solid #ddd;">${col}</th>`,
      )
      .join("");
    const body = data.rows
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
          <thead><tr style="background: #e0e0e0;">${header}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    `;
  }

  if (Array.isArray(data.fields)) {
    const rows = data.fields
      .map(
        (field) => `
      <tr>
        <td style="padding: 8px; border: 1px solid #ddd; font-weight: 600;">${field.label || field.name || "Field"}</td>
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
    const rowBlocks = data.rows
      .map((row) => {
        const cells = Array.isArray(row.cells) ? row.cells : [];
        const cellRows = cells
          .map((cell) => {
            // FIX: Bug3 - Avoid [object Object] by resolving cell label/value safely.
            const cellLabel =
              typeof cell === "object" ? cell.label || "Cell" : String(cell);
            const cellValue =
              typeof cell === "object" ? cell.value || "-" : "-";
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
  document.getElementById("rejectReasonModal").style.display = "flex";
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
