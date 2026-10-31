import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import worker from "../src/index.js";

function makeDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE admins (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL,
      display_name TEXT,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL
    );

    CREATE TABLE teams (
      id INTEGER PRIMARY KEY,
      team_number INTEGER NOT NULL,
      team_name TEXT NOT NULL,
      access_code_hash TEXT NOT NULL,
      is_active INTEGER NOT NULL
    );

    CREATE TABLE submissions (
      id INTEGER PRIMARY KEY,
      team_id INTEGER NOT NULL UNIQUE,
      title TEXT,
      status TEXT,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );

    CREATE TABLE thumbnail_images (
      id TEXT PRIMARY KEY,
      team_id INTEGER NOT NULL,
      content_type TEXT NOT NULL,
      image_data BLOB NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );

    CREATE TABLE visitors (
      id INTEGER PRIMARY KEY,
      visitor_token TEXT NOT NULL UNIQUE
    );

    CREATE TABLE votes (
      id INTEGER PRIMARY KEY,
      visitor_id INTEGER NOT NULL UNIQUE,
      team_id INTEGER NOT NULL,
      FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE CASCADE,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );

    CREATE TABLE admin_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO admins VALUES (1, 'admin', '운영자', 'admin', 1);
    INSERT INTO teams VALUES (1, 1, '삭제할 팀', 'hash', 1), (2, 2, '남을 팀', 'hash', 1);
    INSERT INTO submissions VALUES (1, 1, '삭제할 작품', 'published'), (2, 2, '남을 작품', 'published');
    INSERT INTO thumbnail_images VALUES ('image-1', 1, 'image/png', X'00'), ('image-2', 2, 'image/png', X'00');
    INSERT INTO visitors VALUES (1, 'visitor-1'), (2, 'visitor-2');
    INSERT INTO votes VALUES (1, 1, 1), (2, 2, 2);
  `);

  return {
    sqlite,
    binding: {
      batch(statements) {
        sqlite.exec("BEGIN");
        try {
          const results = statements.map(statement => statement.run());
          sqlite.exec("COMMIT");
          return results;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
      prepare(sql) {
        let args = [];
        return {
          bind(...values) {
            args = values;
            return this;
          },
          first() {
            return sqlite.prepare(sql).get(...args) || null;
          },
          run() {
            const result = sqlite.prepare(sql).run(...args);
            return { meta: { changes: Number(result.changes) } };
          }
        };
      }
    }
  };
}

async function adminToken(adminId, secret) {
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({
    sub: adminId,
    type: "admin",
    iat: now,
    exp: now + 3600
  })).toString("base64url");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = Buffer.from(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body)
  )).toString("base64url");
  return `${body}.${signature}`;
}

function deleteRequest(token, teamId = 1) {
  return new Request(`https://example.test/api/admin/teams/${teamId}`, {
    method: "DELETE",
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
}

test("admin permanently deletes a team and only its linked records", async () => {
  const { sqlite, binding } = makeDatabase();
  const env = { DB: binding, AUTH_SECRET: "test-secret" };
  const token = await adminToken(1, env.AUTH_SECRET);

  assert.equal((await worker.fetch(deleteRequest(null), env)).status, 401);

  const response = await worker.fetch(deleteRequest(token), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).deleted, {
    teamId: 1,
    teamNumber: 1,
    teamName: "삭제할 팀",
    submissions: 1,
    thumbnails: 1,
    votes: 1
  });

  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM teams WHERE id = 1").get().count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM submissions WHERE team_id = 1").get().count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM thumbnail_images WHERE team_id = 1").get().count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM votes WHERE team_id = 1").get().count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM visitors").get().count, 2);

  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM teams WHERE id = 2").get().count, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM submissions WHERE team_id = 2").get().count, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM thumbnail_images WHERE team_id = 2").get().count, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM votes WHERE team_id = 2").get().count, 1);
  assert.match(sqlite.prepare("SELECT details FROM admin_logs ORDER BY id DESC LIMIT 1").get().details, /1팀 삭제할 팀 삭제/);

  assert.equal((await worker.fetch(deleteRequest(token), env)).status, 404);
  sqlite.close();
});
