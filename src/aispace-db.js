import mysql from "mysql2/promise";

const MYSQL_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS admins (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    role VARCHAR(32) NOT NULL DEFAULT 'admin',
    is_active TINYINT NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS teams (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    team_number INT NOT NULL UNIQUE,
    team_name VARCHAR(255) NOT NULL,
    access_code_hash VARCHAR(255) NOT NULL,
    is_active TINYINT NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS submissions (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    team_id INT UNSIGNED NOT NULL UNIQUE,
    title VARCHAR(255),
    description TEXT,
    game_url TEXT,
    thumbnail_url TEXT,
    status VARCHAR(16) NOT NULL DEFAULT 'draft',
    submitted_at TIMESTAMP NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT submissions_team_fk FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS settings (
    \`key\` VARCHAR(64) NOT NULL PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS visitors (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    visitor_token VARCHAR(128) NOT NULL UNIQUE,
    last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS votes (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    visitor_id INT UNSIGNED NOT NULL UNIQUE,
    team_id INT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT votes_visitor_fk FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE CASCADE,
    CONSTRAINT votes_team_fk FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS admin_logs (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    admin_id INT UNSIGNED,
    action VARCHAR(64) NOT NULL,
    details TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT admin_logs_admin_fk FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS thumbnail_images (
    id CHAR(36) NOT NULL PRIMARY KEY,
    team_id INT UNSIGNED NOT NULL,
    content_type VARCHAR(32) NOT NULL,
    image_data MEDIUMBLOB NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT thumbnail_images_team_fk FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE INDEX submissions_team_id_idx ON submissions(team_id)`,
  `CREATE INDEX votes_team_id_idx ON votes(team_id)`,
  `CREATE INDEX admin_logs_admin_id_idx ON admin_logs(admin_id)`,
  `CREATE INDEX thumbnail_images_team_id_idx ON thumbnail_images(team_id)`,
  `INSERT IGNORE INTO settings (\`key\`, value) VALUES
    ('plaza_open', 'false'),
    ('voting_open', 'false'),
    ('submission_open', 'false'),
    ('results_public', 'false')`
];

function normalizeSql(sql) {
  let normalized = String(sql).replace(/INSERT\s+OR\s+IGNORE/gi, "INSERT IGNORE");
  const conflict = normalized.match(/\s+ON\s+CONFLICT\s*\(\s*team_id\s*\)\s+DO\s+UPDATE\s+SET/i);

  if (conflict) {
    normalized = `${normalized.slice(0, conflict.index)}
      ON DUPLICATE KEY UPDATE
        title = VALUES(title),
        description = VALUES(description),
        game_url = VALUES(game_url),
        thumbnail_url = VALUES(thumbnail_url),
        status = VALUES(status),
        submitted_at = VALUES(submitted_at),
        updated_at = CURRENT_TIMESTAMP`;
  }

  return normalized;
}

class MySqlStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values.map(value => value instanceof Uint8Array ? Buffer.from(value) : value);
    return this;
  }

  async execute(executor = this.database.pool) {
    return executor.execute(normalizeSql(this.sql), this.values);
  }

  async first() {
    const [rows] = await this.execute();
    return rows[0] || null;
  }

  async all() {
    const [rows] = await this.execute();
    return { results: rows };
  }

  async run(executor = this.database.pool) {
    const [result] = await this.execute(executor);
    return {
      meta: {
        changes: Number(result.affectedRows || 0),
        last_row_id: Number(result.insertId || 0)
      }
    };
  }
}

export class MySqlD1Database {
  constructor(pool) {
    this.pool = pool;
  }

  prepare(sql) {
    return new MySqlStatement(this, sql);
  }

  async batch(statements) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const results = [];
      for (const statement of statements) {
        results.push(await statement.run(connection));
      }
      await connection.commit();
      return results;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}

export async function createMySqlDatabase() {
  const required = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`AISPACE DB 환경변수가 없습니다: ${missing.join(", ")}`);
  }

  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    waitForConnections: true,
    connectionLimit: 5,
    charset: "utf8mb4"
  });

  const database = new MySqlD1Database(pool);
  for (const statement of MYSQL_SCHEMA) {
    if (statement.startsWith("CREATE INDEX")) {
      try {
        await pool.query(statement);
      } catch (error) {
        if (error?.code !== "ER_DUP_KEYNAME") {
          await database.close();
          throw error;
        }
      }
      continue;
    }
    await pool.query(statement);
  }

  await pool.query("SELECT 1 AS ok");
  return database;
}
