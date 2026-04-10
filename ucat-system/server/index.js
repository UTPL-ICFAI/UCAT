import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { verifyToken } from './middleware/auth.js';

// Import routes
import authRoutes from './routes/auth.js';
import superadminRoutes from './routes/superadmin.js';
import projectsRoutes from './routes/projects.js';
import tasksRoutes from './routes/tasks.js';
import workersRoutes from './routes/workers.js';
import attendanceRoutes from './routes/attendance.js';
import imagesRoutes from './routes/images.js';
import documentsRoutes from './routes/documents.js';
import troubleshootRoutes from './routes/troubleshoot.js';
import communicationsRoutes from './routes/communications.js';
import budgetRoutes from './routes/budget.js';
import sseRoutes from './routes/sse.js';
import dailyReportsRoutes from './routes/dailyReports.js';
import templatesRoutes from './routes/templates.js';
import projectTemplatesRoutes from './routes/projectTemplates.js';
import dailyWorkersRoutes from './routes/dailyWorkers.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static files
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/superadmin', verifyToken, superadminRoutes);
app.use('/api/projects', verifyToken, projectsRoutes);
app.use('/api/tasks', verifyToken, tasksRoutes);
app.use('/api/workers', verifyToken, workersRoutes);
app.use('/api/attendance', verifyToken, attendanceRoutes);
app.use('/api/images', verifyToken, imagesRoutes);
app.use('/api/documents', verifyToken, documentsRoutes);
app.use('/api/troubleshoot', verifyToken, troubleshootRoutes);
app.use('/api/communications', verifyToken, communicationsRoutes);
app.use('/api/budget', verifyToken, budgetRoutes);
app.use('/api/daily-reports', verifyToken, dailyReportsRoutes);
app.use('/api/templates', verifyToken, templatesRoutes);
app.use('/api/project-templates', verifyToken, projectTemplatesRoutes);
app.use('/api/daily-workers', verifyToken, dailyWorkersRoutes);
app.use('/api/sse', sseRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`UCAT Construction Tracker Server running on http://localhost:${PORT}`);
  console.log('API endpoints available at http://localhost:' + PORT + '/api');
});
