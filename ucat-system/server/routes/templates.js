import express from "express";
import pool from "../db.js";
import { requireRole } from "../middleware/role.js";
import xlsx from "xlsx";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

let templateSchemaEnsured = false;
let templateSchemaEnsuringPromise = null;

async function ensureTemplateTableCompatibility() {
  if (templateSchemaEnsured) return;
  if (templateSchemaEnsuringPromise) {
    await templateSchemaEnsuringPromise;
    return;
  }

  // FIX: Hotfix - support older DBs missing newer template columns.
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

router.use(async (req, res, next) => {
  try {
    await ensureTemplateTableCompatibility();
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
  if (["SUM", "TOTAL", "AVERAGE", "MIN", "MAX"].includes(normalized)) {
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

      const normalizedFormulaType = normalizeFormulaType(column.formulaType);
      const sourceColumns = Array.isArray(column.formulaSourceColumns)
        ? column.formulaSourceColumns
            .map((entry) => String(entry || "").trim())
            .filter(Boolean)
        : [];
      const rowFixedValues =
        column.rowFixedValues && typeof column.rowFixedValues === "object"
          ? column.rowFixedValues
          : {};

      return {
        id: String(column.id || `column_${Date.now()}_${index}`),
        name,
        isLocked: !!column.isLocked,
        fixedValue:
          column.fixedValue === undefined ? null : String(column.fixedValue),
        rowFixedValues,
        formulaType: normalizedFormulaType,
        formulaExpression:
          column.formulaExpression === undefined ||
          column.formulaExpression === null
            ? null
            : String(column.formulaExpression),
        formulaScope:
          String(column.formulaScope || "row").toLowerCase() === "column"
            ? "column"
            : "row",
        formulaSourceColumns: sourceColumns,
      };
    })
    .filter(Boolean);
}

function normalizeTemplateStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["draft", "scheduled", "pushed"].includes(normalized)) {
    return normalized;
  }
  return "pushed";
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

async function assignTemplateToProjectNow({
  projectId,
  templateId,
  assignedBy,
  repetitionType,
  repetitionDays,
}) {
  return pool.query(
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
      assignedBy,
      repetitionType || "daily",
      JSON.stringify(normalizeRepetitionDays(repetitionDays)),
    ],
  );
}

router.post(
  "/",
  requireRole("site_engineer", "project_manager", "supervisor", "superadmin"),
  async (req, res) => {
    try {
      const {
        name,
        description,
        fields,
        rows,
        is_default,
        template_type,
        columns,
        row_limit,
        status,
        scheduled_at,
        scheduled_config,
      } = req.body;
      const templateType = template_type || "form";
      const normalizedColumns = normalizeTemplateColumns(columns);
      const templateStatus = normalizeTemplateStatus(status || "pushed");

      if (!name) {
        return res.status(400).json({ error: "Template name is required" });
      }

      if (templateType === "table") {
        if (normalizedColumns.length === 0) {
          return res
            .status(400)
            .json({ error: "Table templates require at least one column" });
        }
      } else if (
        (!fields || fields.length === 0) &&
        (!rows || rows.length === 0)
      ) {
        return res
          .status(400)
          .json({ error: "Form templates require at least one field or row" });
      }

      const result = await pool.query(
        `INSERT INTO templates (user_id, name, description, template_type, fields, rows, columns, row_limit, status, scheduled_at, scheduled_config, is_default, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, user_id, name, description, template_type, fields, rows, columns, row_limit, status, scheduled_at, scheduled_config, is_default, is_active, created_at, updated_at`,
        [
          req.user.id,
          name,
          description || null,
          templateType,
          JSON.stringify(templateType === "form" ? fields || [] : []),
          JSON.stringify(templateType === "form" ? rows || [] : []),
          JSON.stringify(templateType === "table" ? normalizedColumns : []),
          row_limit || null,
          templateStatus,
          scheduled_at || null,
          JSON.stringify(scheduled_config || null),
          is_default || false,
          true,
        ],
      );

      const template = result.rows[0];

      res.status(201).json({
        success: true,
        message: "Template created successfully",
        template: {
          id: template.id,
          user_id: template.user_id,
          name: template.name,
          description: template.description,
          template_type: template.template_type || "form",
          fields: parseJson(template.fields, []),
          rows: parseJson(template.rows, []),
          columns: parseJson(template.columns, []),
          row_limit: template.row_limit,
          status: template.status || "pushed",
          scheduled_at: template.scheduled_at,
          scheduled_config: parseJson(template.scheduled_config, null),
          is_default: template.is_default,
          is_active: template.is_active,
          created_at: template.created_at,
          updated_at: template.updated_at,
        },
      });
    } catch (error) {
      console.error("Error creating template:", error);
      res.status(500).json({ error: "Failed to create template" });
    }
  },
);

router.get("/library", requireRole("superadmin"), async (req, res) => {
  try {
    const statusFilter = String(req.query.status || "").trim().toLowerCase();
    const params = [];
    let query = `SELECT id, user_id, name, description, template_type, fields, rows, columns, row_limit, status, scheduled_at, scheduled_config, is_default, is_active, created_at, updated_at
       FROM templates
       WHERE is_active = true`;

    if (["draft", "scheduled", "pushed"].includes(statusFilter)) {
      params.push(statusFilter);
      query += ` AND status = $${params.length}`;
    }

    query += " ORDER BY updated_at DESC, created_at DESC";
    const result = await pool.query(query, params);

    const templates = result.rows.map((t) => ({
      id: t.id,
      user_id: t.user_id,
      name: t.name,
      description: t.description,
      template_type: t.template_type || "form",
      fields: parseJson(t.fields, []),
      rows: parseJson(t.rows, []),
      columns: parseJson(t.columns, []),
      row_limit: t.row_limit,
      status: t.status || "pushed",
      scheduled_at: t.scheduled_at,
      scheduled_config: parseJson(t.scheduled_config, null),
      is_default: t.is_default,
      is_active: t.is_active,
      created_at: t.created_at,
      updated_at: t.updated_at,
    }));

    res.json({ success: true, templates });
  } catch (error) {
    console.error("Error fetching template library:", error);
    res.status(500).json({ success: false, error: "Failed to fetch template library" });
  }
});

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, user_id, name, description, template_type, fields, rows, columns, row_limit, status, scheduled_at, scheduled_config, is_default, is_active, created_at, updated_at
       FROM templates
       WHERE is_active = true
       ORDER BY created_at DESC`,
    );

    const templates = result.rows.map((t) => ({
      id: t.id,
      user_id: t.user_id,
      name: t.name,
      description: t.description,
      template_type: t.template_type || "form",
      fields: parseJson(t.fields, []),
      rows: parseJson(t.rows, []),
      columns: parseJson(t.columns, []),
      row_limit: t.row_limit,
      status: t.status || "pushed",
      scheduled_at: t.scheduled_at,
      scheduled_config: parseJson(t.scheduled_config, null),
      is_default: t.is_default,
      is_active: t.is_active,
      created_at: t.created_at,
      updated_at: t.updated_at,
    }));

    res.json({ success: true, templates });
  } catch (error) {
    console.error("Error fetching templates:", error);
    res.status(500).json({ error: "Failed to fetch templates" });
  }
});

router.post(
  "/:templateId/push",
  requireRole("superadmin"),
  async (req, res) => {
    try {
      const { templateId } = req.params;
      const projectId = req.body.projectId || req.body.project_id;
      const repetitionType =
        req.body.repetitionType || req.body.repetition_type || "daily";
      const repetitionDays = normalizeRepetitionDays(
        req.body.repetitionDays || req.body.repetition_days,
      );
      const scheduledAt = req.body.scheduledAt || req.body.scheduled_at || null;

      if (!projectId) {
        return res
          .status(400)
          .json({ success: false, error: "Project ID is required for push" });
      }

      const templateResult = await pool.query(
        `SELECT id, status, scheduled_at FROM templates WHERE id = $1 AND is_active = true`,
        [templateId],
      );

      if (templateResult.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, error: "Template not found" });
      }

      if (scheduledAt) {
        const scheduledDate = new Date(scheduledAt);
        if (Number.isNaN(scheduledDate.getTime())) {
          return res
            .status(400)
            .json({ success: false, error: "Invalid scheduled time" });
        }

        const now = new Date();
        if (scheduledDate > now) {
          await pool.query(
            `UPDATE templates
             SET status = 'scheduled',
                 scheduled_at = $1,
                 scheduled_config = $2,
                 updated_at = NOW()
             WHERE id = $3`,
            [
              scheduledDate.toISOString(),
              JSON.stringify({
                project_id: Number(projectId),
                repetition_type: repetitionType,
                repetition_days: repetitionDays,
                assigned_by: req.user.id,
              }),
              templateId,
            ],
          );

          return res.json({
            success: true,
            scheduled: true,
            message: "Template push scheduled",
          });
        }
      }

      const assignment = await assignTemplateToProjectNow({
        projectId: Number(projectId),
        templateId: Number(templateId),
        assignedBy: req.user.id,
        repetitionType,
        repetitionDays,
      });

      await pool.query(
        `UPDATE templates
         SET status = 'pushed',
             scheduled_at = NULL,
             scheduled_config = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [templateId],
      );

      res.json({
        success: true,
        scheduled: false,
        message: "Template pushed to project",
        projectTemplate: assignment.rows[0],
      });
    } catch (error) {
      console.error("Error pushing template:", error);
      res.status(500).json({ success: false, error: "Failed to push template" });
    }
  },
);

// FIX: Feature3 - Add direct get-by-id endpoint to avoid fetching entire template list for edit.
router.get("/:templateId", async (req, res) => {
  try {
    const { templateId } = req.params;
    const result = await pool.query(
      `SELECT id, user_id, name, description, template_type, fields, rows, columns, row_limit, status, scheduled_at, scheduled_config, is_default, is_active, created_at, updated_at
       FROM templates
       WHERE id = $1 AND is_active = true`,
      [templateId],
    );

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Template not found" });
    }

    const t = result.rows[0];
    res.json({
      success: true,
      template: {
        id: t.id,
        user_id: t.user_id,
        name: t.name,
        description: t.description,
        template_type: t.template_type || "form",
        fields: parseJson(t.fields, []),
        rows: parseJson(t.rows, []),
        columns: parseJson(t.columns, []),
        row_limit: t.row_limit,
        status: t.status || "pushed",
        scheduled_at: t.scheduled_at,
        scheduled_config: parseJson(t.scheduled_config, null),
        is_default: t.is_default,
        is_active: t.is_active,
        created_at: t.created_at,
        updated_at: t.updated_at,
      },
    });
  } catch (error) {
    console.error("Error fetching template by id:", error);
    res.status(500).json({ success: false, error: "Failed to fetch template" });
  }
});

router.post("/:templateId/submit", async (req, res) => {
  try {
    const { templateId } = req.params;
    const { project_id, data, formulas } = req.body;

    if (!project_id || !data) {
      return res
        .status(400)
        .json({ error: "Project ID and data are required" });
    }

    const templateResult = await pool.query(
      "SELECT name, fields FROM templates WHERE id = $1 AND is_active = true",
      [templateId],
    );

    if (templateResult.rows.length === 0) {
      return res.status(404).json({ error: "Template not found" });
    }

    const template = templateResult.rows[0];
    const templateFields = parseJson(template.fields, []);

    const projectResult = await pool.query(
      "SELECT id, name FROM projects WHERE id = $1",
      [project_id],
    );

    if (projectResult.rows.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    const project = projectResult.rows[0];

    const workbook = xlsx.utils.book_new();
    const rows = [
      [`${template.name} - ${project.name}`],
      ["Submitted By:", req.user.name],
      ["Date:", new Date().toISOString().split("T")[0]],
      ["Time:", new Date().toLocaleTimeString()],
      [],
    ];

    const headerRow = templateFields.map((f) => f.label);
    const dataRow = templateFields.map((f) => data[f.name] || "");
    rows.push(headerRow);
    rows.push(dataRow);

    if (Array.isArray(formulas) && formulas.length > 0) {
      rows.push([]);
      formulas.forEach((formula) => {
        rows.push([formula.label || "Formula", formula.type || ""]);
      });
    }

    const sheet = xlsx.utils.aoa_to_sheet(rows);
    xlsx.utils.book_append_sheet(workbook, sheet, "Report");

    const filename = `template_${template.name.replace(/\s+/g, "_")}_${uuidv4()}_${Date.now()}.xlsx`;
    const filepath = path.join("uploads", filename);

    if (!fs.existsSync("uploads")) {
      fs.mkdirSync("uploads", { recursive: true });
    }

    xlsx.writeFile(workbook, filepath);

    const docResult = await pool.query(
      `INSERT INTO documents (project_id, title, file_path, file_type, uploaded_by_id, original_name, file_size, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, project_id, title, file_path, file_type, uploaded_by_id, created_at, status`,
      [
        project_id,
        `${template.name} - ${project.name}`,
        filepath,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        req.user.id,
        filename,
        fs.statSync(filepath).size,
        "available",
      ],
    );

    res.status(201).json({
      success: true,
      message: "Template submitted and document created",
      document: docResult.rows[0],
    });
  } catch (error) {
    console.error("Error submitting template:", error);
    res.status(500).json({ error: "Failed to submit template" });
  }
});

router.put(
  "/:templateId",
  requireRole("site_engineer", "project_manager", "supervisor", "superadmin"),
  async (req, res) => {
    try {
      const { templateId } = req.params;
      const {
        name,
        description,
        fields,
        rows,
        is_default,
        template_type,
        columns,
        row_limit,
        status,
        scheduled_at,
        scheduled_config,
      } = req.body;
      const templateType = template_type || "form";
      const normalizedColumns = normalizeTemplateColumns(columns);
      const templateStatus = normalizeTemplateStatus(status || "pushed");

      if (!name) {
        return res.status(400).json({ error: "Template name is required" });
      }

      if (templateType === "table") {
        if (normalizedColumns.length === 0) {
          return res
            .status(400)
            .json({ error: "Table templates require at least one column" });
        }
      } else if (
        (!fields || fields.length === 0) &&
        (!rows || rows.length === 0)
      ) {
        return res
          .status(400)
          .json({ error: "Form templates require at least one field or row" });
      }

      // FIX: Bug4 - Ensure updated_at is set whenever template is updated.
      const result = await pool.query(
        `UPDATE templates
       SET name = $1,
           description = $2,
           template_type = $3,
           fields = $4,
           rows = $5,
           columns = $6,
           row_limit = $7,
             status = $8,
             scheduled_at = $9,
             scheduled_config = $10,
             is_default = $11,
           updated_at = NOW()
           WHERE id = $12
           RETURNING id, user_id, name, description, template_type, fields, rows, columns, row_limit, status, scheduled_at, scheduled_config, is_default, is_active, created_at, updated_at`,
        [
          name,
          description || null,
          templateType,
          JSON.stringify(templateType === "form" ? fields || [] : []),
          JSON.stringify(templateType === "form" ? rows || [] : []),
          JSON.stringify(templateType === "table" ? normalizedColumns : []),
          row_limit || null,
          templateStatus,
          scheduled_at || null,
          JSON.stringify(scheduled_config || null),
          is_default || false,
          templateId,
        ],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Template not found" });
      }

      const template = result.rows[0];

      res.json({
        success: true,
        message: "Template updated successfully",
        template: {
          id: template.id,
          user_id: template.user_id,
          name: template.name,
          description: template.description,
          template_type: template.template_type || "form",
          fields: parseJson(template.fields, []),
          rows: parseJson(template.rows, []),
          columns: parseJson(template.columns, []),
          row_limit: template.row_limit,
          status: template.status || "pushed",
          scheduled_at: template.scheduled_at,
          scheduled_config: parseJson(template.scheduled_config, null),
          is_default: template.is_default,
          is_active: template.is_active,
          created_at: template.created_at,
          updated_at: template.updated_at,
        },
      });
    } catch (error) {
      console.error("Error updating template:", error);
      res.status(500).json({ error: "Failed to update template" });
    }
  },
);

router.delete("/:templateId", async (req, res) => {
  try {
    const { templateId } = req.params;

    const result = await pool.query(
      "UPDATE templates SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id",
      [templateId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Template not found" });
    }

    res.json({ success: true, message: "Template deleted successfully" });
  } catch (error) {
    console.error("Error deleting template:", error);
    res.status(500).json({ error: "Failed to delete template" });
  }
});

export default router;
