/**
 * Default Templates for UCAT System
 * These templates are seeded into the database as system defaults
 */

// Daily Progress Report Template - Based on BKV-PKG-09 screenshot
const defaultDailyProgressReport = {
  name: 'Daily Progress Report - BKV-PKG-09',
  description: 'Daily tunnel excavation progress tracking. Includes face drilling, measurements, target progress, and balance tracking.',
  is_default: true,
  fields: [
    // Row 1 - Headers
    { label: 'Tunnel Type', type: 'text', colspan: 1, rowspan: 2, required: true },
    { label: 'Tunnel Start Chainage', type: 'number', colspan: 1, rowspan: 2, required: true },
    { label: 'Tunnel End Chainage', type: 'number', colspan: 1, rowspan: 2, required: true },
    { label: 'Face Current Chainage', type: 'number', colspan: 1, rowspan: 2, required: true },
    { label: 'Tunnel Length / SCOPE', type: 'number', colspan: 1, rowspan: 2, required: true },
    { label: 'Steel RD (Nos.)', type: 'number', colspan: 1, rowspan: 2, required: false },
    { label: 'Rock Class', type: 'text', colspan: 1, rowspan: 2, required: true },
    { label: 'Lattice Girders (Nos.)', type: 'number', colspan: 1, rowspan: 2, required: false },
    { label: 'Month Target (m)', type: 'number', colspan: 1, rowspan: 2, required: true },
    { label: 'Target (m)', type: 'number', colspan: 1, rowspan: 2, required: true },
    { label: 'Today\'s Per day (m)', type: 'decimal', colspan: 1, rowspan: 2, required: true },
    { label: 'Progress for This Month (m)', type: 'number', colspan: 1, rowspan: 2, required: true },
    { label: 'Till Last Month (m)', type: 'number', colspan: 1, rowspan: 2, required: true },
    { label: 'Total Progress Up To Date (m)', type: 'number', colspan: 1, rowspan: 2, required: true },
    { label: '% Age Completed', type: 'decimal', colspan: 1, rowspan: 2, required: true },
    { label: 'Balance (m)', type: 'number', colspan: 1, rowspan: 2, required: true },
    { label: 'Remarks', type: 'text', colspan: 1, rowspan: 2, required: false }
  ],
  rows: [
    {
      label: 'TUNNEL UNDERGROUND EXCAVATION- HEADING',
      cells: [
        'P1 -PORTAL HEADING',
        'LHS TUBE',
        'RHS TUBE',
        'Total P1 - UG Excavation'
      ]
    },
    {
      label: 'P2 -PORTAL HEADING',
      cells: [
        'LHS TUBE',
        'RHS TUBE',
        'Total P2 - UG Excavation'
      ]
    },
    {
      label: 'Total P1 & P2 - UG Excavation'
    }
  ]
};

// Safety Checklist Template
const defaultSafetyChecklist = {
  name: 'Daily Safety Checklist',
  description: 'Daily safety inspection and compliance checklist for site engineers.',
  is_default: true,
  fields: [
    { label: 'Inspection Date', type: 'date', required: true },
    { label: 'Site Inspector', type: 'text', required: true },
    { label: 'PPE Compliance', type: 'checkbox', required: true },
    { label: 'Machine Safety Guards', type: 'checkbox', required: true },
    { label: 'Emergency Exits Clear', type: 'checkbox', required: true },
    { label: 'First Aid Kit Available', type: 'checkbox', required: true },
    { label: 'Safety Issues Found', type: 'text', required: false },
    { label: 'Corrective Actions', type: 'text', required: false }
  ],
  rows: []
};

// Weekly Status Report Template
const defaultWeeklyStatusReport = {
  name: 'Weekly Project Status Report',
  description: 'Weekly summary of project activities, progress, and issues.',
  is_default: true,
  fields: [
    { label: 'Week Ending Date', type: 'date', required: true },
    { label: 'Progress Percentage', type: 'decimal', required: true },
    { label: 'Activities Completed', type: 'text', required: true },
    { label: 'Activities Planned', type: 'text', required: true },
    { label: 'Manpower Status', type: 'number', required: true },
    { label: 'Plant & Equipment Status', type: 'text', required: false },
    { label: 'Safety Incidents', type: 'number', required: false },
    { label: 'Issues & Risks', type: 'text', required: false },
    { label: 'Prepared By', type: 'text', required: true }
  ],
  rows: []
};

export {
  defaultDailyProgressReport,
  defaultSafetyChecklist,
  defaultWeeklyStatusReport
};
