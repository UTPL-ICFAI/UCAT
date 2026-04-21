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
      } = req.body;
      const templateType = template_type || "form";

      if (!name) {
        return res.status(400).json({ error: "Template name is required" });
      }

      if (templateType === "table") {
        if (!columns || columns.length === 0) {
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
        `INSERT INTO templates (user_id, name, description, template_type, fields, rows, columns, row_limit, is_default, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, user_id, name, description, template_type, fields, rows, columns, row_limit, is_default, is_active, created_at, updated_at`,
        [
          req.user.id,
          name,
          description || null,
          templateType,
          JSON.stringify(templateType === "form" ? fields || [] : []),
          JSON.stringify(templateType === "form" ? rows || [] : []),
          JSON.stringify(templateType === "table" ? columns || [] : []),
          row_limit || null,
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

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, user_id, name, description, template_type, fields, rows, columns, row_limit, is_default, is_active, created_at, updated_at
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

// FIX: Feature3 - Add direct get-by-id endpoint to avoid fetching entire template list for edit.
router.get("/:templateId", async (req, res) => {
  try {
    const { templateId } = req.params;
    const result = await pool.query(
      `SELECT id, user_id, name, description, template_type, fields, rows, columns, row_limit, is_default, is_active, created_at, updated_at
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
      } = req.body;
      const templateType = template_type || "form";

      if (!name) {
        return res.status(400).json({ error: "Template name is required" });
      }

      if (templateType === "table") {
        if (!columns || columns.length === 0) {
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
           is_default = $8,
           updated_at = NOW()
       WHERE id = $9
       RETURNING id, user_id, name, description, template_type, fields, rows, columns, row_limit, is_default, is_active, created_at, updated_at`,
        [
          name,
          description || null,
          templateType,
          JSON.stringify(templateType === "form" ? fields || [] : []),
          JSON.stringify(templateType === "form" ? rows || [] : []),
          JSON.stringify(templateType === "table" ? columns || [] : []),
          row_limit || null,
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
