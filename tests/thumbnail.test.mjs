import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import worker from "../src/index.js";

const imageBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9UhwLIkAAAAASUVORK5CYII=",
  "base64"
);

function makeDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE teams (
      id INTEGER PRIMARY KEY,
      team_number INTEGER,
      team_name TEXT,
      is_active INTEGER
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE submissions (
      id INTEGER PRIMARY KEY,
      team_id INTEGER UNIQUE,
      title TEXT,
      description TEXT,
      game_url TEXT,
      thumbnail_url TEXT,
      status TEXT,
      submitted_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE votes (
      id INTEGER PRIMARY KEY,
      team_id INTEGER NOT NULL
    );
    INSERT INTO teams VALUES (1, 1, '첫 팀', 1), (2, 2, '둘째 팀', 1);
    INSERT INTO settings VALUES ('submission_open', 'true');
  `);
  sqlite.exec(readFileSync(new URL("../migrations/0001_thumbnail_images.sql", import.meta.url), "utf8"));

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
            args = values.map(value => value instanceof Uint8Array ? Buffer.from(value) : value);
            return this;
          },
          first() {
            const row = sqlite.prepare(sql).get(...args);
            if (row?.image_data) row.image_data = [...row.image_data];
            return row || null;
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

async function teamToken(teamId, secret) {
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({
    sub: teamId,
    type: "team",
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

function uploadRequest(token, bytes = imageBytes, type = "image/png") {
  const form = new FormData();
  form.append("image", new File([bytes], "art.png", { type }));
  return new Request("https://example.test/api/team/thumbnail", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form
  });
}

test("team can edit, delete, and re-upload before publication without inheriting votes", async () => {
  const { sqlite, binding } = makeDatabase();
  const env = { DB: binding, AUTH_SECRET: "test-secret" };
  const token = await teamToken(1, env.AUTH_SECRET);
  const otherToken = await teamToken(2, env.AUTH_SECRET);

  assert.equal((await worker.fetch(uploadRequest(null), env)).status, 401);
  assert.equal((await worker.fetch(uploadRequest(token, new Uint8Array(1024 * 1024 + 1)), env)).status, 413);
  assert.equal((await worker.fetch(uploadRequest(token, new Uint8Array([1, 2, 3])), env)).status, 400);

  const upload = await worker.fetch(uploadRequest(token), env);
  assert.equal(upload.status, 200);
  const { thumbnailUrl } = await upload.json();
  assert.match(thumbnailUrl, /^\/api\/public\/thumbnails\/[0-9a-f-]{36}$/);

  const image = await worker.fetch(new Request(`https://example.test${thumbnailUrl}`), env);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("Content-Type"), "image/png");
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), imageBytes);

  const submission = {
    title: "아이들 게임",
    description: "직접 만든 그림",
    gameUrl: "https://example.test/game",
    thumbnailUrl,
    submit: true
  };
  const wrongTeamSave = await worker.fetch(new Request("https://example.test/api/team/submission", {
    method: "PUT",
    headers: { Authorization: `Bearer ${otherToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(submission)
  }), env);
  assert.equal(wrongTeamSave.status, 400);

  const save = await worker.fetch(new Request("https://example.test/api/team/submission", {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(submission)
  }), env);
  assert.equal(save.status, 200);
  assert.equal((await save.json()).submission.thumbnailUrl, thumbnailUrl);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM thumbnail_images").get().count, 1);

  const edit = await worker.fetch(new Request("https://example.test/api/team/submission", {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...submission, title: "고친 게임", submit: false })
  }), env);
  assert.equal(edit.status, 200);
  assert.equal((await edit.json()).submission.title, "고친 게임");

  const deleteRequest = auth => new Request("https://example.test/api/team/submission", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${auth}` }
  });
  assert.equal((await worker.fetch(deleteRequest(otherToken), env)).status, 404);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM submissions").get().count, 1);
  assert.equal((await worker.fetch(deleteRequest(token), env)).status, 200);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM submissions").get().count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM thumbnail_images").get().count, 0);
  assert.equal((await worker.fetch(new Request(`https://example.test${thumbnailUrl}`), env)).status, 404);

  const newUpload = await worker.fetch(uploadRequest(token), env);
  const newThumbnailUrl = (await newUpload.json()).thumbnailUrl;
  const newSubmission = { ...submission, title: "다시 만든 게임", thumbnailUrl: newThumbnailUrl };
  const newSave = await worker.fetch(new Request("https://example.test/api/team/submission", {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(newSubmission)
  }), env);
  assert.equal(newSave.status, 200);

  sqlite.prepare("UPDATE submissions SET status = 'published' WHERE team_id = 1").run();
  assert.equal((await worker.fetch(deleteRequest(token), env)).status, 409);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM thumbnail_images").get().count, 1);
  sqlite.prepare("UPDATE submissions SET status = 'submitted' WHERE team_id = 1").run();
  sqlite.prepare("INSERT INTO votes (team_id) VALUES (1)").run();
  assert.equal((await worker.fetch(deleteRequest(token), env)).status, 409);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM submissions").get().count, 1);
  assert.equal((await worker.fetch(uploadRequest(token), env)).status, 409);
  assert.equal((await worker.fetch(new Request("https://example.test/api/team/submission", {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...newSubmission, title: "표를 이어받을 새 게임" })
  }), env)).status, 409);
  sqlite.close();
});
