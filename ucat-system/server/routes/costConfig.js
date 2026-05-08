import express from "express";
import pool from "../db.js";
import { requireRole } from "../middleware/role.js";

const router = express.Router();

function normalizeConfig(row) {
  return {
    id: row.id,
    name: row.name,
    cost_per_meter: Number(row.cost_per_meter) || 0,
    cost_per_kilometer: Number(row.cost_per_kilometer) || 0,
    currency: row.currency || "INR",
    is_active: !!row.is_active,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function parseNumeric(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

router.get("/active", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, cost_per_meter, cost_per_kilometer, currency, is_active, created_by, created_at, updated_at
       FROM cost_configs
       ORDER BY is_active DESC, updated_at DESC, created_at DESC, id DESC`,
    );

    const configs = result.rows.map(normalizeConfig);
    const activeConfig = configs.find((config) => config.is_active) || configs[0] || null;

    res.json({
      cost_per_meter: activeConfig ? activeConfig.cost_per_meter : 0,
      cost_per_kilometer: activeConfig ? activeConfig.cost_per_kilometer : 0,
      currency: activeConfig ? activeConfig.currency : "INR",
      configs,
    });
  } catch (error) {
    console.error("Error loading active cost rates:", error);
    res.status(500).json({ error: "Failed to load active rates" });
  }
});

router.get("/", requireRole("superadmin"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, cost_per_meter, cost_per_kilometer, currency, is_active, created_by, created_at, updated_at
       FROM cost_configs
       ORDER BY is_active DESC, updated_at DESC, created_at DESC, id DESC`,
    );

    res.json({
      success: true,
      data: result.rows.map(normalizeConfig),
    });
  } catch (error) {
    console.error("Error fetching cost configs:", error);
    res.status(500).json({ error: "Failed to fetch cost configs" });
  }
});

router.post("/", requireRole("superadmin"), async (req, res) => {
  const client = await pool.connect();
  try {
    const name = String(req.body.name || "").trim();
    const costPerMeter = parseNumeric(req.body.cost_per_meter);
    const costPerKilometer = parseNumeric(req.body.cost_per_kilometer);
    const currency = String(req.body.currency || "INR").trim() || "INR";
    const isActive = req.body.is_active !== false && req.body.is_active !== "false";

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }
    if (costPerMeter === null || costPerKilometer === null) {
      return res.status(400).json({ error: "Cost rates must be numeric" });
    }

    await client.query("BEGIN");
    if (isActive) {
      await client.query(
        "UPDATE cost_configs SET is_active = false, updated_at = NOW() WHERE is_active = true",
      );
    }

    const result = await client.query(
      `INSERT INTO cost_configs (name, cost_per_meter, cost_per_kilometer, currency, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, cost_per_meter, cost_per_kilometer, currency, is_active, created_by, created_at, updated_at`,
      [name, costPerMeter, costPerKilometer, currency, isActive, req.user.id],
    );

    await client.query("COMMIT");
    res.status(201).json({
      success: true,
      data: normalizeConfig(result.rows[0]),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error creating cost config:", error);
    res.status(500).json({ error: "Failed to create cost config" });
  } finally {
    client.release();
  }
});

router.put("/:id", requireRole("superadmin"), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const name = String(req.body.name || "").trim();
    const costPerMeter = parseNumeric(req.body.cost_per_meter);
    const costPerKilometer = parseNumeric(req.body.cost_per_kilometer);
    const currency = String(req.body.currency || "INR").trim() || "INR";
    const isActive = req.body.is_active !== false && req.body.is_active !== "false";

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }
    if (costPerMeter === null || costPerKilometer === null) {
      return res.status(400).json({ error: "Cost rates must be numeric" });
    }

    await client.query("BEGIN");
    if (isActive) {
      await client.query(
        "UPDATE cost_configs SET is_active = false, updated_at = NOW() WHERE is_active = true AND id <> $1",
        [id],
      );
    }

    const result = await client.query(
      `UPDATE cost_configs
       SET name = $1,
           cost_per_meter = $2,
           cost_per_kilometer = $3,
           currency = $4,
           is_active = $5,
           updated_at = NOW()
       WHERE id = $6
       RETURNING id, name, cost_per_meter, cost_per_kilometer, currency, is_active, created_by, created_at, updated_at`,
      [name, costPerMeter, costPerKilometer, currency, isActive, id],
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Cost config not found" });
    }

    await client.query("COMMIT");
    res.json({
      success: true,
      data: normalizeConfig(result.rows[0]),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error updating cost config:", error);
    res.status(500).json({ error: "Failed to update cost config" });
  } finally {
    client.release();
  }
});

router.delete("/:id", requireRole("superadmin"), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE cost_configs
       SET is_active = false,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, cost_per_meter, cost_per_kilometer, currency, is_active, created_by, created_at, updated_at`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Cost config not found" });
    }

    res.json({
      success: true,
      data: normalizeConfig(result.rows[0]),
    });
  } catch (error) {
    console.error("Error deactivating cost config:", error);
    res.status(500).json({ error: "Failed to deactivate cost config" });
  }
});

export default router;