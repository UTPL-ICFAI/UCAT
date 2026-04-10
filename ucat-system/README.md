# UCAT Construction Analysis Tracker System

A comprehensive web-based system for managing construction projects, monitoring worker attendance, tracking project issues, and managing site documentation.

## Prerequisites

- **Node.js** (v14 or higher)
- **PostgreSQL** (v12 or higher)
- **npm** (comes with Node.js)

## Installation

### 1. Clone/Download the Project

Navigate to the project root directory.

### 2. Database Setup

#### Create PostgreSQL Database

```bash
psql -U postgres
```

Once in psql:
```sql
CREATE DATABASE ucat_db;
```

Exit psql:
```sql
\q
```

#### Load Database Schema

```bash
psql -U postgres -d ucat_db -f server/schema.sql
```

This creates all tables with proper relationships, indexes, and constraints.

### 3. Seed Initial Data

```bash
npm run seed
```

This creates the default superadmin user with credentials:
- **User ID:** superadmin
- **Password:** superadmin

### 4. Environment Configuration

Create a `.env` file in the root directory by copying the template:

```bash
cp .env.example .env
```

Edit `.env` with your database credentials and configuration:

```env
DB_USER=postgres
DB_PASSWORD=<your_postgres_password>
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ucat_db
JWT_SECRET=your_secret_key_here_change_in_production
PORT=3000
NODE_ENV=development
```

### 5. Install Dependencies

```bash
npm install
```

## Running the Application

Start the server:

```bash
npm start
```

The application will be available at:
- **URL:** http://localhost:3000
- **Login Page:** http://localhost:3000/

## Default Credentials

| Field | Value |
|-------|-------|
| User ID | superadmin |
| Password | superadmin |

After first login, create additional users through the Superadmin dashboard.

## Project Structure

```
ucat-system/
├── server/
│   ├── index.js              # Express application entry point
│   ├── db.js                 # PostgreSQL connection pool
│   ├── schema.sql            # Database schema DDL
│   ├── seed.js               # Database seeding script
│   ├── middleware/
│   │   ├── auth.js           # JWT verification middleware
│   │   └── role.js           # Role-based access control
│   └── routes/
│       ├── auth.js           # Authentication endpoints
│       ├── superadmin.js     # Superadmin management routes
│       ├── projects.js       # Project management
│       ├── tasks.js          # Task management
│       ├── workers.js        # Worker management
│       ├── attendance.js     # Attendance tracking
│       ├── images.js         # Image upload/approval
│       ├── documents.js      # Document management
│       ├── troubleshoot.js   # Issue tracking
│       ├── communications.js # Project messaging
│       ├── budget.js         # Budget tracking
│       └── sse.js            # Server-Sent Events
├── public/
│   ├── index.html            # Login page
│   ├── css/
│   │   ├── main.css          # Global styles
│   │   └── dashboard.css     # Dashboard layouts
│   ├── js/
│   │   └── auth.js           # Client-side auth logic
│   └── dashboards/
│       ├── superadmin.html   # Superadmin dashboard
│       ├── projectManager.html # PM dashboard
│       ├── siteEngineer.html # SE dashboard
│       └── supervisor.html   # Supervisor dashboard
├── uploads/                  # File upload directory (created at runtime)
├── package.json
├── .env.example
└── README.md
```

## User Roles and Features

### Superadmin (SA)
- View overall project statistics and analytics
- Create and manage projects
- Create and manage users
- Assign users to projects
- Manage user permissions
- View all issues and resolutions
- Export user data to CSV
- Monitor project budgets

### Project Manager (PM)
- View assigned projects
- Create and manage tasks
- Upload and organize project documents
- Search documents by title, drawing number, discipline
- Track project budget and expenses
- View team information
- Participate in project communications
- Resolve reported issues
- View approved site images

### Site Engineer (SE)
- View assigned projects
- Manage project workers
- Track worker attendance
- Approve/reject site images with feedback
- Create and escalate issues to PM
- Update task status
- Participate in project communications
- View attendance history

### Supervisor
- View assigned projects
- Mark worker attendance
- Upload site images with descriptions
- Raise construction issues
- View uploaded image status
- Monitor issue tracking

## Database Schema

### Core Tables

1. **users** - User accounts with roles and permissions
2. **projects** - Construction project details
3. **project_assignments** - User assignments to projects
4. **tasks** - Project tasks with assignments and status
5. **workers** - Site workers under supervisors
6. **attendance** - Daily worker attendance records
7. **site_images** - Site photographs with approval workflow
8. **documents** - Project documents with metadata
9. **troubleshoot_issues** - Issue tracking and escalation
10. **daily_budget_tracking** - Project expense tracking
11. **communications** - Project group messages
12. **permissions** - User permission sets (JSONB)

All tables include:
- Proper foreign key relationships with CASCADE delete
- Indexes on frequently queried columns (project_id, user_id, status, date)
- TIMESTAMPTZ columns for all timestamps (defaults to current UTC)
- CHECK constraints for enum fields (role, status)

## API Documentation

### Authentication
- **POST** `/api/auth/login` - Login with user_id and password
- **POST** `/api/auth/logout` - Logout and clear session

### Projects
- **GET** `/api/projects` - List user's projects
- **POST** `/api/projects` - Create project (SA only)
- **GET** `/api/projects/:id` - Get project details
- **PUT** `/api/projects/:id` - Update project (SA only)

### Tasks
- **GET** `/api/tasks` - List tasks (filtered by role)
- **POST** `/api/tasks` - Create task (PM only)
- **PUT** `/api/tasks/:id` - Update task status

### Workers
- **GET** `/api/workers` - List workers
- **POST** `/api/workers` - Add worker (SE only)
- **DELETE** `/api/workers/:id` - Remove worker (SE only)

### Attendance
- **GET** `/api/attendance` - Query attendance records
- **POST** `/api/attendance` - Record attendance

### Images
- **GET** `/api/images` - List images (with status filter)
- **POST** `/api/images` - Upload images (multipart/form-data)
- **PUT** `/api/images/approve/:id` - Approve image (SE only)
- **PUT** `/api/images/reject/:id` - Reject image (SE only)

### Documents
- **GET** `/api/documents` - List documents
- **POST** `/api/documents` - Upload document (multipart/form-data)
- **GET** `/api/documents/search` - Search documents

### Issues
- **GET** `/api/troubleshoot` - List issues
- **POST** `/api/troubleshoot` - Create issue
- **PUT** `/api/troubleshoot/:id/escalate` - Escalate to PM (SE only)
- **PUT** `/api/troubleshoot/:id/resolve` - Resolve issue (SA/PM only)

### Budget
- **GET** `/api/budget` - Query budget records
- **POST** `/api/budget` - Record expense

### Real-time Updates
- **GET** `/api/sse` - Server-Sent Events endpoint for real-time notifications

## File Upload Specifications

### Images
- **Accepted Formats:** JPEG, PNG
- **Maximum Size:** 10 MB per file
- **Storage Path:** `uploads/images/{project_id}/`
- **Status Workflow:** pending → approved/rejected

### Documents
- **Accepted Formats:** PDF, ZIP, PNG, JPEG
- **Maximum Size:** 50 MB per file
- **Storage Path:** `uploads/documents/{project_id}/`
- **Searchable Fields:** title, drawing_number, discipline

## Features

### Real-time Updates
The system uses Server-Sent Events (SSE) for real-time notifications. Users are subscribed to relevant events based on their role and project assignments.

### Image Approval Workflow
1. Supervisor uploads site images
2. Site Engineer reviews pending images
3. Images are approved or rejected with optional feedback
4. Project Manager views approved images in project dashboard

### Issue Tracking
1. Users (Supervisor/SE) create issues with title and description
2. Site Engineers escalate to Project Manager
3. Project Manager/Superadmin resolves issues
4. All stakeholders can monitor issue status

### Budget Tracking
- Daily expense tracking per project
- 30-day expense trend visualization
- Budget vs actual comparison charts
- CSV export capability

## Security Features

- **JWT Authentication:** Token-based authentication with httpOnly cookies
- **Role-Based Access Control:** Endpoint protection via role middleware
- **Password Hashing:** bcrypt for secure password storage (cost factor: 10)
- **CORS Protection:** Configured CORS for production deployments
- **Input Validation:** Server-side validation on all endpoints
- **File Upload Validation:** MIME type and size restrictions

## Pagination and Filtering

Most list endpoints support:
- Filtering by status, project_id, date ranges
- Sorting by relevant fields
- Search functionality for documents and users

## Error Handling

All endpoints return consistent error responses:
```json
{
  "error": "Descriptive error message"
}
```

HTTP Status Codes:
- `200` - Success
- `201` - Created
- `400` - Bad request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not found
- `500` - Server error

## Troubleshooting

### Port Already in Use
If port 3000 is in use, change the `PORT` in `.env` file.

### Database Connection Error
- Verify PostgreSQL is running: `psql --version`
- Check `.env` credentials match your PostgreSQL setup
- Ensure database `ucat_db` exists: `psql -U postgres -l`

### CORS Issues
Update the CORS configuration in `server/index.js` if accessing from a different domain.

### Image Upload Not Working
- Verify `uploads/` directory has write permissions
- Check file size limits in `.env` or `server/routes/images.js`
- Browser console may show specific error details

### Attendance Not Saving
- Ensure worker is assigned to supervisor for the project
- Verify project_id matches in request
- Check attendance status values: "present", "absent", "half_day"

## Performance Considerations

- Database indexes on `project_id`, `user_id`, `status`, and `date` improve query performance
- SSE connections use a Map structure for efficient message broadcasting
- File uploads are streamed to disk, not stored in memory
- Consider adding Redis for session management in high-concurrency scenarios

## Production Deployment

Before deploying to production:

1. Update `NODE_ENV=production` in `.env`
2. Change `JWT_SECRET` to a strong random value
3. Update database credentials to production database
4. Enable HTTPS for secure cookie transmission
5. Configure proper CORS origins
6. Set up reverse proxy (nginx) for static file serving
7. Implement rate limiting on authentication endpoints
8. Set up database backups
9. Monitor server logs and error rates

## Support and Maintenance

- Clear logs regularly to prevent disk space issues
- Monitor database connection pool usage
- Backup database regularly
- Review user permissions quarterly
- Update dependencies for security patches

## License

Proprietary - UCAT Construction Analysis Tracker System

---

For questions or issues, refer to API documentation and database schema files.
