import express from "express";
import fs from "fs";
import path from "path";
import xlsx from "xlsx";
import ExcelJS from "exceljs";
import pool from "../db.js";
import { requireRole } from "../middleware/role.js";

const router = express.Router();

let templateSchemaEnsured = false;
let templateSchemaEnsuringPromise = null;
let submissionSchemaEnsured = false;
let submissionSchemaEnsuringPromise = null;

async function ensureTemplateTableCompatibility() {
  if (templateSchemaEnsured) return;
  if (templateSchemaEnsuringPromise) {
    await templateSchemaEnsuringPromise;
    return;
  }

  // FIX: Hotfix - keep project-template APIs compatible with older DB schemas.
  templateSchemaEnsuringPromise = pool.query(`
    ALTER TABLE templates
      ADD COLUMN IF NOT EXISTS template_type VARCHAR(20) NOT NULL DEFAULT 'form',
      ADD COLUMN IF NOT EXISTS columns JSONB DEFAULT '[]',
      ADD COLUMN IF NOT EXISTS row_limit INTEGER,
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pushed',
      ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS scheduled_config JSONB,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
  `);

  try {
    await templateSchemaEnsuringPromise;
    templateSchemaEnsured = true;
  } finally {
    templateSchemaEnsuringPromise = null;
  }
}

async function ensureSubmissionTableCompatibility() {
  if (submissionSchemaEnsured) return;
  if (submissionSchemaEnsuringPromise) {
    await submissionSchemaEnsuringPromise;
    return;
  }

  // Keep daily_submissions compatible with deployments created before template_snapshot existed.
  submissionSchemaEnsuringPromise = pool.query(`
    ALTER TABLE daily_submissions
      ADD COLUMN IF NOT EXISTS template_snapshot JSONB NOT NULL DEFAULT '{}';
  `);

  try {
    await submissionSchemaEnsuringPromise;
    submissionSchemaEnsured = true;
  } finally {
    submissionSchemaEnsuringPromise = null;
  }
}

async function processDueTemplateSchedules() {
  const dueResult = await pool.query(
    `SELECT id, user_id, scheduled_at, scheduled_config
     FROM templates
     WHERE is_active = true
       AND status = 'scheduled'
       AND scheduled_at IS NOT NULL
       AND scheduled_at <= NOW()`,
  );

  for (const row of dueResult.rows) {
    const config = parseJson(row.scheduled_config, {});
    const projectId = Number(config.project_id || 0);
    if (!projectId) {
      await pool.query(
        `UPDATE templates
         SET status = 'draft',
             scheduled_at = NULL,
             scheduled_config = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [row.id],
      );
      continue;
    }

    const repetitionType = String(config.repetition_type || "daily");
    const repetitionDays = normalizeRepetitionDays(config.repetition_days);

    await pool.query(
      `INSERT INTO project_templates (project_id, template_id, assigned_by, repetition_type, repetition_days, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (project_id, template_id)
       DO UPDATE SET
         is_active = true,
         assigned_by = EXCLUDED.assigned_by,
         repetition_type = EXCLUDED.repetition_type,
         repetition_days = EXCLUDED.repetition_days,
         assigned_at = NOW()`,
      [projectId, row.id, row.user_id || null, repetitionType, JSON.stringify(repetitionDays)],
    );

    await pool.query(
      `UPDATE templates
       SET status = 'pushed',
           scheduled_at = NULL,
           scheduled_config = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [row.id],
    );
  }
}

router.use(async (req, res, next) => {
  try {
    await ensureTemplateTableCompatibility();
    await ensureSubmissionTableCompatibility();
    await processDueTemplateSchedules();
    next();
  } catch (error) {
    console.error("Template schema compatibility check failed:", error);
    next(error);
  }
});

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  }
  return value;
}

function normalizeFormulaType(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === "AVG") return "AVERAGE";
  if (normalized === "TOTAL") return "SUM";
  if (["SUM", "AVERAGE", "MIN", "MAX"].includes(normalized)) {
    return normalized;
  }
  return null;
}



function normalizeTemplateColumns(columnsInput) {
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
          fixedValue: "",
          rowFixedValues: {},
          formulaType: null,
        };
      }

      if (!column || typeof column !== "object") return null;

      const name = String(column.name || "").trim();
      if (!name) return null;

      const fVal = column.fixedValue;

      return {
        id: String(column.id || `column_${Date.now()}_${index}`),
        name,
        isLocked: !!column.isLocked,
        fixedValue:
          fVal === undefined || fVal === null || fVal === "null"
            ? ""
            : String(fVal),
        rowFixedValues:
          column.rowFixedValues && typeof column.rowFixedValues === "object"
            ? column.rowFixedValues
            : {},
        formulaType: normalizeFormulaType(column.formulaType || column.formula_type),
      };
    })
    .filter(Boolean);
}

function summaryLabelForFormula(formulaType) {
  switch (formulaType) {
    case "SUM":
      return "Total";
    case "AVERAGE":
      return "Average";
    case "MIN":
      return "Min";
    case "MAX":
      return "Max";
    default:
      return "Total";
  }
}

function appendSummaryRows(data, templateSnapshot) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const columnDefs = normalizeTemplateColumns(
    templateSnapshot.columns || data.columns || [],
  );

  if (rows.length === 0 || columnDefs.length === 0) {
    return data;
  }

  const formulaColumns = columnDefs.filter((c) => !!c.formulaType);
  if (formulaColumns.length === 0) {
    return data;
  }

  const cleanRows = rows.filter((row) => !row || !row.__summaryType);
  const labelColumn =
    columnDefs.find((c) => !c.formulaType)?.name || columnDefs[0].name;

  const grouped = new Map();
  formulaColumns.forEach((col) => {
    if (!grouped.has(col.formulaType)) grouped.set(col.formulaType, []);
    grouped.get(col.formulaType).push(col.name);
  });

  const summaryRows = [];
  ["SUM", "AVERAGE", "MIN", "MAX"].forEach((formulaType) => {
    if (!grouped.has(formulaType)) return;
    const cols = grouped.get(formulaType) || [];
    const summaryRow = {
      __summaryType: formulaType,
      __summaryLabel: summaryLabelForFormula(formulaType),
    };

    cols.forEach((colName) => {
      const values = cleanRows
        .map((row) => parseFloat(row?.[colName]))
        .filter((value) => !Number.isNaN(value));
      if (values.length === 0) return;

      let result = null;
      if (formulaType === "SUM") {
        result = values.reduce((sum, value) => sum + value, 0);
      } else if (formulaType === "AVERAGE") {
        result = values.reduce((sum, value) => sum + value, 0) / values.length;
      } else if (formulaType === "MIN") {
        result = Math.min(...values);
      } else if (formulaType === "MAX") {
        result = Math.max(...values);
      }

      if (result !== null) summaryRow[colName] = result;
    });

    if (labelColumn) {
      const existing = summaryRow[labelColumn];
      if (existing === undefined || existing === null || existing === "") {
        summaryRow[labelColumn] = summaryRow.__summaryLabel;
      }
    }

    summaryRows.push(summaryRow);
  });

  return { ...data, rows: [...cleanRows, ...summaryRows] };
}

function getColumnNames(columnsInput) {
  return normalizeTemplateColumns(columnsInput).map((column) => column.name);
}

function applyTableColumnPolicies(data, templateSnapshot) {
  const columnDefs = normalizeTemplateColumns(templateSnapshot.columns);
  const incomingRows = Array.isArray(data?.rows) ? data.rows : [];

  const sanitizedRows = incomingRows.map((row, rowIndex) => {
    const nextRow = {};

    columnDefs.forEach((column) => {
      const rowFixedCandidate =
        column.rowFixedValues &&
        Object.prototype.hasOwnProperty.call(column.rowFixedValues, String(rowIndex))
          ? column.rowFixedValues[String(rowIndex)]
          : null;

      if (rowFixedCandidate !== null && rowFixedCandidate !== undefined && rowFixedCandidate !== "" && rowFixedCandidate !== "null") {
        nextRow[column.name] = String(rowFixedCandidate);
        return;
      }

      if (column.fixedValue !== "") {
        nextRow[column.name] = String(column.fixedValue);
        return;
      }

      const rawValue = row && typeof row === "object" ? row[column.name] : "";
      nextRow[column.name] = rawValue === undefined || rawValue === null || rawValue === "null" ? "" : String(rawValue);
    });

    return nextRow;
  });

  return { ...data, rows: sanitizedRows };
}

function normalizeRepetitionDays(input) {
  if (Array.isArray(input)) return input;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch (error) {
      return trimmed
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean);
    }
  }
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
}

function extractSubmissionValues(data, templateSnapshot) {
  const valuesByName = new Map();
  const valuesByLabel = new Map();

  if (Array.isArray(data?.fields)) {
    data.fields.forEach((entry) => {
      const entryLabel = (entry.label || "").toString().trim();
      const entryName = (entry.name || "").toString().trim();
      const entryValue = entry.value;
      if (entryName) valuesByName.set(entryName.toLowerCase(), entryValue);
      if (entryLabel) valuesByLabel.set(entryLabel.toLowerCase(), entryValue);
    });
  }

  if (Array.isArray(data?.rows)) {
    data.rows.forEach((row) => {
      if (Array.isArray(row?.cells)) {
        row.cells.forEach((cell) => {
          const cellLabel = (cell.label || "").toString().trim();
          const cellName = (cell.name || "").toString().trim();
          const cellValue = cell.value;
          if (cellName) valuesByName.set(cellName.toLowerCase(), cellValue);
          if (cellLabel) valuesByLabel.set(cellLabel.toLowerCase(), cellValue);
        });
      }
    });
  }

  const missing = [];
  const requiredFields = (templateSnapshot.fields || []).filter(
    (f) => !!f.required,
  );

  requiredFields.forEach((field) => {
    const byName = valuesByName.get((field.name || "").toLowerCase());
    const byLabel = valuesByLabel.get((field.label || "").toLowerCase());
    const value = byName !== undefined ? byName : byLabel;
    if (value === undefined || value === null || String(value).trim() === "") {
      missing.push(field.label || field.name || "Field");
    }
  });

  (templateSnapshot.rows || []).forEach((row) => {
    (row.cells || []).forEach((cell) => {
      if (!cell || !cell.required) return;
      const byName = valuesByName.get((cell.name || "").toLowerCase());
      const byLabel = valuesByLabel.get((cell.label || "").toLowerCase());
      const value = byName !== undefined ? byName : byLabel;
      if (
        value === undefined ||
        value === null ||
        String(value).trim() === ""
      ) {
        missing.push(cell.label || cell.name || "Cell");
      }
    });
  });

  return missing;
}

function buildSingleSubmissionWorkbookRowType(sheetData, submission) {
  const data = parseJson(submission.data, {});
  const rows = Array.isArray(data.rows) ? data.rows : [];

  rows.forEach((row) => {
    sheetData.push([row.label || "Row"]);
    const cells = Array.isArray(row.cells) ? row.cells : [];
    cells.forEach((cell) => {
      const cellLabel =
        typeof cell === "object" ? cell.label || "Cell" : String(cell);
      const cellValue = typeof cell === "object" ? cell.value || "" : "";
      sheetData.push([cellLabel, cellValue]);
    });
    sheetData.push([]);
  });
}

function buildSingleSubmissionWorkbookTableType(sheetData, submission) {
  const snapshot = parseJson(submission.template_snapshot, {});
  const data = parseJson(submission.data, {});
  const columns =
    Array.isArray(snapshot.columns) && snapshot.columns.length > 0
      ? getColumnNames(snapshot.columns)
      : Array.isArray(data.columns)
        ? getColumnNames(data.columns)
        : [];

  if (columns.length > 0) {
    sheetData.push(columns);
    const rows = Array.isArray(data.rows) ? data.rows : [];
    rows.forEach((row) => {
      sheetData.push(columns.map((col) => row[col] || ""));
    });
  }
}

function buildSingleSubmissionWorkbookFormType(sheetData, submission) {
  const data = parseJson(submission.data, {});
  sheetData.push(["Field", "Value"]);

  if (Array.isArray(data.fields) && data.fields.length > 0) {
    data.fields.forEach((field) => {
      sheetData.push([field.label || field.name || "Field", field.value || ""]);
    });
  } else if (typeof data === "object") {
    Object.keys(data).forEach((key) => {
      sheetData.push([key, data[key]]);
    });
  }
}

function toCsvRow(values) {
  return values
    .map((value) => {
      const str = value === null || value === undefined ? "" : String(value);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    })
    .join(",");
}

function isRestrictedColumn(columnDef) {
  if (!columnDef || typeof columnDef !== "object") return false;
  if (columnDef.isBlocked || columnDef.blocked) return true;
  if (String(columnDef.visibility || "").toUpperCase() === "BLOCKED") return true;
  return false;
}

function safeSheetName(base, fallback, suffix = "") {
  const clean = String(base || "")
    .replace(/[\\/*?:\[\]]/g, "_")
    .replace(/\s+/g, "_")
    .substring(0, 31);
  const composed = (clean || fallback || "Sheet").substring(0, 31 - suffix.length);
  return `${composed}${suffix}`.substring(0, 31);
}

async function createApprovedSubmissionDocument(
  client,
  submission,
  approverId,
) {
  const snapshot = parseJson(submission.template_snapshot, {});
  const templateType = snapshot.template_type || "form";

  const sheetData = [];
  sheetData.push(["Template Name", submission.template_name]);
  sheetData.push(["Project", submission.project_name]);
  sheetData.push(["Submitted By", submission.submitted_by_name]);
  sheetData.push(["Date", submission.submission_date]);
  sheetData.push(["Status", "approved"]);
  sheetData.push([]);

  if (templateType === "table") {
    buildSingleSubmissionWorkbookTableType(sheetData, submission);
  } else if (templateType === "row") {
    buildSingleSubmissionWorkbookRowType(sheetData, submission);
  } else {
    buildSingleSubmissionWorkbookFormType(sheetData, submission);
  }

  const workbook = xlsx.utils.book_new();
  const sheet = xlsx.utils.aoa_to_sheet(sheetData);
  const sheetName = (submission.template_name || "Submission").substring(0, 31);
  xlsx.utils.book_append_sheet(workbook, sheet, sheetName || "Submission");

  const projectDirFs = path.join(
    "uploads",
    "documents",
    String(submission.project_id),
  );
  if (!fs.existsSync(projectDirFs)) {
    fs.mkdirSync(projectDirFs, { recursive: true });
  }

  const filename = `submission_${submission.id}_${Date.now()}.xlsx`;
  const fileFsPath = path.join(projectDirFs, filename);
  xlsx.writeFile(workbook, fileFsPath);

  const dbFilePath = `uploads/documents/${submission.project_id}/${filename}`;

  const docResult = await client.query(
    `INSERT INTO documents (
       project_id,
       uploaded_by,
       title,
       file_path,
       original_name,
       doc_type,
       doc_date,
       revision_date,
       doc_status,
       remarks
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      submission.project_id,
      approverId,
      `${submission.template_name} - ${submission.submitted_by_name || "Site Engineer"} - ${submission.submission_date}`,
      dbFilePath,
      filename,
      "template_submission",
      submission.submission_date || null,
      new Date().toISOString().slice(0, 10),
      "approved",
      `Template: ${submission.template_name}; Site Engineer: ${submission.submitted_by_name || "N/A"}; Submission Date: ${submission.submission_date || "N/A"}; Approval Date: ${new Date().toISOString().slice(0, 10)}; Source Submission: #${submission.id}`,
    ],
  );

  return docResult.rows[0]?.id || null;
}

router.get(
  "/:projectId",
  requireRole("superadmin", "project_manager", "site_engineer"),
  async (req, res) => {
    try {
      const { projectId } = req.params;

      const result = await pool.query(
        `SELECT
         pt.id,
         pt.project_id,
         pt.template_id,
         t.name,
         t.description,
         t.template_type,
         t.fields,
         t.rows,
         t.columns,
         t.row_limit,
         pt.repetition_type,
         pt.repetition_days,
         pt.is_active,
         pt.assigned_at,
         u.name as assigned_by_name
       FROM project_templates pt
       JOIN templates t ON pt.template_id = t.id
       LEFT JOIN users u ON pt.assigned_by = u.id
       WHERE pt.project_id = $1 AND pt.is_active = true
       ORDER BY pt.assigned_at DESC`,
        [projectId],
      );

      res.json({
        success: true,
        data: result.rows.map((row) => ({
          ...row,
          repetition_days: parseJson(row.repetition_days, []),
          template: {
            id: row.template_id,
            name: row.name,
            description: row.description,
            template_type: row.template_type || "form",
            fields: parseJson(row.fields, []),
            rows: parseJson(row.rows, []),
            columns: parseJson(row.columns, []),
            row_limit: row.row_limit,
          },
        })),
      });
    } catch (error) {
      console.error("Error fetching project templates:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to fetch templates" });
    }
  },
);

router.post("/", requireRole("superadmin"), async (req, res) => {
  try {
    const projectId = req.body.projectId || req.body.project_id;
    const templateId = req.body.templateId || req.body.template_id;
    const repetitionType =
      req.body.repetitionType || req.body.repetition_type || "daily";
    const repetitionDays = normalizeRepetitionDays(
      req.body.repetitionDays || req.body.repetition_days,
    );
    const userId = req.user.id;

    if (!projectId || !templateId) {
      return res
        .status(400)
        .json({ error: "Project ID and Template ID required" });
    }

    const result = await pool.query(
      `INSERT INTO project_templates (project_id, template_id, assigned_by, repetition_type, repetition_days, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (project_id, template_id)
       DO UPDATE SET
         is_active = true,
         assigned_by = EXCLUDED.assigned_by,
         repetition_type = EXCLUDED.repetition_type,
         repetition_days = EXCLUDED.repetition_days,
         assigned_at = NOW()
       RETURNING *`,
      [
        projectId,
        templateId,
        userId,
        repetitionType,
        JSON.stringify(repetitionDays),
      ],
    );

    res.status(201).json({ success: true, projectTemplate: result.rows[0] });
  } catch (error) {
    console.error("Error assigning template to project:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to assign template" });
  }
});

router.delete(
  "/:projectTemplateId",
  requireRole("superadmin"),
  async (req, res) => {
    try {
      const { projectTemplateId } = req.params;

      const result = await pool.query(
        `UPDATE project_templates
       SET is_active = false
       WHERE id = $1
       RETURNING id`,
        [projectTemplateId],
      );

      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, error: "Project template not found" });
      }

      res.json({ success: true, message: "Template removed from project" });
    } catch (error) {
      console.error("Error removing template:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to remove template" });
    }
  },
);

// FIX: Bug1 - Keep project submission list route and use singular /submission/:id for single-item actions.
router.get(
  "/:projectId/submissions",
  requireRole("superadmin", "project_manager", "site_engineer"),
  async (req, res) => {
    try {
      const { projectId } = req.params;

      const result = await pool.query(
        `SELECT
         ds.id,
         ds.project_id,
         ds.template_id,
         t.name as template_name,
         t.template_type,
         t.columns,
         t.row_limit,
         ds.submitted_by,
         u.name as submitted_by_name,
         ds.submission_date,
         ds.data,
         ds.template_snapshot,
         ds.status,
         ds.reviewed_by,
         ru.name as reviewed_by_name,
         ds.review_comment,
         ds.reviewed_at,
         ds.created_at
       FROM daily_submissions ds
       JOIN templates t ON ds.template_id = t.id
       JOIN users u ON ds.submitted_by = u.id
       LEFT JOIN users ru ON ds.reviewed_by = ru.id
       WHERE ds.project_id = $1
       ORDER BY ds.submission_date DESC, ds.created_at DESC`,
        [projectId],
      );

      res.json({
        success: true,
        data: result.rows.map((row) => ({
          ...row,
          data: parseJson(row.data, {}),
          template_snapshot: parseJson(row.template_snapshot, null),
          template: {
            id: row.template_id,
            name: row.template_name,
            template_type: row.template_type || "form",
            columns: parseJson(row.columns, []),
            row_limit: row.row_limit,
          },
        })),
      });
    } catch (error) {
      console.error("Error fetching submissions:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to fetch submissions" });
    }
  },
);

// FIX: Feature6 - Export all approved submissions for a project in xlsx/csv.
router.get(
  "/:projectId/submissions/export",
  requireRole("project_manager", "superadmin"),
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const format = (req.query.format || "xlsx").toString().toLowerCase();

      const rowsResult = await pool.query(
        `SELECT
         ds.id,
         ds.project_id,
         ds.template_id,
         ds.submission_date,
         ds.data,
         ds.template_snapshot,
         ds.status,
         t.name as template_name,
         t.template_type,
         p.name as project_name,
         u.name as submitted_by_name
       FROM daily_submissions ds
       JOIN templates t ON t.id = ds.template_id
       JOIN projects p ON p.id = ds.project_id
       JOIN users u ON u.id = ds.submitted_by
       WHERE ds.project_id = $1 AND ds.status = 'approved'
       ORDER BY t.name, ds.submission_date ASC`,
        [projectId],
      );

      if (rowsResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "No approved submissions found for export",
        });
      }

      const grouped = new Map();
      rowsResult.rows.forEach((row) => {
        const key = `${row.template_id}::${row.template_name}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(row);
      });

      if (format === "csv") {
        const csvLines = [];
        grouped.forEach((items, key) => {
          const first = items[0];
          csvLines.push(`# ${first.template_name}`);

          const snapshot = parseJson(first.template_snapshot, {});
          const type = snapshot.template_type || first.template_type || "form";

          if (type === "table") {
            const columns = getColumnNames(snapshot.columns);
            csvLines.push(
              toCsvRow([
                "submission_id",
                "submission_date",
                "submitted_by",
                ...columns,
              ]),
            );
            items.forEach((item) => {
              const data = parseJson(item.data, {});
              const rows = Array.isArray(data.rows) ? data.rows : [];
              rows.forEach((r) => {
                csvLines.push(
                  toCsvRow([
                    item.id,
                    item.submission_date,
                    item.submitted_by_name,
                    ...columns.map((c) => r[c] || ""),
                  ]),
                );
              });
            });
          } else {
            csvLines.push(
              toCsvRow([
                "submission_id",
                "submission_date",
                "submitted_by",
                "field",
                "value",
              ]),
            );
            items.forEach((item) => {
              const data = parseJson(item.data, {});
              const fields = Array.isArray(data.fields) ? data.fields : [];
              fields.forEach((f) => {
                csvLines.push(
                  toCsvRow([
                    item.id,
                    item.submission_date,
                    item.submitted_by_name,
                    f.label || f.name || "Field",
                    f.value || "",
                  ]),
                );
              });
            });
          }

          csvLines.push("");
        });

        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="project-${projectId}-submissions.csv"`,
        );
        return res.send(csvLines.join("\n"));
      }

      const workbook = xlsx.utils.book_new();

      grouped.forEach((items) => {
        const first = items[0];
        const snapshot = parseJson(first.template_snapshot, {});
        const type = snapshot.template_type || first.template_type || "form";
        const sheetData = [];

        sheetData.push(["Project", first.project_name]);
        sheetData.push(["Template", first.template_name]);
        sheetData.push(["Exported At", new Date().toISOString()]);
        sheetData.push([]);

        if (type === "table") {
          const columns = getColumnNames(snapshot.columns);
          sheetData.push([
            "Submission ID",
            "Submission Date",
            "Submitted By",
            ...columns,
          ]);
          items.forEach((item) => {
            const data = parseJson(item.data, {});
            const rows = Array.isArray(data.rows) ? data.rows : [];
            rows.forEach((r) => {
              sheetData.push([
                item.id,
                item.submission_date,
                item.submitted_by_name,
                ...columns.map((c) => r[c] || ""),
              ]);
            });
          });
        } else if (type === "row") {
          sheetData.push([
            "Submission ID",
            "Submission Date",
            "Submitted By",
            "Group",
            "Cell",
            "Value",
          ]);
          items.forEach((item) => {
            const data = parseJson(item.data, {});
            const rows = Array.isArray(data.rows) ? data.rows : [];
            rows.forEach((r) => {
              const cells = Array.isArray(r.cells) ? r.cells : [];
              cells.forEach((cell) => {
                const cellLabel =
                  typeof cell === "object"
                    ? cell.label || "Cell"
                    : String(cell);
                const cellValue =
                  typeof cell === "object" ? cell.value || "" : "";
                sheetData.push([
                  item.id,
                  item.submission_date,
                  item.submitted_by_name,
                  r.label || "Row",
                  cellLabel,
                  cellValue,
                ]);
              });
            });
          });
        } else {
          sheetData.push([
            "Submission ID",
            "Submission Date",
            "Submitted By",
            "Field",
            "Value",
          ]);
          items.forEach((item) => {
            const data = parseJson(item.data, {});
            const fields = Array.isArray(data.fields) ? data.fields : [];
            fields.forEach((f) => {
              sheetData.push([
                item.id,
                item.submission_date,
                item.submitted_by_name,
                f.label || f.name || "Field",
                f.value || "",
              ]);
            });
          });
        }

        const sheet = xlsx.utils.aoa_to_sheet(sheetData);
        const safeName = (first.template_name || "Template").substring(0, 30);
        xlsx.utils.book_append_sheet(workbook, sheet, safeName || "Sheet");
      });

      const buffer = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="project-${projectId}-submissions.xlsx"`,
      );
      res.send(buffer);
    } catch (error) {
      console.error("Error exporting submissions:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to export submissions" });
    }
  },
);

router.get(
  "/:projectId/superadmin-export",
  requireRole("superadmin"),
  async (req, res) => {
    try {
      const { projectId } = req.params;

      const result = await pool.query(
        `SELECT
           ds.id,
           ds.project_id,
           ds.submission_date,
           ds.status,
           ds.review_comment,
           ds.data,
           ds.template_snapshot,
           t.name as template_name,
           u.name as submitted_by_name
         FROM daily_submissions ds
         JOIN templates t ON t.id = ds.template_id
         JOIN users u ON u.id = ds.submitted_by
         WHERE ds.project_id = $1
         ORDER BY ds.submission_date ASC, ds.id ASC`,
        [projectId],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "No submissions found for export",
        });
      }

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "UCAT";
      workbook.created = new Date();

      const approvedRows = result.rows.filter((row) => row.status === "approved");
      const rejectedRows = result.rows.filter((row) => row.status === "rejected");

      approvedRows.forEach((submission, index) => {
        const snapshot = parseJson(submission.template_snapshot, {});
        const data = parseJson(submission.data, {});
        const templateType = snapshot.template_type || "form";
        const sheetName = safeSheetName(
          `${submission.template_name}_${submission.submitted_by_name}_${submission.submission_date}`,
          `Approved_${index + 1}`,
        );
        const ws = workbook.addWorksheet(sheetName);

        ws.addRow(["Template", submission.template_name || "N/A"]);
        ws.addRow(["Site Engineer", submission.submitted_by_name || "N/A"]);
        ws.addRow(["Submission Date", submission.submission_date || "N/A"]);
        ws.addRow(["Status", submission.status || "approved"]);
        ws.addRow([]);

        const statusRow = ws.getRow(4);
        statusRow.getCell(1).font = { bold: true };
        statusRow.getCell(2).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFC6EFCE" },
        };

        if (templateType === "table") {
          const columnDefs = normalizeTemplateColumns(snapshot.columns || data.columns || []);
          const columns = columnDefs.map((c) => c.name);
          const restrictedSet = new Set(
            columnDefs.filter((c) => isRestrictedColumn(c)).map((c) => c.name),
          );

          ws.addRow(columns);
          const headerRow = ws.lastRow;
          headerRow.font = { bold: true };
          headerRow.eachCell((cell) => {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFFFF9C4" },
            };
          });

          const lockedColumns = new Set(
            columnDefs.filter((c) => c.isLocked).map((c) => c.name),
          );

          const tableRows = Array.isArray(data.rows) ? data.rows : [];
          tableRows.forEach((r) => {
            const rowValues = columns.map((c) => {
              if (restrictedSet.has(c)) return "[RESTRICTED]";
              return r[c] === undefined || r[c] === null ? "" : String(r[c]);
            });
            ws.addRow(rowValues);
            const row = ws.lastRow;
            row.eachCell((cell, colNumber) => {
              const colName = columns[colNumber - 1];
              const isLocked = lockedColumns.has(colName);
              cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: isLocked ? "FFFFCDD2" : "FFFFFFFF" },
              };
              if (isLocked) {
                cell.font = { color: { argb: "FF333333" } };
              }
            });
          });
        } else if (Array.isArray(data.fields)) {
          ws.addRow(["Field", "Value"]);
          ws.lastRow.font = { bold: true };
          data.fields.forEach((field) => {
            const blocked =
              field &&
              typeof field === "object" &&
              (field.isBlocked || field.blocked || String(field.visibility || "").toUpperCase() === "BLOCKED");
            ws.addRow([
              field.label || field.name || "Field",
              blocked ? "[RESTRICTED]" : field.value || "",
            ]);
            ws.lastRow.eachCell((cell) => {
              cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FFE2F0D9" },
              };
            });
          });
        } else {
          ws.addRow(["Data"]);
          ws.lastRow.font = { bold: true };
          ws.addRow([JSON.stringify(data)]);
          ws.lastRow.eachCell((cell) => {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFE2F0D9" },
            };
          });
        }

        ws.columns.forEach((column) => {
          let maxLength = 10;
          column.eachCell({ includeEmpty: true }, (cell) => {
            const len = String(cell.value || "").length;
            if (len > maxLength) maxLength = len;
          });
          column.width = Math.min(40, Math.max(12, maxLength + 2));
        });
      });

      if (rejectedRows.length > 0) {
        const rejectSheet = workbook.addWorksheet("Rejected_Summary");
        rejectSheet.addRow([
          "Template",
          "Site Engineer",
          "Submission Date",
          "Status",
          "Review Comment",
        ]);
        rejectSheet.lastRow.font = { bold: true };

        rejectedRows.forEach((row) => {
          rejectSheet.addRow([
            row.template_name || "N/A",
            row.submitted_by_name || "N/A",
            row.submission_date || "N/A",
            row.status || "rejected",
            row.review_comment || "",
          ]);
          rejectSheet.lastRow.eachCell((cell) => {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFF8CBAD" },
            };
          });
        });

        rejectSheet.columns.forEach((column) => {
          let maxLength = 10;
          column.eachCell({ includeEmpty: true }, (cell) => {
            const len = String(cell.value || "").length;
            if (len > maxLength) maxLength = len;
          });
          column.width = Math.min(40, Math.max(12, maxLength + 2));
        });
      }

      const buffer = await workbook.xlsx.writeBuffer();
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="project-${projectId}-superadmin-export.xlsx"`,
      );
      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error("Error exporting superadmin workbook:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to export project workbook" });
    }
  },
);

// FIX: Bug1 - Rename singular route to avoid collision with /:projectId/submissions.
router.get(
  "/submission/:submissionId",
  requireRole("superadmin", "project_manager", "site_engineer"),
  async (req, res) => {
    try {
      const { submissionId } = req.params;

      const result = await pool.query(
        `SELECT
         ds.id,
         ds.project_id,
         ds.template_id,
         t.name as template_name,
         t.template_type,
         t.fields,
         t.rows,
         t.columns,
         t.row_limit,
         p.name as project_name,
         ds.submitted_by,
         u.name as submitted_by_name,
         ds.submission_date,
         ds.data,
         ds.template_snapshot,
         ds.status,
         ds.reviewed_by,
         ru.name as reviewed_by_name,
         ds.review_comment,
         ds.reviewed_at,
         ds.created_at
       FROM daily_submissions ds
       JOIN templates t ON ds.template_id = t.id
       JOIN users u ON ds.submitted_by = u.id
       JOIN projects p ON ds.project_id = p.id
       LEFT JOIN users ru ON ds.reviewed_by = ru.id
       WHERE ds.id = $1`,
        [submissionId],
      );

      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, error: "Submission not found" });
      }

      const row = result.rows[0];
      res.json({
        success: true,
        data: {
          id: row.id,
          project_id: row.project_id,
          project_name: row.project_name,
          template_id: row.template_id,
          template_snapshot: parseJson(row.template_snapshot, null),
          template: {
            name: row.template_name,
            template_type: row.template_type || "form",
            fields: parseJson(row.fields, []),
            rows: parseJson(row.rows, []),
            columns: parseJson(row.columns, []),
            row_limit: row.row_limit,
          },
          submitted_by: row.submitted_by,
          submitted_by_name: row.submitted_by_name,
          submission_date: row.submission_date,
          data: parseJson(row.data, {}),
          status: row.status,
          reviewed_by: row.reviewed_by,
          reviewed_by_name: row.reviewed_by_name,
          review_comment: row.review_comment,
          reviewed_at: row.reviewed_at,
          created_at: row.created_at,
        },
      });
    } catch (error) {
      console.error("Error fetching submission:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to fetch submission" });
    }
  },
);

// FIX: Bug5/Feature1 - Generate Excel document for any submission type.
router.get(
  "/submission/:submissionId/generate-document",
  requireRole("project_manager", "superadmin"),
  async (req, res) => {
    try {
      const { submissionId } = req.params;

      const result = await pool.query(
        `SELECT
         ds.id,
         ds.project_id,
         ds.template_id,
         ds.submission_date,
         ds.data,
         ds.template_snapshot,
         ds.status,
         p.name as project_name,
         t.name as template_name,
         u.name as submitted_by_name
       FROM daily_submissions ds
       JOIN projects p ON p.id = ds.project_id
       JOIN templates t ON t.id = ds.template_id
       JOIN users u ON u.id = ds.submitted_by
       WHERE ds.id = $1`,
        [submissionId],
      );

      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, error: "Submission not found" });
      }

      const submission = result.rows[0];
      const snapshot = parseJson(submission.template_snapshot, {});
      const templateType = snapshot.template_type || "form";

      const sheetData = [];
      sheetData.push(["Template Name", submission.template_name]);
      sheetData.push(["Project", submission.project_name]);
      sheetData.push(["Submitted By", submission.submitted_by_name]);
      sheetData.push(["Date", submission.submission_date]);
      sheetData.push(["Status", submission.status]);
      sheetData.push([]);

      if (templateType === "table") {
        buildSingleSubmissionWorkbookTableType(sheetData, submission);
      } else if (templateType === "row") {
        buildSingleSubmissionWorkbookRowType(sheetData, submission);
      } else {
        buildSingleSubmissionWorkbookFormType(sheetData, submission);
      }

      const workbook = xlsx.utils.book_new();
      const sheet = xlsx.utils.aoa_to_sheet(sheetData);
      const sheetName = (submission.template_name || "Submission").substring(
        0,
        31,
      );
      xlsx.utils.book_append_sheet(workbook, sheet, sheetName || "Submission");

      const buffer = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="submission-${submissionId}.xlsx"`,
      );
      res.send(buffer);
    } catch (error) {
      console.error("Error generating submission document:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to generate document" });
    }
  },
);

router.post(
  "/submission/:submissionId/approve",
  requireRole("superadmin", "project_manager"),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const { submissionId } = req.params;
      const userId = req.user.id;

      await client.query("BEGIN");

      const submissionQuery = await client.query(
        `SELECT
           ds.id,
           ds.project_id,
           ds.template_id,
           ds.submission_date,
           ds.data,
           ds.template_snapshot,
           ds.status,
           p.name as project_name,
           t.name as template_name,
           u.name as submitted_by_name
         FROM daily_submissions ds
         JOIN projects p ON p.id = ds.project_id
         JOIN templates t ON t.id = ds.template_id
         JOIN users u ON u.id = ds.submitted_by
         WHERE ds.id = $1
         FOR UPDATE`,
        [submissionId],
      );

      if (submissionQuery.rows.length === 0) {
        await client.query("ROLLBACK");
        return res
          .status(404)
          .json({ success: false, error: "Submission not found" });
      }

      const submissionRow = submissionQuery.rows[0];

      const documentId = await createApprovedSubmissionDocument(
        client,
        submissionRow,
        userId,
      );

      const result = await client.query(
        `UPDATE daily_submissions
       SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(), document_id = $2
       WHERE id = $3
       RETURNING *`,
        [userId, documentId, submissionId],
      );

      if (result.rows.length === 0) {
        await client.query("ROLLBACK");
        return res
          .status(404)
          .json({ success: false, error: "Submission not found" });
      }

      await client.query("COMMIT");

      res.json({
        success: true,
        message: "Submission approved",
        data: result.rows[0],
        document_created: !!documentId,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error approving submission:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to approve submission" });
    } finally {
      client.release();
    }
  },
);

router.post(
  "/submission/:submissionId/reject",
  requireRole("superadmin", "project_manager"),
  async (req, res) => {
    try {
      const { submissionId } = req.params;
      const { review_comment } = req.body;
      const userId = req.user.id;

      const result = await pool.query(
        `UPDATE daily_submissions
       SET status = 'rejected', reviewed_by = $1, review_comment = $2, reviewed_at = NOW()
       WHERE id = $3
       RETURNING *`,
        [userId, review_comment || "", submissionId],
      );

      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, error: "Submission not found" });
      }

      res.json({
        success: true,
        message: "Submission rejected",
        data: result.rows[0],
      });
    } catch (error) {
      console.error("Error rejecting submission:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to reject submission" });
    }
  },
);

// FIX: Bug1/Bug9/Feature4 - Submit endpoint uses unambiguous param name and returns inserted/updated flag.
router.post(
  "/:projectTemplateId/submit",
  requireRole("site_engineer"),
  async (req, res) => {
    try {
      const { projectTemplateId } = req.params;
      const { data, submissionDate, originalSubmissionId } = req.body;
      const userId = req.user.id;

      const ptResult = await pool.query(
        `SELECT project_id, template_id FROM project_templates WHERE id = $1 AND is_active = true`,
        [projectTemplateId],
      );

      if (ptResult.rows.length === 0) {
        return res.status(404).json({ error: "Project template not found" });
      }

      const { project_id, template_id } = ptResult.rows[0];

      const templateResult = await pool.query(
        `SELECT id, name, template_type, fields, rows, columns, row_limit
       FROM templates
       WHERE id = $1`,
        [template_id],
      );

      if (templateResult.rows.length === 0) {
        return res.status(404).json({ error: "Template not found" });
      }

      const templateRow = templateResult.rows[0];
      const templateSnapshot = {
        id: templateRow.id,
        name: templateRow.name,
        template_type: templateRow.template_type || "form",
        fields: parseJson(templateRow.fields, []),
        rows: parseJson(templateRow.rows, []),
        columns: normalizeTemplateColumns(parseJson(templateRow.columns, [])),
        row_limit: templateRow.row_limit,
      };

      if (!data || typeof data !== "object") {
        return res.status(400).json({ error: "Submission data is required" });
      }

      let sanitizedData = data;

      if (templateSnapshot.template_type === "table") {
        const rowData = Array.isArray(data.rows) ? data.rows : [];
        if (rowData.length === 0) {
          return res
            .status(400)
            .json({ error: "Table submissions require at least one row" });
        }
        if (
          templateSnapshot.row_limit &&
          rowData.length > templateSnapshot.row_limit
        ) {
          return res
            .status(400)
            .json({ error: "Row limit exceeded for this template" });
        }

        sanitizedData = applyTableColumnPolicies(data, templateSnapshot);
        sanitizedData = appendSummaryRows(sanitizedData, templateSnapshot);
      } else {
        // FIX: Feature4 - Validate required fields by name/label case-insensitively and support required row cells.
        const missing = extractSubmissionValues(data, templateSnapshot);
        if (missing.length > 0) {
          return res
            .status(400)
            .json({ error: `Missing required fields: ${missing.join(", ")}` });
        }
      }

      if (originalSubmissionId) {
        const original = await pool.query(
          `SELECT id, project_id, template_id, submitted_by
           FROM daily_submissions
           WHERE id = $1`,
          [originalSubmissionId],
        );

        if (original.rows.length === 0) {
          return res
            .status(404)
            .json({ error: "Original submission not found" });
        }

        const originalRow = original.rows[0];
        if (
          originalRow.submitted_by !== userId ||
          originalRow.project_id !== project_id ||
          originalRow.template_id !== template_id
        ) {
          return res
            .status(403)
            .json({ error: "Not allowed to resubmit this entry" });
        }

        const updateResult = await pool.query(
          `UPDATE daily_submissions
           SET data = $1,
               template_snapshot = $2,
               status = 'submitted',
               reviewed_by = NULL,
               review_comment = NULL,
               reviewed_at = NULL
           WHERE id = $3
           RETURNING *`,
          [
            JSON.stringify(sanitizedData),
            JSON.stringify(templateSnapshot),
            originalSubmissionId,
          ],
        );

        return res.status(200).json({
          success: true,
          inserted: false,
          updated: true,
          submission: updateResult.rows[0],
        });
      }

      // FIX: Bug9 - Detect insert vs update using xmax and return explicit updated flag.
      const result = await pool.query(
        `INSERT INTO daily_submissions (
         project_id,
         template_id,
         submitted_by,
         submission_date,
         data,
         template_snapshot,
         status
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'submitted')
       ON CONFLICT (project_id, template_id, submission_date)
       DO UPDATE SET
         data = EXCLUDED.data,
         template_snapshot = EXCLUDED.template_snapshot,
         status = 'submitted',
         document_id = NULL,
         reviewed_by = NULL,
         review_comment = NULL,
         reviewed_at = NULL
       RETURNING *, (xmax = 0) AS inserted`,
        [
          project_id,
          template_id,
          userId,
          submissionDate,
          JSON.stringify(sanitizedData),
          JSON.stringify(templateSnapshot),
        ],
      );

      const row = result.rows[0];
      const inserted = !!row.inserted;

      res.status(201).json({
        success: true,
        inserted,
        updated: !inserted,
        submission: row,
      });
    } catch (error) {
      console.error("Error submitting template:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to submit template" });
    }
  },
);

export default router;
