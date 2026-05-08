import pool from "../db.js";

function toRateValue(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

export async function getActiveRates() {
  const result = await pool.query(
    `SELECT cost_per_meter, cost_per_kilometer
     FROM cost_configs
     WHERE is_active = true
     ORDER BY updated_at DESC, created_at DESC, id DESC
     LIMIT 1`,
  );

  if (result.rows.length === 0) {
    const fallbackResult = await pool.query(
      `SELECT cost_per_meter, cost_per_kilometer
       FROM cost_configs
       ORDER BY is_active DESC, updated_at DESC, created_at DESC, id DESC
       LIMIT 1`,
    );

    if (fallbackResult.rows.length === 0) {
      return { cost_per_meter: 0, cost_per_kilometer: 0 };
    }

    const fallbackRow = fallbackResult.rows[0];
    return {
      cost_per_meter: toRateValue(fallbackRow.cost_per_meter),
      cost_per_kilometer: toRateValue(fallbackRow.cost_per_kilometer),
    };
  }

  const row = result.rows[0];
  return {
    cost_per_meter: toRateValue(row.cost_per_meter),
    cost_per_kilometer: toRateValue(row.cost_per_kilometer),
  };
}

export function calculateCost(distance, unit, rates = {}) {
  const distanceValue = Number(distance);
  if (!Number.isFinite(distanceValue) || distanceValue <= 0) {
    return 0;
  }

  const normalizedUnit = String(unit || "").trim().toLowerCase();
  const rate =
    normalizedUnit === "kilometer"
      ? toRateValue(rates.cost_per_kilometer)
      : normalizedUnit === "meter"
        ? toRateValue(rates.cost_per_meter)
        : 0;

  if (rate <= 0) {
    return 0;
  }

  return distanceValue * rate;
}