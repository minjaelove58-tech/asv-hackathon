const encoder = new TextEncoder();
const decoder = new TextDecoder();

const VISITOR_COOKIE = "hackathon_visitor";
const GAME_ROTATION_MS = 3 * 60 * 1000;
const THUMBNAIL_MAX_BYTES = 1024 * 1024;
const THUMBNAIL_PATH = "/api/public/thumbnails/";
const THUMBNAIL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function hasImageSignature(bytes, contentType) {
  if (contentType === "image/png") {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    return signature.every((value, index) => bytes[index] === value);
  }

  if (contentType === "image/jpeg") {
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  }

  if (contentType === "image/webp") {
    return bytes.length >= 12 &&
      decoder.decode(bytes.subarray(0, 4)) === "RIFF" &&
      decoder.decode(bytes.subarray(8, 12)) === "WEBP";
  }

  return false;
}

// 서버에서 같은 명단/시간 구간에 같은 무작위 순서를 생성합니다.
// 새로고침이나 다른 방문객의 접속으로 노출 순서가 다시 추첨되지 않습니다.
async function shufflePublicGames(games, seed) {
  const hash = await sha256Hex(seed);
  let randomState = Number.parseInt(hash.slice(0, 8), 16) || 1;
  const shuffled = [...games];

  for (let i = shuffled.length - 1; i > 0; i--) {
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    const j = Math.floor(((randomState >>> 0) / 4294967296) * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

async function rotatePublicGames(games, now, openedAt) {
  const timestamp = String(openedAt || "").replace(" ", "T");
  const opened = Date.parse(
    /(?:Z|[+-]\d{2}:\d{2})$/i.test(timestamp) ? timestamp : `${timestamp}Z`
  );
  const start = Number.isFinite(opened) && opened <= now ? opened : 0;
  const slot = Math.floor((now - start) / GAME_ROTATION_MS);
  const rotation = {
    serverTime: now,
    nextAt: start + (slot + 1) * GAME_ROTATION_MS
  };

  if (games.length < 2) {
    return { games, rotation };
  }

  const roster = [...games].sort((a, b) => a.teamId - b.teamId);
  const seed = `${start}:${roster.map(game => game.teamId).join(",")}`;
  const turns = await shufflePublicGames(roster, seed);
  const first = turns[slot % turns.length];
  const rest = await shufflePublicGames(
    roster.filter(game => game.teamId !== first.teamId),
    `${seed}:slot:${slot}`
  );

  // 공개 명단이 유지되는 한, 한 순환에서 모든 작품이 정확히 한 번 선두에 옵니다.
  // 작품 공개/비공개로 명단이 바뀌면 새 명단을 기준으로 순서를 계산합니다.
  return { games: [first, ...rest], rotation };
}


// ======================================================
// HEX
// ======================================================

function bytesToHex(bytes) {
  return [...bytes]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}


function hexToBytes(hex) {
  if (
    typeof hex !== "string" ||
    hex.length % 2 !== 0
  ) {
    throw new Error("Invalid hex");
  }

  const result =
    new Uint8Array(hex.length / 2);

  for (let i = 0; i < result.length; i++) {
    const value =
      Number.parseInt(
        hex.slice(
          i * 2,
          i * 2 + 2
        ),
        16
      );

    if (Number.isNaN(value)) {
      throw new Error("Invalid hex");
    }

    result[i] = value;
  }

  return result;
}


// ======================================================
// PASSWORD HASH
// ======================================================

async function hashPassword(password) {
  const iterations = 100000;

  const salt =
    crypto.getRandomValues(
      new Uint8Array(16)
    );

  const key =
    await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );

  const bits =
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt,
        iterations
      },
      key,
      256
    );

  const digest =
    new Uint8Array(bits);

  return [
    "pbkdf2_sha256_hex",
    iterations,
    bytesToHex(salt),
    bytesToHex(digest)
  ].join("$");
}

async function verifyPassword(
  password,
  storedHash
) {
  try {
    const parts =
      String(storedHash || "")
        .split("$");

    if (parts.length !== 4) {
      return false;
    }

    const [
      algorithm,
      iterationText,
      saltHex,
      expectedHex
    ] = parts;

    if (
      algorithm !==
      "pbkdf2_sha256_hex"
    ) {
      return false;
    }

    const iterations =
      Number(iterationText);

    if (
      !Number.isInteger(iterations) ||
      iterations < 1 ||
      iterations > 100000
    ) {
      return false;
    }

    const salt =
      hexToBytes(saltHex);

    const expected =
      hexToBytes(expectedHex);

    const key =
      await crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        "PBKDF2",
        false,
        ["deriveBits"]
      );

    const bits =
      await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          hash: "SHA-256",
          salt,
          iterations
        },
        key,
        256
      );

    const actual =
      new Uint8Array(bits);

    if (
      actual.length !==
      expected.length
    ) {
      return false;
    }

    let difference = 0;

    for (
      let i = 0;
      i < actual.length;
      i++
    ) {
      difference |=
        actual[i] ^
        expected[i];
    }

    return difference === 0;
  } catch {
    return false;
  }
}


// ======================================================
// BASE64 URL
// ======================================================

function base64UrlEncode(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary +=
      String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}


function base64UrlDecode(value) {
  const normalized =
    value
      .replace(/-/g, "+")
      .replace(/_/g, "/");

  const padded =
    normalized +
    "=".repeat(
      (4 - normalized.length % 4) % 4
    );

  const binary =
    atob(padded);

  const result =
    new Uint8Array(
      binary.length
    );

  for (
    let i = 0;
    i < binary.length;
    i++
  ) {
    result[i] =
      binary.charCodeAt(i);
  }

  return result;
}


// ======================================================
// AUTH TOKEN
// ======================================================

async function getAuthKey(secret) {
  if (!secret) {
    throw new Error(
      "AUTH_SECRET is not configured"
    );
  }

  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign", "verify"]
  );
}


async function createAuthToken(
  payload,
  secret
) {
  const now =
    Math.floor(
      Date.now() / 1000
    );

  const body = {
    ...payload,
    iat: now,
    exp: now + 8 * 60 * 60
  };

  const encodedBody =
    base64UrlEncode(
      encoder.encode(
        JSON.stringify(body)
      )
    );

  const key =
    await getAuthKey(secret);

  const signature =
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(
        encodedBody
      )
    );

  return (
    encodedBody +
    "." +
    base64UrlEncode(
      new Uint8Array(
        signature
      )
    )
  );
}


async function verifyAuthToken(
  token,
  secret
) {
  try {
    if (!secret) {
      return null;
    }

    const parts =
      String(token || "")
        .split(".");

    if (parts.length !== 2) {
      return null;
    }

    const [
      encodedBody,
      encodedSignature
    ] = parts;

    const key =
      await getAuthKey(secret);

    const valid =
      await crypto.subtle.verify(
        "HMAC",
        key,
        base64UrlDecode(
          encodedSignature
        ),
        encoder.encode(
          encodedBody
        )
      );

    if (!valid) {
      return null;
    }

    const payload =
      JSON.parse(
        decoder.decode(
          base64UrlDecode(
            encodedBody
          )
        )
      );

    const now =
      Math.floor(
        Date.now() / 1000
      );

    if (
      typeof payload.exp !== "number" ||
      payload.exp <= now
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}


// ======================================================
// ADMIN AUTH
// ======================================================

async function requireAdmin(
  request,
  env
) {
  if (!env.AUTH_SECRET) {
    return null;
  }

  const authorization =
    request.headers.get(
      "Authorization"
    ) || "";

  if (
    !authorization.startsWith(
      "Bearer "
    )
  ) {
    return null;
  }

  const token =
    authorization
      .slice(7)
      .trim();

  const payload =
    await verifyAuthToken(
      token,
      env.AUTH_SECRET
    );

  if (
    !payload ||
    payload.type !== "admin"
  ) {
    return null;
  }

  const admin =
    await env.DB
      .prepare(`
        SELECT
          id,
          username,
          display_name,
          role,
          is_active

        FROM admins

        WHERE id = ?

        LIMIT 1
      `)
      .bind(payload.sub)
      .first();

  if (
    !admin ||
    Number(admin.is_active) !== 1
  ) {
    return null;
  }

  return admin;
}


// ======================================================
// TEAM AUTH
// ======================================================

async function requireTeam(
  request,
  env
) {
  if (!env.AUTH_SECRET) {
    return null;
  }

  const authorization =
    request.headers.get(
      "Authorization"
    ) || "";

  if (
    !authorization.startsWith(
      "Bearer "
    )
  ) {
    return null;
  }

  const token =
    authorization
      .slice(7)
      .trim();

  const payload =
    await verifyAuthToken(
      token,
      env.AUTH_SECRET
    );

  if (
    !payload ||
    payload.type !== "team"
  ) {
    return null;
  }

  const team =
    await env.DB
      .prepare(`
        SELECT
          id,
          team_number,
          team_name,
          is_active

        FROM teams

        WHERE id = ?

        LIMIT 1
      `)
      .bind(payload.sub)
      .first();

  if (
    !team ||
    Number(team.is_active) !== 1
  ) {
    return null;
  }

  return team;
}


// ======================================================
// ADMIN LOG
// ======================================================

async function writeAdminLog(
  env,
  adminId,
  action,
  details = null
) {
  await env.DB
    .prepare(`
      INSERT INTO admin_logs (
        admin_id,
        action,
        details
      )

      VALUES (?, ?, ?)
    `)
    .bind(
      adminId,
      action,
      details
    )
    .run();
}


// ======================================================
// TEAM ACCESS CODE
// ======================================================

function createAccessCode() {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  const random =
    crypto.getRandomValues(
      new Uint8Array(6)
    );

  let code = "";

  for (const value of random) {
    code +=
      chars[
        value % chars.length
      ];
  }

  return code;
}


// ======================================================
// VISITOR SESSION
// ======================================================

function readCookie(request, name) {
  const header =
    request.headers.get(
      "Cookie"
    ) || "";

  if (!header) {
    return null;
  }

  const cookies =
    header.split(";");

  for (const cookie of cookies) {
    const index =
      cookie.indexOf("=");

    if (index === -1) {
      continue;
    }

    const key =
      cookie
        .slice(0, index)
        .trim();

    const value =
      cookie
        .slice(index + 1)
        .trim();

    if (key === name) {
      try {
        return decodeURIComponent(
          value
        );
      } catch {
        return null;
      }
    }
  }

  return null;
}


async function sha256Hex(value) {
  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(value)
    );

  return bytesToHex(
    new Uint8Array(digest)
  );
}


function createVisitorToken() {
  const random =
    crypto.getRandomValues(
      new Uint8Array(32)
    );

  return base64UrlEncode(
    random
  );
}


function visitorCookieHeader(token) {
  return [
    `${VISITOR_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=2592000"
  ].join("; ");
}


// ======================================================
// WORKER
// ======================================================

export default {
  async fetch(request, env) {
    const url =
      new URL(request.url);

    const path =
      url.pathname;


    // ==================================================
    // HEALTH
    // ==================================================

    if (
      path === "/api/health" &&
      request.method === "GET"
    ) {
      try {
        const db =
          await env.DB
            .prepare(
              "SELECT 1 AS ok"
            )
            .first();

        return Response.json({
          ok: true,
          db
        });
      } catch (error) {
        return Response.json(
          {
            ok: false,
            message:
              error instanceof Error
                ? error.message
                : "Database error"
          },
          {
            status: 500
          }
        );
      }
    }


    // ==================================================
    // PUBLIC THUMBNAIL IMAGE
    // ==================================================

    if (path.startsWith(THUMBNAIL_PATH) && request.method === "GET") {
      const imageId = path.slice(THUMBNAIL_PATH.length);
      if (!THUMBNAIL_ID_PATTERN.test(imageId)) {
        return new Response("Not found", { status: 404 });
      }

      const image = await env.DB
        .prepare(`
          SELECT content_type, image_data
          FROM thumbnail_images
          WHERE id = ?
          LIMIT 1
        `)
        .bind(imageId)
        .first();

      if (!image) {
        return new Response("Not found", { status: 404 });
      }

      return new Response(Uint8Array.from(image.image_data), {
        headers: {
          "Content-Type": image.content_type,
          "Content-Length": String(image.image_data.length),
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff"
        }
      });
    }


    // ==================================================
    // ADMIN LOGIN
    // ==================================================

    if (
      path ===
        "/api/auth/admin/login" &&
      request.method === "POST"
    ) {
      if (!env.AUTH_SECRET) {
        return Response.json(
          {
            message:
              "서버 인증 설정이 없습니다."
          },
          {
            status: 500
          }
        );
      }

      let body;

      try {
        body =
          await request.json();
      } catch {
        return Response.json(
          {
            message:
              "잘못된 요청입니다."
          },
          {
            status: 400
          }
        );
      }

      const username =
        String(
          body.username || ""
        ).trim();

      const password =
        String(
          body.password || ""
        );

      if (
        !username ||
        !password
      ) {
        return Response.json(
          {
            message:
              "아이디와 비밀번호를 입력하세요."
          },
          {
            status: 400
          }
        );
      }

      const admin =
        await env.DB
          .prepare(`
            SELECT
              id,
              username,
              password_hash,
              display_name,
              role,
              is_active

            FROM admins

            WHERE username = ?

            LIMIT 1
          `)
          .bind(username)
          .first();

      if (
        !admin ||
        Number(
          admin.is_active
        ) !== 1
      ) {
        return Response.json(
          {
            message:
              "아이디 또는 비밀번호가 올바르지 않습니다."
          },
          {
            status: 401
          }
        );
      }

      const valid =
        await verifyPassword(
          password,
          admin.password_hash
        );

      if (!valid) {
        return Response.json(
          {
            message:
              "아이디 또는 비밀번호가 올바르지 않습니다."
          },
          {
            status: 401
          }
        );
      }

      const token =
        await createAuthToken(
          {
            sub:
              admin.id,

            type:
              "admin",

            username:
              admin.username,

            role:
              admin.role
          },
          env.AUTH_SECRET
        );

      await writeAdminLog(
        env,
        admin.id,
        "admin_login",
        "관리자 로그인"
      );

      return Response.json({
        ok: true,

        token,

        admin: {
          id:
            admin.id,

          username:
            admin.username,

          displayName:
            admin.display_name ||
            admin.username,

          role:
            admin.role
        }
      });
    }


    // ==================================================
    // TEAM LOGIN
    // ==================================================

    if (
      path ===
        "/api/auth/team/login" &&
      request.method === "POST"
    ) {
      if (!env.AUTH_SECRET) {
        return Response.json(
          {
            message:
              "서버 인증 설정이 없습니다."
          },
          {
            status: 500
          }
        );
      }

      let body;

      try {
        body =
          await request.json();
      } catch {
        return Response.json(
          {
            message:
              "잘못된 요청입니다."
          },
          {
            status: 400
          }
        );
      }

      const teamNumber =
        Number(
          body.teamNumber
        );

      const accessCode =
        String(
          body.accessCode || ""
        )
          .trim()
          .toUpperCase();

      if (
        !Number.isInteger(teamNumber) ||
        teamNumber < 1 ||
        teamNumber > 15 ||
        !accessCode
      ) {
        return Response.json(
          {
            message:
              "팀 번호와 접속 코드를 확인해 주세요."
          },
          {
            status: 400
          }
        );
      }

      const team =
        await env.DB
          .prepare(`
            SELECT
              id,
              team_number,
              team_name,
              access_code_hash,
              is_active

            FROM teams

            WHERE team_number = ?

            LIMIT 1
          `)
          .bind(teamNumber)
          .first();

      if (
        !team ||
        Number(team.is_active) !== 1
      ) {
        return Response.json(
          {
            message:
              "팀 번호 또는 접속 코드가 올바르지 않습니다."
          },
          {
            status: 401
          }
        );
      }

      const valid =
        await verifyPassword(
          accessCode,
          team.access_code_hash
        );

      if (!valid) {
        return Response.json(
          {
            message:
              "팀 번호 또는 접속 코드가 올바르지 않습니다."
          },
          {
            status: 401
          }
        );
      }

      const token =
        await createAuthToken(
          {
            sub:
              team.id,

            type:
              "team",

            teamNumber:
              team.team_number
          },
          env.AUTH_SECRET
        );

      return Response.json({
        ok: true,

        token,

        team: {
          id:
            team.id,

          teamNumber:
            team.team_number,

          teamName:
            team.team_name
        }
      });
    }


    // ==================================================
    // VISITOR SESSION
    // ==================================================

    if (
      path ===
        "/api/visitor/session" &&
      request.method === "POST"
    ) {
      const existingToken =
        readCookie(
          request,
          VISITOR_COOKIE
        );


      // ----------------------------------------------
      // 기존 세션
      // ----------------------------------------------

      if (existingToken) {
        const tokenHash =
          await sha256Hex(
            existingToken
          );

        const visitor =
          await env.DB
            .prepare(`
              SELECT id
              FROM visitors
              WHERE visitor_token = ?
              LIMIT 1
            `)
            .bind(tokenHash)
            .first();

        if (visitor) {
          await env.DB
            .prepare(`
              UPDATE visitors

              SET last_seen_at =
                CURRENT_TIMESTAMP

              WHERE id = ?
            `)
            .bind(visitor.id)
            .run();

          const previousVote =
            await env.DB
              .prepare(`
                SELECT id
                FROM votes
                WHERE visitor_id = ?
                LIMIT 1
              `)
              .bind(visitor.id)
              .first();

          return Response.json({
            ok: true,
            existing: true,
            // 브라우저 저장소가 비워져도 서버의 최종 투표 기록을 UI에 반영한다.
            hasVoted: Boolean(previousVote)
          });
        }
      }


      // ----------------------------------------------
      // 새 방문객
      // ----------------------------------------------

      const token =
        createVisitorToken();

      const tokenHash =
        await sha256Hex(
          token
        );

      await env.DB
        .prepare(`
          INSERT INTO visitors (
            visitor_token
          )

          VALUES (?)
        `)
        .bind(tokenHash)
        .run();


      return new Response(
        JSON.stringify({
          ok: true,
          existing: false,
          hasVoted: false
        }),
        {
          status: 200,

          headers: {
            "Content-Type":
              "application/json; charset=UTF-8",

            "Set-Cookie":
              visitorCookieHeader(
                token
              )
          }
        }
      );
    }


    // ==================================================
    // PUBLIC GAMES
    // ==================================================

    if (
      path ===
        "/api/public/games" &&
      request.method === "GET"
    ) {
      const settingsResult =
        await env.DB
          .prepare(`
            SELECT key, value, updated_at

            FROM settings

            WHERE key IN (
              'plaza_open',
              'voting_open'
            )
          `)
          .all();


      const settings = {};

      for (
        const row of
        settingsResult.results || []
      ) {
        settings[row.key] =
          row.value;
      }


      const plazaOpen =
        settings.plaza_open ===
        "true";

      const votingOpen =
        settings.voting_open ===
        "true";




      let games = [];


      if (plazaOpen) {
        const result =
          await env.DB
            .prepare(`
              SELECT
                t.id AS team_id,
                t.team_number,
                t.team_name,

                s.title,
                s.description,
                s.game_url,
                s.thumbnail_url

              FROM submissions s

              JOIN teams t
                ON t.id = s.team_id

              WHERE
                s.status = 'published'
                AND t.is_active = 1

              ORDER BY
                t.team_number ASC
            `)
            .all();


        games =
          (result.results || [])
            .map(row => ({
              teamId:
                row.team_id,

              teamNumber:
                row.team_number,

              teamName:
                row.team_name,

              title:
                row.title,

              description:
                row.description || "",

              gameUrl:
                row.game_url || "",

              thumbnailUrl:
                row.thumbnail_url || ""
            }));
      }


      const openedAt = (settingsResult.results || [])
        .find(row => row.key === "plaza_open")?.updated_at;
      const rotated = await rotatePublicGames(games, Date.now(), openedAt);

      return Response.json({
        ok: true,

        plazaOpen,
        votingOpen,

        games: rotated.games,
        rotation: rotated.rotation
      }, {
        headers: { "Cache-Control": "no-store" }
      });
    }


    // ==================================================
    // VOTE
    // ==================================================

    if (
      path === "/api/votes" &&
      request.method === "POST"
    ) {
      // ----------------------------------------------
      // Visitor cookie
      // ----------------------------------------------

      const visitorToken =
        readCookie(
          request,
          VISITOR_COOKIE
        );


      if (!visitorToken) {
        return Response.json(
          {
            message:
              "방문객 세션이 없습니다. 페이지를 새로고침해 주세요."
          },
          {
            status: 401
          }
        );
      }


      const visitorHash =
        await sha256Hex(
          visitorToken
        );


      const visitor =
        await env.DB
          .prepare(`
            SELECT id

            FROM visitors

            WHERE visitor_token = ?

            LIMIT 1
          `)
          .bind(visitorHash)
          .first();


      if (!visitor) {
        return Response.json(
          {
            message:
              "방문객 세션이 올바르지 않습니다."
          },
          {
            status: 401
          }
        );
      }


      // ----------------------------------------------
      // 빠른 중복 확인
      // ----------------------------------------------

      const previousVote =
        await env.DB
          .prepare(`
            SELECT id

            FROM votes

            WHERE visitor_id = ?

            LIMIT 1
          `)
          .bind(visitor.id)
          .first();


      if (previousVote) {
        return Response.json(
          {
            message:
              "이미 투표하셨습니다."
          },
          {
            status: 409
          }
        );
      }


      // ----------------------------------------------
      // Rate limit
      // 최종 중복 판정용이 아니라 공격 완화용
      // ----------------------------------------------

      if (env.VOTE_RATE_LIMITER) {
        const {
          success
        } =
          await env
            .VOTE_RATE_LIMITER
            .limit({
              key:
                `vote:${visitorHash}`
            });


        if (!success) {
          return Response.json(
            {
              message:
                "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요."
            },
            {
              status: 429
            }
          );
        }
      }


      // ----------------------------------------------
      // Body
      // ----------------------------------------------

      let body;

      try {
        body =
          await request.json();
      } catch {
        return Response.json(
          {
            message:
              "잘못된 요청입니다."
          },
          {
            status: 400
          }
        );
      }


      const teamId =
        Number(
          body.teamId
        );


      if (
        !Number.isInteger(
          teamId
        ) ||
        teamId < 1
      ) {
        return Response.json(
          {
            message:
              "올바르지 않은 팀입니다."
          },
          {
            status: 400
          }
        );
      }


      // ----------------------------------------------
      // Voting open?
      // ----------------------------------------------

      const voteSettingsResult =
        await env.DB
          .prepare(`
            SELECT key, value

            FROM settings

            WHERE key IN (
              'voting_open',
              'plaza_open'
            )
          `)
          .all();

      const voteSettings = {};

      for (
        const row of
        voteSettingsResult.results || []
      ) {
        voteSettings[row.key] =
          row.value;
      }

      if (
        voteSettings.plaza_open !== "true" ||
        voteSettings.voting_open !== "true"
      ) {
        return Response.json(
          {
            message:
              "현재 투표가 진행 중이 아닙니다."
          },
          {
            status: 403
          }
        );
      }


      // ----------------------------------------------
      // 실제 공개 작품인지 확인
      // ----------------------------------------------

      const team =
        await env.DB
          .prepare(`
            SELECT t.id

            FROM teams t

            JOIN submissions s
              ON s.team_id = t.id

            WHERE
              t.id = ?
              AND t.is_active = 1
              AND s.status = 'published'

            LIMIT 1
          `)
          .bind(teamId)
          .first();


      if (!team) {
        return Response.json(
          {
            message:
              "현재 투표할 수 없는 작품입니다."
          },
          {
            status: 404
          }
        );
      }


      // ----------------------------------------------
      // 최종 투표
      //
      // votes.visitor_id UNIQUE가 최종 판정한다.
      // 동시 요청이 들어와도 한 표만 저장.
      // ----------------------------------------------

      const result =
        await env.DB
          .prepare(`
            INSERT OR IGNORE
            INTO votes (
              visitor_id,
              team_id
            )

            VALUES (?, ?)
          `)
          .bind(
            visitor.id,
            teamId
          )
          .run();


      if (
        Number(
          result.meta?.changes || 0
        ) !== 1
      ) {
        return Response.json(
          {
            message:
              "이미 투표하셨습니다."
          },
          {
            status: 409
          }
        );
      }


      return Response.json({
        ok: true,
        message:
          "투표가 완료되었습니다."
      });
    }


    // ==================================================
    // TEAM API AUTH
    // ==================================================

    if (
      path.startsWith(
        "/api/team/"
      )
    ) {
      const team =
        await requireTeam(
          request,
          env
        );

      if (!team) {
        return Response.json(
          {
            message:
              "팀 로그인이 필요합니다."
          },
          {
            status: 401
          }
        );
      }


      // ================================================
      // TEAM THUMBNAIL UPLOAD
      // ================================================

      if (path === "/api/team/thumbnail" && request.method === "POST") {
        const submissionSetting = await env.DB
          .prepare(`
            SELECT value FROM settings
            WHERE key = 'submission_open'
            LIMIT 1
          `)
          .first();

        if (submissionSetting?.value !== "true") {
          return Response.json(
            { message: "현재 작품 제출이 닫혀 있습니다." },
            { status: 403 }
          );
        }

        const submission = await env.DB
          .prepare(`
            SELECT status, thumbnail_url
            FROM submissions
            WHERE team_id = ?
            LIMIT 1
          `)
          .bind(team.id)
          .first();

        if (submission?.status === "published") {
          return Response.json(
            { message: "공개된 작품의 대표 이미지는 수정할 수 없습니다." },
            { status: 409 }
          );
        }

        const priorVote = await env.DB
          .prepare("SELECT id FROM votes WHERE team_id = ? LIMIT 1")
          .bind(team.id)
          .first();
        if (priorVote) {
          return Response.json(
            { message: "이미 투표된 작품은 수정할 수 없습니다. 운영진에게 문의해 주세요." },
            { status: 409 }
          );
        }

        if (!request.headers.get("Content-Type")?.startsWith("multipart/form-data;")) {
          return Response.json(
            { message: "이미지 파일을 선택해 주세요." },
            { status: 400 }
          );
        }

        let image;
        try {
          image = (await request.formData()).get("image");
        } catch {
          return Response.json(
            { message: "이미지 파일을 읽을 수 없습니다." },
            { status: 400 }
          );
        }

        const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
        if (!image || typeof image.arrayBuffer !== "function" ||
            !allowedTypes.includes(image.type)) {
          return Response.json(
            { message: "JPG, PNG, WebP 이미지만 올릴 수 있습니다." },
            { status: 400 }
          );
        }

        if (image.size < 1 || image.size > THUMBNAIL_MAX_BYTES) {
          return Response.json(
            { message: "대표 이미지는 1MiB 이하로 올려 주세요." },
            { status: 413 }
          );
        }

        const imageData = new Uint8Array(await image.arrayBuffer());
        if (!hasImageSignature(imageData, image.type)) {
          return Response.json(
            { message: "이미지 파일 형식이 올바르지 않습니다." },
            { status: 400 }
          );
        }

        const imageId = crypto.randomUUID();
        await env.DB
          .prepare(`
            INSERT INTO thumbnail_images (id, team_id, content_type, image_data)
            VALUES (?, ?, ?, ?)
          `)
          .bind(imageId, team.id, image.type, imageData)
          .run();

        // 저장된 이미지와 방금 올린 이미지만 남겨 반복 업로드로 인한 저장 공간 증가를 막습니다.
        const savedImageId = String(submission?.thumbnail_url || "")
          .match(/\/api\/public\/thumbnails\/([0-9a-f-]{36})$/)?.[1];
        await env.DB
          .prepare(`
            DELETE FROM thumbnail_images
            WHERE team_id = ? AND id != ? AND id != ?
          `)
          .bind(team.id, imageId, savedImageId || imageId)
          .run();

        return Response.json({
          ok: true,
          thumbnailUrl: `${THUMBNAIL_PATH}${imageId}`
        });
      }


      // ================================================
      // TEAM ME
      // ================================================

      if (
        path ===
          "/api/team/me" &&
        request.method === "GET"
      ) {
        return Response.json({
          ok: true,

          team: {
            id:
              team.id,

            teamNumber:
              team.team_number,

            teamName:
              team.team_name
          }
        });
      }


      // ================================================
      // TEAM SUBMISSION GET
      // ================================================

      if (
        path ===
          "/api/team/submission" &&
        request.method === "GET"
      ) {
        const submission =
          await env.DB
            .prepare(`
              SELECT
                id,
                title,
                description,
                game_url,
                thumbnail_url,
                status,
                submitted_at,
                updated_at

              FROM submissions

              WHERE team_id = ?

              LIMIT 1
            `)
            .bind(team.id)
            .first();

        return Response.json({
          ok: true,

          submission:
            submission
              ? {
                  id:
                    submission.id,

                  title:
                    submission.title || "",

                  description:
                    submission.description || "",

                  gameUrl:
                    submission.game_url || "",

                  thumbnailUrl:
                    submission.thumbnail_url || "",

                  status:
                    submission.status,

                  submittedAt:
                    submission.submitted_at,

                  updatedAt:
                    submission.updated_at
                }
              : null
        });
      }


      // ================================================
      // TEAM SUBMISSION DELETE
      // ================================================

      if (path === "/api/team/submission" && request.method === "DELETE") {
        const submissionSetting = await env.DB
          .prepare(`
            SELECT value FROM settings
            WHERE key = 'submission_open'
            LIMIT 1
          `)
          .first();

        if (submissionSetting?.value !== "true") {
          return Response.json(
            { message: "현재 작품 제출이 닫혀 있습니다." },
            { status: 403 }
          );
        }

        const submission = await env.DB
          .prepare(`
            SELECT id, status FROM submissions
            WHERE team_id = ? LIMIT 1
          `)
          .bind(team.id)
          .first();

        if (!submission) {
          return Response.json(
            { message: "삭제할 작품이 없습니다." },
            { status: 404 }
          );
        }

        if (submission.status === "published") {
          return Response.json(
            { message: "광장에 공개된 작품은 운영진에게 공개 취소를 요청해 주세요." },
            { status: 409 }
          );
        }

        // 투표는 작품 ID가 아닌 팀 ID에 연결되어 있어 재등록 시 표가 옮겨가지 않게 막습니다.
        const [deleted] = await env.DB.batch([
          env.DB
            .prepare(`
              DELETE FROM submissions
              WHERE team_id = ?
                AND status != 'published'
                AND NOT EXISTS (
                  SELECT 1 FROM votes WHERE team_id = ?
                )
            `)
            .bind(team.id, team.id),
          env.DB
            .prepare(`
              DELETE FROM thumbnail_images
              WHERE team_id = ?
                AND NOT EXISTS (
                  SELECT 1 FROM submissions WHERE team_id = ?
                )
            `)
            .bind(team.id, team.id)
        ]);

        if (Number(deleted.meta?.changes || 0) !== 1) {
          return Response.json(
            { message: "투표 기록이 있거나 작품 상태가 변경되어 삭제할 수 없습니다. 운영진에게 문의해 주세요." },
            { status: 409 }
          );
        }

        return Response.json({ ok: true });
      }


      // ================================================
      // TEAM SUBMISSION SAVE / SUBMIT
      // ================================================

      if (
        path ===
          "/api/team/submission" &&
        request.method === "PUT"
      ) {
        const submissionSetting =
          await env.DB
            .prepare(`
              SELECT value

              FROM settings

              WHERE key =
                'submission_open'

              LIMIT 1
            `)
            .first();

        if (
          submissionSetting?.value !==
          "true"
        ) {
          return Response.json(
            {
              message:
                "현재 작품 제출이 닫혀 있습니다."
            },
            {
              status: 403
            }
          );
        }

        let body;

        try {
          body =
            await request.json();
        } catch {
          return Response.json(
            {
              message:
                "잘못된 요청입니다."
            },
            {
              status: 400
            }
          );
        }

        const title =
          String(
            body.title || ""
          ).trim();

        const description =
          String(
            body.description || ""
          ).trim();

        const gameUrl =
          String(
            body.gameUrl || ""
          ).trim();

        const thumbnailUrl =
          String(
            body.thumbnailUrl || ""
          ).trim();

        const submit =
          body.submit === true;

        if (
          title.length > 40
        ) {
          return Response.json(
            {
              message:
                "게임 제목은 40자 이하로 입력해 주세요."
            },
            {
              status: 400
            }
          );
        }

        if (
          description.length > 200
        ) {
          return Response.json(
            {
              message:
                "게임 소개는 200자 이하로 입력해 주세요."
            },
            {
              status: 400
            }
          );
        }

        if (
          submit &&
          !title
        ) {
          return Response.json(
            {
              message:
                "최종 제출하려면 게임 제목을 입력해 주세요."
            },
            {
              status: 400
            }
          );
        }

        function isSafeHttpUrl(value) {
          if (!value) {
            return true;
          }

          try {
            const parsed =
              new URL(value);

            return (
              parsed.protocol ===
                "https:" ||
              parsed.protocol ===
                "http:"
            );
          } catch {
            return false;
          }
        }

        if (
          !isSafeHttpUrl(
            gameUrl
          )
        ) {
          return Response.json(
            {
              message:
                "게임 주소는 http 또는 https 주소여야 합니다."
            },
            {
              status: 400
            }
          );
        }

        if (thumbnailUrl.startsWith("/")) {
          const imageId = thumbnailUrl.startsWith(THUMBNAIL_PATH)
            ? thumbnailUrl.slice(THUMBNAIL_PATH.length)
            : "";

          if (!THUMBNAIL_ID_PATTERN.test(imageId)) {
            return Response.json(
              { message: "대표 이미지 주소가 올바르지 않습니다." },
              { status: 400 }
            );
          }

          const imageOwner = await env.DB
            .prepare(`
              SELECT team_id FROM thumbnail_images
              WHERE id = ? LIMIT 1
            `)
            .bind(imageId)
            .first();

          if (Number(imageOwner?.team_id) !== Number(team.id)) {
            return Response.json(
              { message: "이 팀의 대표 이미지를 선택해 주세요." },
              { status: 400 }
            );
          }
        } else if (!isSafeHttpUrl(thumbnailUrl)) {
          return Response.json(
            { message: "대표 이미지 주소가 올바르지 않습니다." },
            { status: 400 }
          );
        }

        const existing =
          await env.DB
            .prepare(`
              SELECT
                id,
                status

              FROM submissions

              WHERE team_id = ?

              LIMIT 1
            `)
            .bind(team.id)
            .first();

        if (
          existing?.status ===
          "published"
        ) {
          return Response.json(
            {
              message:
                "이미 광장에 공개된 작품입니다. 수정이 필요하면 운영진에게 문의해 주세요."
            },
            {
              status: 409
            }
          );
        }

        const priorVote = await env.DB
          .prepare("SELECT id FROM votes WHERE team_id = ? LIMIT 1")
          .bind(team.id)
          .first();
        if (priorVote) {
          return Response.json(
            { message: "이미 투표된 작품은 수정할 수 없습니다. 운영진에게 문의해 주세요." },
            { status: 409 }
          );
        }

        const nextStatus =
          submit
            ? "submitted"
            : "draft";

        const savedResult = await env.DB
          .prepare(`
            INSERT INTO submissions (
              team_id,
              title,
              description,
              game_url,
              thumbnail_url,
              status,
              submitted_at,
              updated_at
            )

            VALUES (
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              CASE
                WHEN ? = 'submitted'
                THEN CURRENT_TIMESTAMP
                ELSE NULL
              END,
              CURRENT_TIMESTAMP
            )

            ON CONFLICT(team_id)
            DO UPDATE SET
              title =
                excluded.title,

              description =
                excluded.description,

              game_url =
                excluded.game_url,

              thumbnail_url =
                excluded.thumbnail_url,

              status =
                excluded.status,

              submitted_at =
                CASE
                  WHEN excluded.status = 'submitted'
                  THEN CURRENT_TIMESTAMP
                  ELSE NULL
                END,

              updated_at =
                CURRENT_TIMESTAMP

            WHERE submissions.status != 'published'
              AND NOT EXISTS (
                SELECT 1 FROM votes WHERE votes.team_id = excluded.team_id
              )
          `)
          .bind(
            team.id,
            title,
            description,
            gameUrl || null,
            thumbnailUrl || null,
            nextStatus,
            nextStatus
          )
          .run();

        if (Number(savedResult.meta?.changes || 0) !== 1) {
          return Response.json(
            { message: "작품 상태가 변경되어 저장할 수 없습니다. 새로고침 후 다시 확인해 주세요." },
            { status: 409 }
          );
        }

        const saved =
          await env.DB
            .prepare(`
              SELECT
                id,
                title,
                description,
                game_url,
                thumbnail_url,
                status,
                submitted_at,
                updated_at

              FROM submissions

              WHERE team_id = ?

              LIMIT 1
            `)
            .bind(team.id)
            .first();

        return Response.json({
          ok: true,

          submission: {
            id:
              saved.id,

            title:
              saved.title || "",

            description:
              saved.description || "",

            gameUrl:
              saved.game_url || "",

            thumbnailUrl:
              saved.thumbnail_url || "",

            status:
              saved.status,

            submittedAt:
              saved.submitted_at,

            updatedAt:
              saved.updated_at
          }
        });
      }


      return Response.json(
        {
          message:
            "Team API route not found"
        },
        {
          status: 404
        }
      );
    }


    // ==================================================
    // ADMIN API AUTH
    // ==================================================

    if (
      path.startsWith(
        "/api/admin/"
      )
    ) {
      const admin =
        await requireAdmin(
          request,
          env
        );


      if (!admin) {
        return Response.json(
          {
            message:
              "관리자 로그인이 필요합니다."
          },
          {
            status: 401
          }
        );
      }


      // ================================================
      // ADMIN ME
      // ================================================

      if (
        path ===
          "/api/admin/me" &&
        request.method === "GET"
      ) {
        return Response.json({
          ok: true,

          admin: {
            id:
              admin.id,

            username:
              admin.username,

            displayName:
              admin.display_name ||
              admin.username,

            role:
              admin.role
          }
        });
      }


      // ================================================
      // OVERVIEW
      // ================================================

      if (
        path ===
          "/api/admin/overview" &&
        request.method === "GET"
      ) {
        const stats =
          await env.DB
            .prepare(`
              SELECT

                (
                  SELECT COUNT(*)
                  FROM visitors
                ) AS visitors,

                (
                  SELECT COUNT(*)
                  FROM votes
                ) AS votes,

                (
                  SELECT COUNT(*)
                  FROM submissions
                  WHERE status IN (
                    'submitted',
                    'published'
                  )
                ) AS submitted,

                (
                  SELECT COUNT(*)
                  FROM submissions
                  WHERE status =
                    'published'
                ) AS published
            `)
            .first();


        const settingsResult =
          await env.DB
            .prepare(`
              SELECT
                key,
                value

              FROM settings
            `)
            .all();


        const settings = {};

        for (
          const row of
          settingsResult.results || []
        ) {
          settings[row.key] =
            row.value;
        }


        return Response.json({
          ok: true,

          visitors:
            Number(
              stats?.visitors || 0
            ),

          votes:
            Number(
              stats?.votes || 0
            ),

          submitted:
            Number(
              stats?.submitted || 0
            ),

          published:
            Number(
              stats?.published || 0
            ),

          settings: {
            votingOpen:
              settings.voting_open ===
              "true",

            plazaOpen:
              settings.plaza_open ===
              "true",

            submissionOpen:
              settings.submission_open ===
              "true",

            resultsPublic:
              settings.results_public ===
              "true"
          }
        });
      }


      // ================================================
      // EVENT DATA RESET
      // 투표가 중단된 상태에서 운영 기록을 안전하게 초기화한다.
      // 팀, 작품, 관리자 계정과 관리자 로그는 유지한다.
      // ================================================

      if (
        path === "/api/admin/reset" &&
        request.method === "POST"
      ) {
        let body;

        try {
          body = await request.json();
        } catch {
          return Response.json(
            { message: "잘못된 요청입니다." },
            { status: 400 }
          );
        }

        const scope = String(body.scope || "").trim();

        if (scope !== "votes" && scope !== "visitor_votes") {
          return Response.json(
            { message: "초기화 범위가 올바르지 않습니다." },
            { status: 400 }
          );
        }

        const votingSetting = await env.DB
          .prepare(`
            SELECT value
            FROM settings
            WHERE key = 'voting_open'
            LIMIT 1
          `)
          .first();

        if (votingSetting?.value === "true") {
          return Response.json(
            { message: "투표를 먼저 중단한 뒤 초기화해 주세요." },
            { status: 409 }
          );
        }

        const counts = await env.DB
          .prepare(`
            SELECT
              (SELECT COUNT(*) FROM votes) AS votes,
              (SELECT COUNT(*) FROM visitors) AS visitors
          `)
          .first();

        let deletedVotes = 0;
        let deletedVisitors = 0;

        if (scope === "votes") {
          const result = await env.DB
            .prepare("DELETE FROM votes")
            .run();
          deletedVotes = Number(result.meta?.changes || counts?.votes || 0);
        } else {
          const results = await env.DB.batch([
            env.DB.prepare("DELETE FROM votes"),
            env.DB.prepare("DELETE FROM visitors")
          ]);
          deletedVotes = Number(results[0]?.meta?.changes || counts?.votes || 0);
          deletedVisitors = Number(results[1]?.meta?.changes || counts?.visitors || 0);
        }

        const action = scope === "votes"
          ? "event_votes_reset"
          : "event_visitor_votes_reset";
        const details = scope === "votes"
          ? `투표 기록 초기화 (투표 ${deletedVotes}표, 방문객 기록 유지)`
          : `방문객·투표 기록 초기화 (방문객 ${deletedVisitors}명, 투표 ${deletedVotes}표)`;

        await writeAdminLog(
          env,
          admin.id,
          action,
          details
        );

        return Response.json({
          ok: true,
          scope,
          deleted: {
            votes: deletedVotes,
            visitors: deletedVisitors
          }
        });
      }


      // ================================================
      // TEAMS LIST
      // ================================================

      if (
        path ===
          "/api/admin/teams" &&
        request.method === "GET"
      ) {
        const result =
          await env.DB
            .prepare(`
              SELECT
                t.id,
                t.team_number,
                t.team_name,
                t.is_active,
                t.created_at,

                s.id AS submission_id,
                s.title,
                s.status AS submission_status

              FROM teams t

              LEFT JOIN submissions s
                ON s.team_id = t.id

              ORDER BY
                t.team_number ASC
            `)
            .all();


        return Response.json({
          ok: true,
          teams:
            result.results || []
        });
      }


      // ================================================
      // CREATE TEAM
      // ================================================

      if (
        path ===
          "/api/admin/teams" &&
        request.method === "POST"
      ) {
        let body;

        try {
          body =
            await request.json();
        } catch {
          return Response.json(
            {
              message:
                "잘못된 요청입니다."
            },
            {
              status: 400
            }
          );
        }


        const teamNumber =
          Number(
            body.teamNumber
          );

        const teamName =
          String(
            body.teamName || ""
          ).trim();


        if (
          !Number.isInteger(
            teamNumber
          ) ||
          teamNumber < 1 ||
          teamNumber > 15
        ) {
          return Response.json(
            {
              message:
                "팀 번호는 1~15 사이여야 합니다."
            },
            {
              status: 400
            }
          );
        }


        if (!teamName) {
          return Response.json(
            {
              message:
                "팀 이름을 입력하세요."
            },
            {
              status: 400
            }
          );
        }


        const existing =
          await env.DB
            .prepare(`
              SELECT id

              FROM teams

              WHERE team_number = ?

              LIMIT 1
            `)
            .bind(teamNumber)
            .first();


        if (existing) {
          return Response.json(
            {
              message:
                "이미 존재하는 팀 번호입니다."
            },
            {
              status: 409
            }
          );
        }


        const accessCode =
          createAccessCode();


        const accessCodeHash =
          await hashPassword(
            accessCode
          );


        await env.DB
          .prepare(`
            INSERT INTO teams (
              team_number,
              team_name,
              access_code_hash,
              is_active
            )

            VALUES (?, ?, ?, 1)
          `)
          .bind(
            teamNumber,
            teamName,
            accessCodeHash
          )
          .run();

        const team =
          await env.DB
            .prepare(`
              SELECT id, team_number, team_name
              FROM teams
              WHERE team_number = ?
              LIMIT 1
            `)
            .bind(teamNumber)
            .first();


        await writeAdminLog(
          env,
          admin.id,
          "team_create",
          `${teamNumber}팀 생성`
        );


        return Response.json({
          ok: true,

          team,

          // 생성 직후 한 번만 보여줄 평문 접속 코드
          accessCode
        });
      }


      // ================================================
      // DELETE TEAM
      // 팀에 연결된 작품, 대표 이미지, 해당 팀의 투표를 함께 제거한다.
      // 방문객 세션은 다른 팀의 투표와도 연결될 수 있으므로 유지한다.
      // ================================================

      const teamDeleteMatch =
        path.match(
          /^\/api\/admin\/teams\/(\d+)$/
        );

      if (
        teamDeleteMatch &&
        request.method === "DELETE"
      ) {
        const teamId =
          Number(
            teamDeleteMatch[1]
          );

        if (
          !Number.isInteger(teamId) ||
          teamId < 1
        ) {
          return Response.json(
            {
              message:
                "올바르지 않은 팀입니다."
            },
            {
              status: 400
            }
          );
        }

        const team =
          await env.DB
            .prepare(`
              SELECT
                id,
                team_number,
                team_name

              FROM teams

              WHERE id = ?

              LIMIT 1
            `)
            .bind(teamId)
            .first();

        if (!team) {
          return Response.json(
            {
              message:
                "삭제할 팀을 찾을 수 없습니다."
            },
            {
              status: 404
            }
          );
        }

        const related =
          await env.DB
            .prepare(`
              SELECT
                (
                  SELECT COUNT(*)
                  FROM submissions
                  WHERE team_id = ?
                ) AS submissions,

                (
                  SELECT COUNT(*)
                  FROM thumbnail_images
                  WHERE team_id = ?
                ) AS thumbnails,

                (
                  SELECT COUNT(*)
                  FROM votes
                  WHERE team_id = ?
                ) AS votes
            `)
            .bind(
              teamId,
              teamId,
              teamId
            )
            .first();

        const [
          deletedVotes,
          deletedThumbnails,
          deletedSubmissions,
          deletedTeam
        ] = await env.DB.batch([
          env.DB
            .prepare(`
              DELETE FROM votes
              WHERE team_id = ?
            `)
            .bind(teamId),
          env.DB
            .prepare(`
              DELETE FROM thumbnail_images
              WHERE team_id = ?
            `)
            .bind(teamId),
          env.DB
            .prepare(`
              DELETE FROM submissions
              WHERE team_id = ?
            `)
            .bind(teamId),
          env.DB
            .prepare(`
              DELETE FROM teams
              WHERE id = ?
            `)
            .bind(teamId)
        ]);

        if (
          Number(
            deletedTeam.meta?.changes || 0
          ) !== 1
        ) {
          return Response.json(
            {
              message:
                "팀 정보가 변경되어 삭제하지 못했습니다. 목록을 새로고침해 주세요."
            },
            {
              status: 409
            }
          );
        }

        await writeAdminLog(
          env,
          admin.id,
          "team_delete",
          `${team.team_number}팀 ${team.team_name} 삭제 (작품 ${Number(related?.submissions || deletedSubmissions.meta?.changes || 0)}개, 대표 이미지 ${Number(related?.thumbnails || deletedThumbnails.meta?.changes || 0)}개, 투표 ${Number(related?.votes || deletedVotes.meta?.changes || 0)}표)`
        );

        return Response.json({
          ok: true,
          deleted: {
            teamId,
            teamNumber:
              team.team_number,
            teamName:
              team.team_name,
            submissions:
              Number(
                related?.submissions ||
                deletedSubmissions.meta?.changes ||
                0
              ),
            thumbnails:
              Number(
                related?.thumbnails ||
                deletedThumbnails.meta?.changes ||
                0
              ),
            votes:
              Number(
                related?.votes ||
                deletedVotes.meta?.changes ||
                0
              )
          }
        });
      }


      // ================================================
      // VOTING ON / OFF
      // ================================================

      if (
        path ===
          "/api/admin/voting" &&
        request.method === "PUT"
      ) {
        let body;

        try {
          body =
            await request.json();
        } catch {
          return Response.json(
            {
              message:
                "잘못된 요청입니다."
            },
            {
              status: 400
            }
          );
        }


        if (
          typeof body.open !==
          "boolean"
        ) {
          return Response.json(
            {
              message:
                "open 값은 boolean이어야 합니다."
            },
            {
              status: 400
            }
          );
        }


        if (body.open) {
          const plazaSetting =
            await env.DB
              .prepare(`
                SELECT value

                FROM settings

                WHERE key =
                  'plaza_open'

                LIMIT 1
              `)
              .first();

          if (
            plazaSetting?.value !==
            "true"
          ) {
            return Response.json(
              {
                message:
                  "게임 광장을 먼저 공개해 주세요."
              },
              {
                status: 409
              }
            );
          }
        }

        await env.DB
          .prepare(`
            UPDATE settings

            SET
              value = ?,
              updated_at =
                CURRENT_TIMESTAMP

            WHERE key =
              'voting_open'
          `)
          .bind(
            body.open
              ? "true"
              : "false"
          )
          .run();


        await writeAdminLog(
          env,
          admin.id,

          body.open
            ? "voting_open"
            : "voting_close",

          body.open
            ? "투표 시작"
            : "투표 중단"
        );


        return Response.json({
          ok: true,
          votingOpen:
            body.open
        });
      }


      // ================================================
      // PLAZA ON / OFF
      // ================================================

      if (
        path ===
          "/api/admin/plaza" &&
        request.method === "PUT"
      ) {
        let body;

        try {
          body =
            await request.json();
        } catch {
          return Response.json(
            {
              message:
                "잘못된 요청입니다."
            },
            {
              status: 400
            }
          );
        }

        if (
          typeof body.open !==
          "boolean"
        ) {
          return Response.json(
            {
              message:
                "open 값은 boolean이어야 합니다."
            },
            {
              status: 400
            }
          );
        }

        await env.DB
          .prepare(`
            UPDATE settings

            SET
              value = ?,
              updated_at =
                CURRENT_TIMESTAMP

            WHERE key =
              'plaza_open'
          `)
          .bind(
            body.open
              ? "true"
              : "false"
          )
          .run();

        // 광장을 닫으면 투표도 함께 중단한다.
        if (!body.open) {
          await env.DB
            .prepare(`
              UPDATE settings

              SET
                value = 'false',
                updated_at =
                  CURRENT_TIMESTAMP

              WHERE key =
                'voting_open'
            `)
            .run();
        }

        await writeAdminLog(
          env,
          admin.id,
          body.open
            ? "plaza_open"
            : "plaza_close",
          body.open
            ? "게임 광장 공개"
            : "게임 광장 닫기"
        );

        return Response.json({
          ok: true,
          plazaOpen:
            body.open,
          votingOpen:
            body.open
              ? undefined
              : false
        });
      }


      // ================================================
      // SUBMISSION WINDOW ON / OFF
      // ================================================

      if (
        path ===
          "/api/admin/submission-window" &&
        request.method === "PUT"
      ) {
        let body;

        try {
          body =
            await request.json();
        } catch {
          return Response.json(
            {
              message:
                "잘못된 요청입니다."
            },
            {
              status: 400
            }
          );
        }

        if (
          typeof body.open !==
          "boolean"
        ) {
          return Response.json(
            {
              message:
                "open 값은 boolean이어야 합니다."
            },
            {
              status: 400
            }
          );
        }

        await env.DB
          .prepare(`
            UPDATE settings

            SET
              value = ?,
              updated_at =
                CURRENT_TIMESTAMP

            WHERE key =
              'submission_open'
          `)
          .bind(
            body.open
              ? "true"
              : "false"
          )
          .run();

        await writeAdminLog(
          env,
          admin.id,
          body.open
            ? "submission_open"
            : "submission_close",
          body.open
            ? "작품 제출 접수 시작"
            : "작품 제출 접수 종료"
        );

        return Response.json({
          ok: true,
          submissionOpen:
            body.open
        });
      }


      // ================================================
      // SUBMISSION PUBLISH / UNPUBLISH
      // ================================================

      const submissionStatusMatch =
        path.match(
          /^\/api\/admin\/submissions\/(\d+)\/status$/
        );

      if (
        submissionStatusMatch &&
        request.method === "PUT"
      ) {
        const submissionId =
          Number(
            submissionStatusMatch[1]
          );

        let body;

        try {
          body =
            await request.json();
        } catch {
          return Response.json(
            {
              message:
                "잘못된 요청입니다."
            },
            {
              status: 400
            }
          );
        }

        const status =
          String(
            body.status || ""
          );

        if (
          status !== "published" &&
          status !== "submitted"
        ) {
          return Response.json(
            {
              message:
                "허용되지 않은 작품 상태입니다."
            },
            {
              status: 400
            }
          );
        }

        const submission =
          await env.DB
            .prepare(`
              SELECT
                s.id,
                s.status,
                s.title,
                t.team_number,
                t.team_name

              FROM submissions s

              JOIN teams t
                ON t.id = s.team_id

              WHERE s.id = ?

              LIMIT 1
            `)
            .bind(submissionId)
            .first();

        if (!submission) {
          return Response.json(
            {
              message:
                "작품을 찾을 수 없습니다."
            },
            {
              status: 404
            }
          );
        }

        if (
          status === "published" &&
          submission.status !== "submitted" &&
          submission.status !== "published"
        ) {
          return Response.json(
            {
              message:
                "최종 제출된 작품만 공개할 수 있습니다."
            },
            {
              status: 409
            }
          );
        }

        const updateResult = await env.DB
          .prepare(`
            UPDATE submissions

            SET
              status = ?,
              updated_at =
                CURRENT_TIMESTAMP

            WHERE id = ?
          `)
          .bind(
            status,
            submissionId
          )
          .run();

        if (Number(updateResult.meta?.changes || 0) !== 1) {
          return Response.json(
            { message: "작품 상태가 변경되었습니다. 목록을 새로고침해 주세요." },
            { status: 409 }
          );
        }

        await writeAdminLog(
          env,
          admin.id,
          status === "published"
            ? "submission_publish"
            : "submission_unpublish",
          `${submission.team_number}팀 ${submission.title || "작품"}`
        );

        return Response.json({
          ok: true,
          submissionId,
          status
        });
      }


      // ================================================
      // SUBMISSIONS
      // ================================================

      if (
        path ===
          "/api/admin/submissions" &&
        request.method === "GET"
      ) {
        const result =
          await env.DB
            .prepare(`
              SELECT
                s.id,
                s.team_id,

                t.team_number,
                t.team_name,

                s.title,
                s.description,
                s.game_url,
                s.thumbnail_url,
                s.status,
                s.submitted_at,
                s.updated_at

              FROM submissions s

              JOIN teams t
                ON t.id = s.team_id

              ORDER BY
                t.team_number ASC
            `)
            .all();


        return Response.json({
          ok: true,

          submissions:
            result.results || []
        });
      }


      // ================================================
      // VOTE COUNTS
      // ================================================

      if (
        path ===
          "/api/admin/votes" &&
        request.method === "GET"
      ) {
        const result =
          await env.DB
            .prepare(`
              SELECT
                t.id AS team_id,
                t.team_number,
                t.team_name,

                (
                  SELECT s.title
                  FROM submissions s
                  WHERE s.team_id = t.id
                  LIMIT 1
                ) AS game_title,

                COUNT(v.id) AS vote_count

              FROM teams t

              LEFT JOIN votes v
                ON v.team_id = t.id

              GROUP BY
                t.id,
                t.team_number,
                t.team_name

              ORDER BY
                t.team_number ASC
            `)
            .all();


        return Response.json({
          ok: true,

          votes:
            result.results || []
        }, {
          headers: { "Cache-Control": "no-store" }
        });
      }


      // ================================================
      // ADMIN LOGS
      // ================================================

      if (
        path ===
          "/api/admin/logs" &&
        request.method === "GET"
      ) {
        const result =
          await env.DB
            .prepare(`
              SELECT
                l.id,
                l.action,
                l.details,
                l.created_at,

                a.username,
                a.display_name

              FROM admin_logs l

              LEFT JOIN admins a
                ON a.id = l.admin_id

              ORDER BY
                l.id DESC

              LIMIT 200
            `)
            .all();


        return Response.json({
          ok: true,

          logs:
            result.results || []
        });
      }


      return Response.json(
        {
          message:
            "Admin API route not found"
        },
        {
          status: 404
        }
      );
    }


    // ==================================================
    // UNKNOWN API
    // ==================================================

    return Response.json(
      {
        message:
          "API route not found"
      },
      {
        status: 404
      }
    );
  }
};

