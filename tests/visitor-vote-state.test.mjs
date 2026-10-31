import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import worker from "../src/index.js";

function makeDatabase() {
  const sqlite = new DatabaseSync(":memory:");

  sqlite.exec(`
    CREATE TABLE teams (
      id INTEGER PRIMARY KEY,
      team_number INTEGER NOT NULL,
      team_name TEXT NOT NULL,
      is_active INTEGER NOT NULL
    );
    CREATE TABLE submissions (
      id INTEGER PRIMARY KEY,
      team_id INTEGER NOT NULL UNIQUE,
      status TEXT NOT NULL
    );
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE visitors (
      id INTEGER PRIMARY KEY,
      visitor_token TEXT NOT NULL UNIQUE,
      last_seen_at TEXT
    );
    CREATE TABLE votes (
      id INTEGER PRIMARY KEY,
      visitor_id INTEGER NOT NULL UNIQUE,
      team_id INTEGER NOT NULL
    );

    INSERT INTO teams VALUES (1, 1, '첫 팀', 1);
    INSERT INTO submissions VALUES (1, 1, 'published');
    INSERT INTO settings VALUES ('plaza_open', 'true'), ('voting_open', 'true');
  `);

  return {
    sqlite,
    binding: {
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
          all() {
            return { results: sqlite.prepare(sql).all(...args) };
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

function sessionRequest(cookie = "") {
  return new Request("https://example.test/api/visitor/session", {
    method: "POST",
    headers: cookie ? { Cookie: cookie } : {}
  });
}

function voteRequest(cookie) {
  return new Request("https://example.test/api/votes", {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ teamId: 1 })
  });
}

test("server vote state remains after browser UI storage is cleared", async () => {
  const { sqlite, binding } = makeDatabase();
  const env = { DB: binding };

  const firstSession = await worker.fetch(sessionRequest(), env);
  assert.equal(firstSession.status, 200);
  assert.deepEqual(await firstSession.json(), {
    ok: true,
    existing: false,
    hasVoted: false
  });

  const setCookie = firstSession.headers.get("Set-Cookie");
  assert.ok(setCookie);
  const cookie = setCookie.split(";")[0];

  const firstVote = await worker.fetch(voteRequest(cookie), env);
  assert.equal(firstVote.status, 200);

  // localStorage·sessionStorage 값이 사라졌다고 가정해도,
  // HttpOnly 방문객 쿠키와 DB 투표 기록은 유지되어 UI가 완료 상태를 복구한다.
  const restoredSession = await worker.fetch(sessionRequest(cookie), env);
  assert.equal(restoredSession.status, 200);
  assert.deepEqual(await restoredSession.json(), {
    ok: true,
    existing: true,
    hasVoted: true
  });

  const duplicateVote = await worker.fetch(voteRequest(cookie), env);
  assert.equal(duplicateVote.status, 409);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM votes").get().count,
    1
  );
  sqlite.close();
});
