(function () {
  const base = window.location.origin;

  const ADMIN_TOKEN_KEY =
    "hackathon_admin_token";

  const TEAM_TOKEN_KEY =
    "hackathon_team_token";


  // ==================================================
  // COMMON REQUEST
  // ==================================================

  async function request(
    path,
    options = {}
  ) {
    const {
      auth,
      ...fetchOptions
    } = options;


    const headers = {
      Accept: "application/json",
      ...(fetchOptions.headers || {})
    };


    if (
      fetchOptions.body !== undefined &&
      !(fetchOptions.body instanceof FormData)
    ) {
      headers["Content-Type"] =
        "application/json";
    }


    if (auth === "admin") {
      const token =
        sessionStorage.getItem(
          ADMIN_TOKEN_KEY
        );

      if (token) {
        headers.Authorization =
          `Bearer ${token}`;
      }
    }


    if (auth === "team") {
      const token =
        sessionStorage.getItem(
          TEAM_TOKEN_KEY
        );

      if (token) {
        headers.Authorization =
          `Bearer ${token}`;
      }
    }


    const response =
      await fetch(
        `${base}${path}`,
        {
          ...fetchOptions,
          credentials: "same-origin",
          headers
        }
      );


    let body = null;

    try {
      body =
        await response.json();
    } catch {
      body = null;
    }


    if (!response.ok) {
      const error =
        new Error(
          body?.message ||
          `HTTP ${response.status}`
        );

      error.status =
        response.status;

      error.body =
        body;

      throw error;
    }


    return body;
  }


  // ==================================================
  // HEALTH
  // ==================================================

  function health() {
    return request(
      "/api/health"
    );
  }


  // ==================================================
  // PUBLIC / VISITOR
  // ==================================================

  function registerVisitor() {
    return request(
      "/api/visitor/session",
      {
        method: "POST",
        body: "{}"
      }
    );
  }


  function getPublicGames() {
    return request(
      "/api/public/games"
    );
  }


  function castVote(teamId) {
    return request(
      "/api/votes",
      {
        method: "POST",

        body: JSON.stringify({
          teamId
        })
      }
    );
  }


  // ==================================================
  // TEAM AUTH / SUBMISSION
  // ==================================================

  async function teamLogin(
    teamNumber,
    accessCode
  ) {
    const data =
      await request(
        "/api/auth/team/login",
        {
          method: "POST",

          body: JSON.stringify({
            teamNumber,
            accessCode
          })
        }
      );


    if (!data?.token) {
      throw new Error(
        "팀 로그인 토큰을 받지 못했습니다."
      );
    }


    sessionStorage.setItem(
      TEAM_TOKEN_KEY,
      data.token
    );


    return data;
  }


  function teamLogout() {
    sessionStorage.removeItem(
      TEAM_TOKEN_KEY
    );

    location.href =
      "/team/login";
  }


  function getTeamMe() {
    return request(
      "/api/team/me",
      {
        auth: "team"
      }
    );
  }


  function getTeamSubmission() {
    return request(
      "/api/team/submission",
      {
        auth: "team"
      }
    );
  }


  function uploadTeamThumbnail(file) {
    const formData = new FormData();
    formData.append("image", file);

    return request(
      "/api/team/thumbnail",
      {
        method: "POST",
        auth: "team",
        body: formData
      }
    );
  }


  function saveTeamSubmission(
    submission,
    submit = false
  ) {
    return request(
      "/api/team/submission",
      {
        method: "PUT",
        auth: "team",

        body: JSON.stringify({
          title:
            submission.title || "",

          description:
            submission.description || "",

          gameUrl:
            submission.gameUrl || "",

          thumbnailUrl:
            submission.thumbnailUrl || "",

          submit:
            submit === true
        })
      }
    );
  }


  function deleteTeamSubmission() {
    return request(
      "/api/team/submission",
      {
        method: "DELETE",
        auth: "team"
      }
    );
  }


  // ==================================================
  // ADMIN LOGIN
  // ==================================================

  async function adminLogin(
    username,
    password
  ) {
    const data =
      await request(
        "/api/auth/admin/login",
        {
          method: "POST",

          body: JSON.stringify({
            username,
            password
          })
        }
      );


    if (!data?.token) {
      throw new Error(
        "로그인 토큰을 받지 못했습니다."
      );
    }


    sessionStorage.setItem(
      ADMIN_TOKEN_KEY,
      data.token
    );


    return data;
  }


  function adminLogout() {
    sessionStorage.removeItem(
      ADMIN_TOKEN_KEY
    );

    location.href =
      "/admin/login";
  }


  function getAdminMe() {
    return request(
      "/api/admin/me",
      {
        auth: "admin"
      }
    );
  }


  // ==================================================
  // ADMIN DASHBOARD
  // ==================================================

  function getAdminOverview() {
    return request(
      "/api/admin/overview",
      {
        auth: "admin"
      }
    );
  }


  function getAdminTeams() {
    return request(
      "/api/admin/teams",
      {
        auth: "admin"
      }
    );
  }


  function createTeam(
    teamNumber,
    teamName
  ) {
    return request(
      "/api/admin/teams",
      {
        method: "POST",
        auth: "admin",

        body: JSON.stringify({
          teamNumber,
          teamName
        })
      }
    );
  }


  function deleteAdminTeam(
    teamId
  ) {
    return request(
      `/api/admin/teams/${teamId}`,
      {
        method: "DELETE",
        auth: "admin"
      }
    );
  }


  function setVotingOpen(open) {
    return request(
      "/api/admin/voting",
      {
        method: "PUT",
        auth: "admin",

        body: JSON.stringify({
          open
        })
      }
    );
  }


  function setPlazaOpen(open) {
    return request(
      "/api/admin/plaza",
      {
        method: "PUT",
        auth: "admin",

        body: JSON.stringify({
          open
        })
      }
    );
  }


  function setSubmissionOpen(open) {
    return request(
      "/api/admin/submission-window",
      {
        method: "PUT",
        auth: "admin",

        body: JSON.stringify({
          open
        })
      }
    );
  }


  function setSubmissionStatus(
    submissionId,
    status
  ) {
    return request(
      `/api/admin/submissions/${submissionId}/status`,
      {
        method: "PUT",
        auth: "admin",

        body: JSON.stringify({
          status
        })
      }
    );
  }


  function getAdminSubmissions() {
    return request(
      "/api/admin/submissions",
      {
        auth: "admin"
      }
    );
  }


  function getAdminVotes() {
    return request(
      "/api/admin/votes",
      {
        auth: "admin"
      }
    );
  }


  function getAdminLogs() {
    return request(
      "/api/admin/logs",
      {
        auth: "admin"
      }
    );
  }


  // ==================================================
  // EXPORT
  // ==================================================

  window.HackathonAPI = {
    request,

    health,

    registerVisitor,
    getPublicGames,
    castVote,

    teamLogin,
    teamLogout,
    getTeamMe,
    getTeamSubmission,
    uploadTeamThumbnail,
    saveTeamSubmission,
    deleteTeamSubmission,

    adminLogin,
    adminLogout,
    getAdminMe,

    getAdminOverview,
    getAdminTeams,
    createTeam,
    deleteAdminTeam,
    setVotingOpen,
    setPlazaOpen,
    setSubmissionOpen,
    setSubmissionStatus,
    getAdminSubmissions,
    getAdminVotes,
    getAdminLogs,

    getStats:
      getAdminOverview
  };


  console.log(
    "HackathonAPI loaded:",
    Object.keys(
      window.HackathonAPI
    )
  );
})();
