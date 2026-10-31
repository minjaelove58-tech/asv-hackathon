(() => {
  const api = window.HackathonAPI;

  const state = {
    admin: null,
    overview: null,
    teams: [],
    submissions: [],
    votes: [],
    logs: [],
    activeSection: "dashboard",
    emergencySnapshotReady: {
      overview: false,
      submissions: false,
      votes: false
    }
  };

  const EMERGENCY_SNAPSHOT_STORAGE_KEY = "hackathon_emergency_snapshot_v1";
  const EMERGENCY_VOTE_URL_STORAGE_KEY = "hackathon_emergency_vote_url_v1";

  const titleMap = {
    dashboard: "해커톤 운영 대시보드",
    teams: "팀 관리",
    submissions: "작품 관리",
    votes: "투표 현황",
    data: "데이터 관리",
    emergency: "비상 운영 키트",
    logs: "관리자 로그"
  };

  const subtitleMap = {
    dashboard: "현재 시스템 상태를 확인하고 행사를 관리하세요.",
    teams: "참가팀과 접속 코드를 관리하세요.",
    submissions: "제출된 작품을 확인하고 공개 상태를 관리하세요.",
    votes: "팀별 득표 현황을 확인하세요.",
    data: "AISPACE MySQL의 행사 기록을 관리자 화면에서 관리하세요.",
    emergency: "장애 때에도 이어갈 수 있도록 현장 운영 자료를 준비하세요.",
    logs: "관리자 운영 기록을 확인하세요."
  };

  const $ = id =>
    document.getElementById(id);

  let toastTimer = null;
  let voteRequest = null;

  function showToast(message) {
    const toast = $("adminToast");
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add("show");

    if (toastTimer) {
      clearTimeout(toastTimer);
    }

    toastTimer = setTimeout(() => {
      toast.classList.remove("show");
    }, 2800);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      ch => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[ch]
    );
  }

  function safeGameUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(String(value), location.origin);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }

  function messageCard(message, retrySection = "") {
    return `<div class="admin-message"><p>${escapeHtml(message)}</p>${retrySection
      ? `<button class="button button-secondary" type="button" data-retry="${retrySection}">다시 시도</button>`
      : ""}</div>`;
  }

  function statusLabel(status) {
    return ({
      draft: "작성 중",
      submitted: "제출 완료",
      published: "광장 공개"
    })[status] || status || "-";
  }

  function formatUtcSql(value) {
    if (!value) return "-";

    const normalized =
      String(value).includes("T")
        ? String(value)
        : `${String(value).replace(" ", "T")}Z`;

    const date = new Date(normalized);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return date.toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
      hour12: false
    });
  }

  function formatEmergencyTime(value) {
    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return date.toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
      hour12: false
    });
  }

  function normalizeEmergencyVoteUrl(value) {
    if (!value) return "";

    try {
      const url = new URL(String(value).trim());

      if (
        url.protocol !== "https:" ||
        url.origin === location.origin
      ) {
        return "";
      }

      return url.href;
    } catch {
      return "";
    }
  }

  function readEmergencyVoteUrl() {
    try {
      return normalizeEmergencyVoteUrl(
        localStorage.getItem(EMERGENCY_VOTE_URL_STORAGE_KEY) || ""
      );
    } catch {
      return "";
    }
  }

  function readEmergencySnapshot() {
    try {
      const saved = JSON.parse(
        localStorage.getItem(EMERGENCY_SNAPSHOT_STORAGE_KEY) || "null"
      );

      if (
        !saved ||
        !saved.overview ||
        !Array.isArray(saved.submissions) ||
        !Array.isArray(saved.votes)
      ) {
        return null;
      }

      return saved;
    } catch {
      return null;
    }
  }

  function createEmergencySnapshot() {
    const ready = state.emergencySnapshotReady;

    if (!ready.overview || !ready.submissions || !ready.votes) {
      return null;
    }

    return {
      version: 1,
      savedAt: new Date().toISOString(),
      overview: {
        visitors: Number(state.overview?.visitors) || 0,
        votes: Number(state.overview?.votes) || 0,
        published: Number(state.overview?.published) || 0,
        settings: state.overview?.settings || {}
      },
      submissions: state.submissions.map(item => ({
        team_number: Number(item.team_number),
        team_name: String(item.team_name || ""),
        title: String(item.title || ""),
        description: String(item.description || ""),
        game_url: safeGameUrl(item.game_url),
        status: String(item.status || "")
      })),
      votes: state.votes.map(item => ({
        team_number: Number(item.team_number),
        team_name: String(item.team_name || ""),
        game_title: String(item.game_title || ""),
        vote_count: Math.max(0, Number(item.vote_count) || 0)
      }))
    };
  }

  function saveEmergencySnapshot() {
    const snapshot = createEmergencySnapshot();

    if (!snapshot) return;

    try {
      localStorage.setItem(
        EMERGENCY_SNAPSHOT_STORAGE_KEY,
        JSON.stringify(snapshot)
      );
    } catch {
      // 저장 공간 제한이 있어도 정상 운영 데이터에는 영향을 주지 않습니다.
    }

    renderEmergencyKit();
  }

  function activeEmergencySnapshot() {
    return createEmergencySnapshot() || readEmergencySnapshot();
  }

  function emergencyGames(snapshot) {
    return (snapshot?.submissions || [])
      .filter(item => item.status === "published")
      .map(item => ({
        teamNumber: Number(item.team_number),
        teamName: String(item.team_name || ""),
        title: String(item.title || "제목 없음"),
        gameUrl: safeGameUrl(item.game_url)
      }))
      .filter(item => Number.isInteger(item.teamNumber) && item.teamNumber > 0)
      .sort((a, b) => a.teamNumber - b.teamNumber);
  }

  function emergencyVoteEntries(snapshot) {
    return (snapshot?.votes || [])
      .map(item => ({
        teamNumber: Number(item.team_number),
        teamName: String(item?.team_name || "미등록"),
        gameTitle: String(item?.game_title || "작품 미등록"),
        count: Math.max(0, Number(item?.vote_count) || 0)
      }))
      .filter(item => Number.isInteger(item.teamNumber) && item.teamNumber > 0)
      .sort((a, b) => a.teamNumber - b.teamNumber);
  }

  function renderEmergencyKit(syncUrlInput = false) {
    const status = $("emergencySnapshotStatus");
    const input = $("emergencyVoteUrl");
    const openButton = $("openEmergencyVoteUrlButton");

    if (!status || !input || !openButton) return;

    const snapshot = activeEmergencySnapshot();
    const externalUrl = readEmergencyVoteUrl();

    if (syncUrlInput || document.activeElement !== input) {
      input.value = externalUrl;
    }

    openButton.disabled = !externalUrl;

    if (!snapshot) {
      status.textContent = "아직 저장된 행사 정보가 없습니다. 인터넷이 연결된 상태에서 ‘현재 정보 준비’를 눌러 주세요.";
      return;
    }

    const games = emergencyGames(snapshot);
    const votes = emergencyVoteEntries(snapshot)
      .reduce((sum, item) => sum + item.count, 0);
    status.textContent = `${formatEmergencyTime(snapshot.savedAt)} 기준 · 공개 작품 ${games.length}개 · 투표 ${votes}표를 이 브라우저에 저장했습니다.`;
  }

  function csvCell(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  function downloadTextFile(contents, filename, type) {
    const blob = new Blob([contents], { type });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  function downloadEmergencySnapshot() {
    const snapshot = activeEmergencySnapshot();

    if (!snapshot) {
      showToast("저장할 비상 기록이 없습니다. 현재 정보를 먼저 준비해 주세요.");
      return;
    }

    const rows = [
      ["구분", "팀 번호", "팀 이름", "작품명", "값", "게임 직접 주소"],
      ["기록 생성 시각", "", "", "", formatEmergencyTime(snapshot.savedAt), ""],
      ["기록 시점 총 투표", "", "", "", Number(snapshot.overview?.votes) || 0, ""],
      ["기록 시점 방문객", "", "", "", Number(snapshot.overview?.visitors) || 0, ""],
      ...emergencyVoteEntries(snapshot).map(item => [
        "기록 시점 팀별 득표",
        item.teamNumber,
        item.teamName,
        item.gameTitle,
        item.count,
        ""
      ]),
      ...emergencyGames(snapshot).map(item => [
        "공개 게임 직접 주소",
        item.teamNumber,
        item.teamName,
        item.title,
        "",
        item.gameUrl
      ])
    ];
    const csv = `\ufeff${rows.map(row => row.map(csvCell).join(",")).join("\r\n")}`;
    const date = new Date().toISOString().slice(0, 10);
    downloadTextFile(csv, `hackathon-emergency-snapshot-${date}.csv`, "text/csv;charset=utf-8");
    showToast("비상 기록 CSV를 저장했습니다.");
  }

  function openPreparedPrintReport() {
    const report = $("printVoteReport");
    if (!report) return;

    document.body.classList.add("is-printing");
    report.setAttribute("aria-hidden", "false");
    const cleanup = () => {
      document.body.classList.remove("is-printing");
      report.setAttribute("aria-hidden", "true");
    };
    window.addEventListener("afterprint", cleanup, { once: true });
    window.setTimeout(() => window.print(), 0);
  }

  function paperBallotMarkup(games, compact = false) {
    const ballotClass = compact ? "print-paper-ballot print-paper-ballot-compact" : "print-paper-ballot";
    return `
      <section class="${ballotClass}">
        <div class="print-paper-ballot-heading">
          <p class="eyebrow">청소년 AI게임개발 헤커톤</p>
          <h2>아날로그 비상 투표지</h2>
        </div>
        <div class="print-ballot-person" aria-label="투표자 기록란">
          <span>이름: ________________________</span>
          <span>서명: ________________________</span>
        </div>
        <p class="print-ballot-guide">아래 작품 중 마음에 드는 한 작품에만 □ 표시해 주세요.</p>
        <div class="print-paper-ballot-list">
          ${games.map(item => `
            <div class="print-paper-ballot-row"><span aria-hidden="true">□</span><strong>${escapeHtml(String(item.teamNumber))}팀</strong><span>${escapeHtml(item.title)}</span></div>`).join("")}
        </div>
        <p class="print-ballot-note">투표 시각: ______년 ___월 ___일 ___시 ___분 · 이름과 서명은 중복 투표 확인 및 집계 검증에만 사용합니다.</p>
      </section>
    `;
  }

  function createPrintablePaperBallot() {
    const snapshot = activeEmergencySnapshot();
    if (!snapshot) {
      showToast("인쇄할 비상 기록이 없습니다. 현재 정보를 먼저 준비해 주세요.");
      return;
    }

    const games = emergencyGames(snapshot);
    if (!games.length) {
      showToast("공개된 게임이 없어 투표지를 만들 수 없습니다.");
      return;
    }

    const report = $("printVoteReport");
    report.innerHTML = `
      <div class="print-paper-ballot-sheet">
        ${paperBallotMarkup(games, true)}
        ${paperBallotMarkup(games, true)}
      </div>
    `;
    openPreparedPrintReport();
  }

  function createPrintableEmergencyKit() {
    const snapshot = activeEmergencySnapshot();

    if (!snapshot) {
      showToast("인쇄할 비상 기록이 없습니다. 현재 정보를 먼저 준비해 주세요.");
      return;
    }

    const report = $("printVoteReport");
    const games = emergencyGames(snapshot);
    const votes = emergencyVoteEntries(snapshot);
    const totalVotes = votes.reduce((sum, item) => sum + item.count, 0);
    const backupUrl = readEmergencyVoteUrl();

    report.innerHTML = `
      <div class="print-report-header">
        <p class="eyebrow">청소년 AI게임개발 헤커톤</p>
        <h1>비상 운영 키트</h1>
        <p>기록 생성 시각: ${escapeHtml(formatEmergencyTime(snapshot.savedAt))}</p>
      </div>
      <section class="print-emergency-summary">
        <div><span>기록 시점 총 투표</span><strong>${totalVotes}표</strong></div>
        <div><span>기록 시점 방문객</span><strong>${Number(snapshot.overview?.visitors) || 0}명</strong></div>
        <div><span>공개 작품</span><strong>${games.length}개</strong></div>
      </section>
      <section class="print-emergency-instructions">
        <h2>장애 전환 순서</h2>
        <ol>
          <li>운영진 두 명이 오류를 확인하고 장애 시작 시각을 기록합니다.</li>
          <li>관리자 화면이 열리면 정상 투표를 중단합니다.</li>
          <li>아래 외부 비상 투표 링크 또는 종이 투표지 한 가지 방식만 사용합니다.</li>
          <li>복구 뒤에는 비상 투표를 먼저 마감하고, 이 기록과 대조한 뒤 정상 투표를 재개합니다.</li>
        </ol>
        <p><strong>외부 비상 투표 링크:</strong> ${backupUrl ? escapeHtml(backupUrl) : "행사 전 관리자 화면에서 등록해 주세요."}</p>
      </section>
      <section class="print-emergency-games">
        <h2>공개 게임 직접 주소</h2>
        ${games.length ? `
          <div class="print-emergency-game-list">
            ${games.map(item => `
              <div class="print-emergency-game-row">
                <strong>${item.teamNumber}팀</strong>
                <span>${escapeHtml(item.title)}</span>
                <code>${item.gameUrl ? escapeHtml(item.gameUrl) : "게임 주소 미등록"}</code>
              </div>`).join("")}
          </div>` : "<p>공개된 게임이 없습니다.</p>"}
      </section>
      ${games.length ? paperBallotMarkup(games) : `
        <section class="print-paper-ballot">
          <h2>아날로그 비상 투표지</h2>
          <p>공개된 게임이 없어 투표지를 만들 수 없습니다.</p>
        </section>`}
    `;
    openPreparedPrintReport();
  }

  function handleError(error, fallback = "요청을 처리하지 못했습니다.") {
    console.error(error);

    if (error?.status === 401) {
      sessionStorage.removeItem("hackathon_admin_token");
      location.href = "/admin/login";
      return;
    }

    showToast(error?.message || fallback);
  }

  function renderIdentity() {
    if (!state.admin) return;

    $("adminIdentity").textContent =
      `${state.admin.displayName || state.admin.username} · ${state.admin.role}`;
  }

  function renderOverview() {
    const data = state.overview;
    if (!data) return;

    $("statVisitors").textContent = String(data.visitors ?? 0);
    $("statVotes").textContent = String(data.votes ?? 0);
    $("statSubmitted").textContent = String(data.submitted ?? 0);
    $("statPublished").textContent = String(data.published ?? 0);

    if ($("dataVisitors")) {
      $("dataVisitors").textContent = String(data.visitors ?? 0);
      $("dataVotes").textContent = String(data.votes ?? 0);
      $("dataSubmitted").textContent = String(data.submitted ?? 0);
      $("dataPublished").textContent = String(data.published ?? 0);
      $("adminDbStatus").textContent = "연결됨";
      $("adminDbStatus").className = "status-badge status-on";
      $("adminDbStatusText").textContent =
        "관리자 API가 AISPACE MySQL에서 최신 집계값을 읽었습니다.";
    }

    $("overviewStatus").classList.add("hidden");

    const settings = data.settings || {};
    const votingOpen = Boolean(settings.votingOpen);
    const plazaOpen = Boolean(settings.plazaOpen);
    const submissionOpen = Boolean(settings.submissionOpen);

    const voteBadge = $("adminVoteStatus");
    voteBadge.textContent = votingOpen ? "투표 진행 중" : "투표 중지";
    voteBadge.className = `status-badge ${votingOpen ? "status-on" : "status-off"}`;

    const plazaBadge = $("adminPlazaStatus");
    plazaBadge.textContent = plazaOpen ? "광장 공개" : "광장 닫힘";
    plazaBadge.className = `status-badge ${plazaOpen ? "status-on" : "status-off"}`;

    const submissionBadge = $("adminSubmissionStatus");
    submissionBadge.textContent = submissionOpen ? "접수 중" : "접수 중단";
    submissionBadge.className = `status-badge ${submissionOpen ? "status-on" : "status-off"}`;

    $("voteControlText").textContent = votingOpen
      ? "방문객 투표를 받고 있습니다."
      : plazaOpen ? "광장이 공개되었습니다. 투표를 시작할 수 있습니다." : "광장을 공개한 뒤 투표를 시작할 수 있습니다.";

    $("plazaControlText").textContent = plazaOpen
      ? "방문객이 공개 작품을 볼 수 있습니다."
      : "방문객에게 작품을 보여주지 않습니다.";

    $("submissionControlText").textContent = submissionOpen
      ? "팀의 작품 저장과 최종 제출을 받고 있습니다."
      : "팀의 작품 저장과 최종 제출이 중단되었습니다.";

    $("startVotingButton").disabled = votingOpen || !plazaOpen;
    $("stopVotingButton").disabled = !votingOpen;
    $("openPlazaButton").disabled = plazaOpen;
    $("closePlazaButton").disabled = !plazaOpen;
    $("openSubmissionButton").disabled = submissionOpen;
    $("closeSubmissionButton").disabled = !submissionOpen;

    $("startVotingButton").classList.toggle("hidden", votingOpen);
    $("stopVotingButton").classList.toggle("hidden", !votingOpen);
    $("openPlazaButton").classList.toggle("hidden", plazaOpen);
    $("closePlazaButton").classList.toggle("hidden", !plazaOpen);
    $("openSubmissionButton").classList.toggle("hidden", submissionOpen);
    $("closeSubmissionButton").classList.toggle("hidden", !submissionOpen);
  }

  function renderTeams() {
    const teams = [...state.teams]
      .sort((a, b) => Number(a.team_number) - Number(b.team_number));

    $("teamTableWrap").innerHTML = teams.length
      ? teams.map(team => {
          const teamNumber = Number(team.team_number);
          const submission = team.submission_status
            ? statusLabel(team.submission_status)
            : "작품 미제출";
          const active = Number(team.is_active) === 1
            ? "계정 활성"
            : "계정 비활성";

          return `
            <article class="admin-item-card">
              <div class="item-head">
                <div>
                  <span class="item-kicker">${teamNumber}팀</span>
                  <h4>${escapeHtml(team.team_name)}</h4>
                </div>
              </div>
              <div class="item-meta">
                <span class="status-badge ${Number(team.is_active) === 1 ? "status-on" : "status-off"}">${active}</span>
                <span class="status-badge ${team.submission_status === "published" ? "status-on" : "status-draft"}">${escapeHtml(submission)}</span>
              </div>
              <p class="item-subline">등록: ${escapeHtml(formatUtcSql(team.created_at))}</p>
              <div class="item-actions">
                <button class="button button-danger team-delete-button" type="button" data-id="${Number(team.id)}" aria-label="${teamNumber}팀 ${escapeHtml(team.team_name)} 삭제">팀 삭제</button>
              </div>
            </article>`;
        }).join("")
      : messageCard("등록된 팀이 없습니다.");
  }

  function renderSubmissions() {
    $("submissionTableWrap").innerHTML = state.submissions.length
      ? state.submissions.map(item => {
          const id = Number(item.id);
          const status = escapeHtml(statusLabel(item.status));
          const gameUrl = safeGameUrl(item.game_url);
          const action = item.status === "submitted"
            ? `<button class="button button-primary submission-status-button" type="button" data-id="${id}" data-status="published">광장 공개</button>`
            : item.status === "published"
              ? `<button class="button button-danger submission-status-button" type="button" data-id="${id}" data-status="submitted">공개 취소</button>`
              : "";
          return `
            <article class="admin-item-card">
              <div class="item-head">
                <div><span class="item-kicker">${Number(item.team_number)}팀 · ${escapeHtml(item.team_name)}</span><h4>${escapeHtml(item.title || "제목 없음")}</h4></div>
                <span class="status-badge ${item.status === "published" ? "status-on" : "status-draft"}">${status}</span>
              </div>
              <div class="item-actions">
                <button class="button button-secondary submission-detail-button" type="button" data-id="${id}" aria-controls="submissionDetail${id}" aria-expanded="false">상세 보기</button>
                ${action}
              </div>
              <div id="submissionDetail${id}" class="submission-detail hidden">
                <p><strong>작품 소개</strong><br>${escapeHtml(item.description || "소개가 없습니다.")}</p>
                <p><strong>제출 시각</strong><br>${escapeHtml(formatUtcSql(item.submitted_at))}</p>
                ${gameUrl ? `<a href="${escapeHtml(gameUrl)}" target="_blank" rel="noopener noreferrer">게임 열기</a>` : `<span class="muted">게임 주소 미등록</span>`}
              </div>
            </article>`;
        }).join("")
      : messageCard("아직 제출된 작품이 없습니다.");
  }

  function voteEntries() {
    return state.votes
      .map(item => {
        const rawCount = Number(item?.vote_count);
        return {
          teamNumber: Number(item.team_number),
          teamName: item?.team_name || "미등록",
          gameTitle: item?.game_title || "작품 미등록",
          count: Number.isFinite(rawCount) ? Math.max(0, rawCount) : 0
        };
      })
      .filter(item => Number.isInteger(item.teamNumber) && item.teamNumber > 0)
      .sort((a, b) => a.teamNumber - b.teamNumber);
  }

  function renderVoteChart(entries, detailed = false) {
    const maximum = Math.max(0, ...entries.map(item => item.count));
    return entries.map(item => {
      const width = maximum > 0 ? Math.min(100, item.count / maximum * 100) : 0;
      const detail = detailed ? item.gameTitle : item.teamName;
      return `
        <div class="vote-chart-row" aria-label="${item.teamNumber}팀 ${escapeHtml(item.teamName)}, ${item.count}표">
          <div class="vote-chart-label"><strong>${item.teamNumber}팀</strong><small>${escapeHtml(detail)}</small></div>
          <div class="vote-chart-track" aria-hidden="true"><span class="vote-chart-fill" style="width: ${width}%"></span></div>
          <strong class="vote-chart-count">${item.count}표</strong>
        </div>`;
    }).join("");
  }

  function renderVotes(errorMessage = "") {
    const entries = voteEntries();
    const total = entries.reduce((sum, item) => sum + item.count, 0);
    const status = errorMessage
      ? "갱신 실패 · 최신 득표수를 확인할 수 없습니다."
      : `최근 갱신: ${new Date().toLocaleTimeString("ko-KR", {
          timeZone: "Asia/Seoul",
          hour12: false
        })} · 5초마다 자동 갱신`;

    $("dashboardVoteTotal").textContent = errorMessage ? "—" : String(total);
    $("votesTotal").textContent = errorMessage ? "—" : String(total);
    $("dashboardVoteTableWrap").innerHTML = errorMessage
      ? messageCard(errorMessage, "dashboard")
      : renderVoteChart(entries);
    $("voteTableWrap").innerHTML = errorMessage
      ? messageCard(errorMessage, "votes")
      : renderVoteChart(entries, true);
    ["votesStatus", "dashboardVotesStatus"].forEach(id => {
      $(id).textContent = status;
    });
  }

  function createPrintableVoteReport() {
    const report = $("printVoteReport");
    if (!report) return;

    const entries = voteEntries();
    const overview = state.overview || {};
    const visitors = Number(overview.visitors);
    const totalVotes = Number.isFinite(Number(overview.votes))
      ? Math.max(0, Number(overview.votes))
      : entries.reduce((sum, item) => sum + item.count, 0);
    const participationRate = Number.isFinite(visitors) && visitors > 0
      ? `${((totalVotes / visitors) * 100).toFixed(1)}%`
      : "계산할 방문객 수 없음";
    const generatedAt = new Date().toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
      hour12: false
    });
    const maximum = Math.max(0, ...entries.map(item => item.count));

    report.innerHTML = `
      <div class="print-report-header">
        <p class="eyebrow">청소년 AI게임개발 헤커톤</p>
        <h1>투표 결과 보고서</h1>
        <p>생성 시각: ${escapeHtml(generatedAt)}</p>
      </div>
      <div class="print-report-summary">
        <div><span>방문객 세션 수</span><strong>${Number.isFinite(visitors) ? visitors : "—"}</strong></div>
        <div><span>총 투표 수</span><strong>${totalVotes}</strong></div>
        <div><span>투표 참여율</span><strong>${escapeHtml(participationRate)}</strong></div>
      </div>
      <section>
        <h2>팀별 득표 현황</h2>
        <div class="print-vote-list">
          ${entries.map(item => {
            const width = maximum > 0 ? Math.min(100, item.count / maximum * 100) : 0;
            return `
              <div class="print-vote-row">
                <span>${item.teamNumber}팀</span>
                <span class="print-vote-track"><i style="width:${width}%"></i></span>
                <strong>${item.count}표</strong>
              </div>`;
          }).join("")}
        </div>
      </section>
    `;

    document.body.classList.add("is-printing");
    report.setAttribute("aria-hidden", "false");
    const cleanup = () => {
      document.body.classList.remove("is-printing");
      report.setAttribute("aria-hidden", "true");
    };
    window.addEventListener("afterprint", cleanup, { once: true });
    window.setTimeout(() => window.print(), 0);
  }

  function renderLogs() {
    $("logList").innerHTML = state.logs.length
      ? state.logs.map(log => `
          <article class="log-item">
            <strong>${escapeHtml(log.action)}</strong>
            <p class="muted">${escapeHtml(log.details || "-")}</p>
            <time>${escapeHtml(log.display_name || log.username || "시스템")} · ${escapeHtml(formatUtcSql(log.created_at))}</time>
          </article>
        `).join("")
      : messageCard("아직 기록이 없습니다.");
  }

  async function loadOverview() {
    try {
      state.overview = await api.getAdminOverview();
      state.emergencySnapshotReady.overview = true;
      renderOverview();
      saveEmergencySnapshot();
    } catch (error) {
      state.emergencySnapshotReady.overview = false;
      $("overviewStatus").classList.remove("hidden");
      $("overviewStatus").innerHTML = messageCard("통계를 불러오지 못했습니다.", "dashboard");
      throw error;
    }
  }

  async function loadTeams() {
    try {
      const data = await api.getAdminTeams();
      state.teams = data.teams || [];
      renderTeams();
    } catch (error) {
      $("teamTableWrap").innerHTML = messageCard("팀 목록을 불러오지 못했습니다.", "teams");
      throw error;
    }
  }

  async function loadSubmissions() {
    try {
      const data = await api.getAdminSubmissions();
      state.submissions = data.submissions || [];
      state.emergencySnapshotReady.submissions = true;
      renderSubmissions();
      saveEmergencySnapshot();
    } catch (error) {
      state.emergencySnapshotReady.submissions = false;
      $("submissionTableWrap").innerHTML = messageCard("작품 목록을 불러오지 못했습니다.", "submissions");
      throw error;
    }
  }

  function loadVotes() {
    if (voteRequest) return voteRequest;

    voteRequest = (async () => {
      try {
        const data = await api.getAdminVotes();
        state.votes = data.votes || [];
        state.emergencySnapshotReady.votes = true;
        renderVotes();
        saveEmergencySnapshot();
      } catch (error) {
        state.emergencySnapshotReady.votes = false;
        state.votes = [];
        renderVotes("득표 현황을 불러오지 못했습니다. 새로고침해 주세요.");
        throw error;
      } finally {
        voteRequest = null;
      }
    })();

    return voteRequest;
  }

  async function loadLogs() {
    try {
      const data = await api.getAdminLogs();
      state.logs = data.logs || [];
      renderLogs();
    } catch (error) {
      $("logList").innerHTML = messageCard("운영 기록을 불러오지 못했습니다.", "logs");
      throw error;
    }
  }

  async function loadSection(section) {
    try {
      if (section === "dashboard") await Promise.all([loadOverview(), loadVotes()]);
      if (section === "teams") await loadTeams();
      if (section === "submissions") await loadSubmissions();
      if (section === "votes") await loadVotes();
      if (section === "data") await loadOverview();
      if (section === "emergency") renderEmergencyKit(true);
      if (section === "logs") await loadLogs();
    } catch (error) {
      handleError(error);
    }
  }

  async function initialize() {
    const results = await Promise.allSettled([
      api.getAdminMe(),
      loadOverview(),
      loadTeams(),
      loadSubmissions(),
      loadLogs(),
      loadVotes()
    ]);

    if (results[0].status === "fulfilled") {
      state.admin = results[0].value.admin;
      renderIdentity();
    }

    const failure = results.find(result => result.status === "rejected" && result.reason?.status === 401)
      || results.find(result => result.status === "rejected");
    if (failure) handleError(failure.reason, "관리자 데이터를 불러오지 못했습니다.");
  }

  document.querySelectorAll(".nav-button").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav-button").forEach(item => {
        item.classList.remove("active");
        item.setAttribute("aria-pressed", "false");
      });

      button.classList.add("active");
      button.setAttribute("aria-pressed", "true");

      const section = button.dataset.section;
      state.activeSection = section;
      $("sectionTitle").textContent = titleMap[section];
      $("sectionSubtitle").textContent = subtitleMap[section];

      document.querySelectorAll("[data-panel]").forEach(panel => {
        panel.classList.toggle("hidden", panel.dataset.panel !== section);
      });

      loadSection(section);
    });
  });

  $("logoutButton").addEventListener("click", () => {
    api.adminLogout();
  });

  function setAddTeamFormOpen(open) {
    $("addTeamPanel").classList.toggle("hidden", !open);
    $("addTeamButton").setAttribute("aria-expanded", String(open));
    if (open) $("newTeamNumber").focus();
  }

  $("addTeamButton").addEventListener("click", () => {
    setAddTeamFormOpen($("addTeamPanel").classList.contains("hidden"));
  });

  $("cancelAddTeamButton").addEventListener("click", () => {
    setAddTeamFormOpen(false);
    $("addTeamButton").focus();
  });

  $("addTeamPanel").addEventListener("submit", async event => {
    event.preventDefault();
    const teamNumber = Number($("newTeamNumber").value);
    const teamName = $("newTeamName").value.trim();
    if (!Number.isInteger(teamNumber) || teamNumber < 1 || !teamName) {
      showToast("팀 번호(1 이상)와 팀 이름을 확인해 주세요.");
      return;
    }

    $("saveTeamButton").disabled = true;
    try {
      const result = await api.createTeam(teamNumber, teamName);
      $("accessCodeTitle").textContent = `${teamNumber}팀 · ${teamName}`;
      $("accessCodeValue").textContent = result.accessCode;
      $("accessCodeBox").classList.remove("hidden");
      $("addTeamPanel").reset();
      setAddTeamFormOpen(false);
      $("accessCodeTitle").focus();
      $("accessCodeBox").scrollIntoView({ block: "nearest" });
      showToast("팀이 생성되었습니다. 접속 코드를 기록해 주세요.");
      await Promise.all([loadTeams(), loadOverview(), loadLogs()]);
    } catch (error) {
      handleError(error, "팀 생성에 실패했습니다.");
    } finally {
      $("saveTeamButton").disabled = false;
    }
  });

  $("copyAccessCodeButton").addEventListener("click", async () => {
    const code = $("accessCodeValue").textContent.trim();
    if (!code) return;

    try {
      await navigator.clipboard.writeText(code);
      showToast("접속 코드를 복사했습니다.");
    } catch {
      showToast(`접속 코드: ${code}`);
    }
  });

  $("teamTableWrap").addEventListener("click", async event => {
    const button = event.target.closest(".team-delete-button");
    if (!button) return;

    const teamId = Number(button.dataset.id);
    const team = state.teams.find(item => Number(item.id) === teamId);
    if (!team || !Number.isInteger(teamId) || teamId < 1) {
      showToast("팀 정보를 다시 불러와 주세요.");
      return;
    }

    const teamNumber = Number(team.team_number);
    const teamName = String(team.team_name || "");
    const message = `${teamNumber}팀 ${teamName}을(를) 삭제할까요?\n\n팀 정보, 작품, 대표 이미지, 이 팀에 투표된 표가 DB에서 모두 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`;
    if (!confirm(message)) return;

    button.disabled = true;

    try {
      const result = await api.deleteAdminTeam(teamId);
      const deleted = result.deleted || {};
      showToast(`${teamNumber}팀을 삭제했습니다. 작품 ${Number(deleted.submissions || 0)}개와 투표 ${Number(deleted.votes || 0)}표를 함께 삭제했습니다.`);

      await Promise.all([
        loadTeams(),
        loadSubmissions(),
        loadVotes(),
        loadOverview(),
        loadLogs()
      ]);
    } catch (error) {
      handleError(error, "팀을 삭제하지 못했습니다.");
    } finally {
      button.disabled = false;
    }
  });

  $("submissionTableWrap").addEventListener("click", async event => {
    const detailButton = event.target.closest(".submission-detail-button");
    if (detailButton) {
      const detail = $(detailButton.getAttribute("aria-controls"));
      const open = detail.classList.toggle("hidden") === false;
      detailButton.setAttribute("aria-expanded", String(open));
      detailButton.textContent = open ? "상세 닫기" : "상세 보기";
      return;
    }

    const button = event.target.closest(".submission-status-button");
    if (!button) return;

    const submissionId = Number(button.dataset.id);
    const status = button.dataset.status;

    const message = status === "published"
      ? "이 작품을 게임 광장에 공개할까요?"
      : "이 작품의 광장 공개를 취소할까요?";

    if (!confirm(message)) return;

    button.disabled = true;

    try {
      await api.setSubmissionStatus(submissionId, status);
      showToast(status === "published" ? "작품을 공개했습니다." : "작품 공개를 취소했습니다.");

      await Promise.all([
        loadSubmissions(),
        loadOverview(),
        loadLogs()
      ]);
    } catch (error) {
      handleError(error, "작품 상태 변경에 실패했습니다.");
    } finally {
      button.disabled = false;
    }
  });

  $("startVotingButton").addEventListener("click", async () => {
    if (!confirm("방문객 투표를 시작할까요?")) return;

    try {
      await api.setVotingOpen(true);
      showToast("투표를 시작했습니다.");
      await Promise.all([loadOverview(), loadLogs()]);
    } catch (error) {
      handleError(error, "투표를 시작하지 못했습니다.");
    }
  });

  $("stopVotingButton").addEventListener("click", async () => {
    if (!confirm("모든 투표를 즉시 중단할까요?")) return;

    try {
      await api.setVotingOpen(false);
      showToast("투표를 중단했습니다.");
      await Promise.all([loadOverview(), loadLogs()]);
    } catch (error) {
      handleError(error, "투표를 중단하지 못했습니다.");
    }
  });

  $("openPlazaButton").addEventListener("click", async () => {
    try {
      await api.setPlazaOpen(true);
      showToast("게임 광장을 공개했습니다.");
      await Promise.all([loadOverview(), loadLogs()]);
    } catch (error) {
      handleError(error, "게임 광장을 열지 못했습니다.");
    }
  });

  $("closePlazaButton").addEventListener("click", async () => {
    if (!confirm("게임 광장을 닫을까요? 진행 중인 투표도 함께 중단됩니다.")) return;

    try {
      await api.setPlazaOpen(false);
      showToast("게임 광장을 닫았습니다.");
      await Promise.all([loadOverview(), loadLogs()]);
    } catch (error) {
      handleError(error, "게임 광장을 닫지 못했습니다.");
    }
  });

  $("openSubmissionButton").addEventListener("click", async () => {
    try {
      await api.setSubmissionOpen(true);
      showToast("작품 제출을 열었습니다.");
      await Promise.all([loadOverview(), loadLogs()]);
    } catch (error) {
      handleError(error, "작품 제출을 열지 못했습니다.");
    }
  });

  $("closeSubmissionButton").addEventListener("click", async () => {
    if (!confirm("작품 제출을 닫을까요? 팀의 임시 저장과 최종 제출도 중단됩니다.")) return;

    try {
      await api.setSubmissionOpen(false);
      showToast("작품 제출을 닫았습니다.");
      await Promise.all([loadOverview(), loadLogs()]);
    } catch (error) {
      handleError(error, "작품 제출을 닫지 못했습니다.");
    }
  });

  async function runDataReset(scope, confirmMessage, successMessage, button, errorMessage) {
    if (state.overview?.settings?.votingOpen) {
      showToast("투표를 먼저 중단해 주세요.");
      return;
    }

    if (!confirm(confirmMessage)) return;

    button.disabled = true;

    try {
      const result = await api.resetAdminData(scope);
      const deleted = result.deleted || {};
      showToast(
        `${successMessage} 방문객 ${Number(deleted.visitors || 0)}명, 투표 ${Number(deleted.votes || 0)}표를 처리했습니다.`
      );
      await Promise.all([loadOverview(), loadVotes(), loadLogs()]);
    } catch (error) {
      handleError(error, errorMessage);
    } finally {
      button.disabled = false;
    }
  }

  $("refreshSubmissionsButton").addEventListener("click", () => loadSection("submissions"));
  $("refreshDashboardVotesButton").addEventListener("click", () => loadSection("dashboard"));
  $("refreshVotesButton").addEventListener("click", () => loadSection("votes"));
  $("refreshLogsButton").addEventListener("click", () => loadSection("logs"));
  $("refreshDataManagementButton").addEventListener("click", () => loadSection("data"));

  $("resetVotesButton").addEventListener("click", () => runDataReset(
    "votes",
    "투표 기록을 모두 초기화할까요?\\n\\n방문객 수는 유지되고, 모든 팀의 득표수만 0표가 됩니다.",
    "투표 기록을 초기화했습니다.",
    $("resetVotesButton"),
    "투표 기록을 초기화하지 못했습니다."
  ));

  $("resetVisitorsVotesButton").addEventListener("click", () => runDataReset(
    "visitor_votes",
    "방문객·투표 기록을 모두 초기화할까요?\\n\\n팀과 작품은 유지되지만 방문객 수와 득표수가 0으로 돌아갑니다. 이 작업은 되돌릴 수 없습니다.",
    "방문객·투표 기록을 초기화했습니다.",
    $("resetVisitorsVotesButton"),
    "방문객·투표 기록을 초기화하지 못했습니다."
  ));

  $("refreshEmergencyKitButton").addEventListener("click", async () => {
    const button = $("refreshEmergencyKitButton");
    button.disabled = true;

    try {
      await Promise.all([loadOverview(), loadSubmissions(), loadVotes()]);
      renderEmergencyKit(true);
      showToast("현재 행사 정보를 비상 키트에 저장했습니다.");
    } catch (error) {
      handleError(error, "현재 정보를 준비하지 못했습니다.");
    } finally {
      button.disabled = false;
    }
  });

  $("printEmergencyKitButton").addEventListener("click", createPrintableEmergencyKit);
  $("printPaperBallotButton").addEventListener("click", createPrintablePaperBallot);
  $("downloadEmergencySnapshotButton").addEventListener("click", downloadEmergencySnapshot);

  $("saveEmergencyVoteUrlButton").addEventListener("click", () => {
    const input = $("emergencyVoteUrl");
    const rawValue = input.value.trim();

    try {
      if (!rawValue) {
        localStorage.removeItem(EMERGENCY_VOTE_URL_STORAGE_KEY);
        renderEmergencyKit(true);
        showToast("비상 투표 링크를 지웠습니다.");
        return;
      }

      const url = normalizeEmergencyVoteUrl(rawValue);

      if (!url) {
        showToast("현재 사이트와 다른 HTTPS 주소를 입력해 주세요.");
        input.focus();
        return;
      }

      localStorage.setItem(EMERGENCY_VOTE_URL_STORAGE_KEY, url);
      renderEmergencyKit(true);
      showToast("외부 비상 투표 링크를 이 브라우저에 저장했습니다.");
    } catch {
      showToast("브라우저 저장 공간을 사용할 수 없습니다.");
    }
  });

  $("openEmergencyVoteUrlButton").addEventListener("click", () => {
    const url = readEmergencyVoteUrl();

    if (!url) {
      showToast("외부 비상 투표 링크를 먼저 저장해 주세요.");
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  });

  document.querySelectorAll(".print-votes-button").forEach(button => {
    button.addEventListener("click", createPrintableVoteReport);
  });

  document.addEventListener("click", event => {
    const retryButton = event.target.closest("[data-retry]");
    if (retryButton) loadSection(retryButton.dataset.retry);
  });

  initialize();

  setInterval(async () => {
    try {
      const requests = [loadOverview()];
      if (state.activeSection === "dashboard" || state.activeSection === "votes") {
        requests.push(loadVotes());
      }
      await Promise.all(requests);
    } catch (error) {
      handleError(error);
    }
  }, 5000);
})();
