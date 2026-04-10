# UCAT - Construction Tracking System

A comprehensive construction management and tracking system built with Node.js, Express, and PostgreSQL.

## Features

- **Project Management**: Create and manage construction projects with detailed information
- **User Management**: Create users with different roles (Project Manager, Site Engineer, Supervisor)
- **Daily Templates**: Create custom templates for daily reports and submissions
- **Document Management**: Store and organize project-related documents
- **Role-Based Access Control**: Different permission levels for different user roles
- **Real-time Dashboard**: Monitor project status, budgets, and metrics

## Tech Stack

- **Backend**: Node.js with Express.js
- **Database**: PostgreSQL
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Authentication**: JWT (JSON Web Tokens)
- **Additional Tools**: Chart.js for visualizations, Font Awesome for icons

## Installation

### Prerequisites

- Node.js (v14 or higher)
- PostgreSQL (v12 or higher)
- npm or yarn

### Setup

1. Clone the repository
```bash
git clone https://github.com/UTPL-ICFAI/UCAT.git
cd UCAT/ucat-system
```

2. Install dependencies
```bash
npm install
```

3. Create a `.env` file in the `ucat-system` directory with the following variables:
```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ucat_db
DB_USER=postgres
DB_PASSWORD=your_password
JWT_SECRET=your_secret_key
PORT=3000
```

4. Initialize the database
```bash
npm run init-db
```

5. Start the server
```bash
npm start
```

The application will be available at `http://localhost:3000`

## Default Login

- **Username**: superadmin
- **Password**: superadmin

## Project Structure

```
ucat-system/
├── server/
│   ├── index.js
│   ├── db.js
│   ├── schema.sql
│   ├── routes/
│   │   ├── auth.js
│   │   ├── superadmin.js
│   │   ├── templates.js
│   │   └── ...
│   └── middleware/
│       └── role.js
├── public/
│   ├── index.html
│   ├── css/
│   │   ├── main.css
│   │   └── dashboard.css
│   ├── js/
│   │   └── superadmin.js
│   └── dashboards/
│       ├── superadmin.html
│       └── ...
└── package.json
```

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout

### Users
- `GET /api/users` - Get all users
- `POST /api/users` - Create new user
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user

### Projects
- `GET /api/projects` - Get all projects
- `POST /api/projects` - Create new project
- `PUT /api/projects/:id` - Update project
- `DELETE /api/projects/:id` - Delete project

### Templates
- `GET /api/templates` - Get all templates
- `POST /api/templates` - Create new template
- `PUT /api/templates/:id` - Update template
- `DELETE /api/templates/:id` - Delete template

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
