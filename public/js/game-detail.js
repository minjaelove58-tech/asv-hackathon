(() => {
  const detail = document.getElementById("gameDetail");
  const status = document.getElementById("detailLoadStatus");
  const dialog = document.getElementById("detailVoteDialog");
  const dialogText = document.getElementById("detailVoteDialogText");
  const confirmVoteButton = document.getElementById("detailConfirmVoteButton");
  const toast = document.getElementById("detailToast");

  const VOTE_STATE_KEY = "hackathon_vote_cast";
  const VOTE_COOKIE_KEY = "hackathon_vote_ui";
  const QR_PUBLIC_ORIGIN = "https://hakertone-app.minjaelove58.workers.dev";

  const requestedTeamParameter = new URLSearchParams(window.location.search).get("team") || "";
  const requestedTeamNumber = /^[1-9][0-9]{0,2}$/.test(requestedTeamParameter)
    ? Number(requestedTeamParameter)
    : Number.NaN;

  let currentGame = null;
  let votingOpen = false;
  let loading = false;
  let voteSubmitting = false;
  let toastTimer = null;

  function loadVoteState() {
    try {
      if (window.localStorage.getItem(VOTE_STATE_KEY) === "1") return true;
    } catch {}

    try {
      if (window.sessionStorage.getItem(VOTE_STATE_KEY) === "1") return true;
    } catch {}

    return document.cookie
      .split(";")
      .some(cookie => cookie.trim().startsWith(`${VOTE_COOKIE_KEY}=1`));
  }

  function saveVoteState() {
    try {
      window.localStorage.setItem(VOTE_STATE_KEY, "1");
    } catch {}

    try {
      window.sessionStorage.setItem(VOTE_STATE_KEY, "1");
    } catch {}

    try {
      document.cookie = `${VOTE_COOKIE_KEY}=1; Max-Age=2592000; Path=/; SameSite=Lax`;
    } catch {}
  }

  let hasVoted = loadVoteState();

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#039;"
    })[char]);
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
  }

  function isValidTeamNumber(value) {
    return Number.isSafeInteger(value) && value > 0 && value <= 999;
  }

  function detailUrl(teamNumber) {
    const url = new URL("/game", QR_PUBLIC_ORIGIN);
    url.searchParams.set("team", String(teamNumber));
    return url.href;
  }

  function renderMessage(title, message) {
    detail.setAttribute("aria-busy", "false");
    detail.className = "detail-message";
    detail.innerHTML = `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p>`;
  }

  function voteLabel() {
    if (hasVoted) return "투표 완료";
    return votingOpen ? "투표하기" : "투표 준비 중";
  }

  function renderGame(game) {
    const teamNumber = Number(game.teamNumber);
    const teamName = String(game.teamName || "");
    const title = String(game.title || `${teamNumber}팀 게임`);
    const description = String(game.description || "게임 소개가 등록되지 않았습니다.");
    const gameUrl = String(game.gameUrl || "");
    const thumbnailUrl = String(game.thumbnailUrl || "");
    const url = detailUrl(teamNumber);
    const voteDisabled = !votingOpen || hasVoted;
    const safeTitle = escapeHtml(title);

    detail.setAttribute("aria-busy", "false");
    detail.className = "game-detail-card";
    detail.innerHTML = `
      <div class="detail-hero">
        <div class="detail-thumbnail">
          ${thumbnailUrl
            ? `<img src="${escapeHtml(thumbnailUrl)}" alt="${safeTitle} 대표 이미지">`
            : "게임 이미지 준비 중"}
        </div>
        <div>
          <span class="detail-team-chip">${teamNumber}팀${teamName ? ` · ${escapeHtml(teamName)}` : ""}</span>
          <div class="detail-title-row">
            <h2>${safeTitle}</h2>
            <span class="detail-vote-status${votingOpen ? "" : " is-closed"}">${votingOpen ? "투표 진행 중" : "투표 준비 중"}</span>
          </div>
          <p class="detail-summary">${escapeHtml(description)}</p>
        </div>
      </div>

      <div class="detail-actions">
        <button class="button button-secondary detail-play-button" type="button" data-url="${escapeHtml(gameUrl)}" ${gameUrl ? "" : "disabled"}>${gameUrl ? "게임하기" : "게임 주소 준비 중"}</button>
        <button class="button button-primary detail-vote-button" type="button" ${voteDisabled ? "disabled" : ""}>${voteLabel()}</button>
        <a class="button button-secondary detail-more-games-button" href="/">다른 작품 보러가기</a>
      </div>

      <section class="detail-qr-section" aria-labelledby="detailQrTitle">
        <img class="detail-qr-image" src="/images/game-qr/team-${teamNumber}.png" alt="${safeTitle} 상세페이지 QR 코드" width="188" height="188">
        <div class="detail-qr-fallback" hidden>QR 코드를 준비하지 못했습니다.</div>
        <div class="detail-qr-copy">
          <h3 id="detailQrTitle">이 게임을 소개해 보세요</h3>
          <p>이 QR을 스캔하면 이 게임의 상세 페이지로 바로 이동합니다. 상세 페이지에서 게임을 실행하고 투표할 수 있습니다.</p>
          <code class="detail-url">${escapeHtml(url)}</code>
          <a class="detail-qr-download" href="/images/game-qr/team-${teamNumber}.pdf" download="${teamNumber}team-game-detail-qr.pdf">QR PDF 저장</a>
        </div>
      </section>
    `;

    document.title = `${title} · 게임 상세 · 청소년 AI게임개발 헤커톤`;
    bindDetailActions();
  }

  function bindDetailActions() {
    detail.querySelector(".detail-play-button")?.addEventListener("click", event => {
      const url = event.currentTarget.dataset.url;
      if (!url) {
        showToast("게임 주소가 아직 등록되지 않았습니다.");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    });

    detail.querySelector(".detail-vote-button")?.addEventListener("click", () => {
      if (!currentGame || !votingOpen || hasVoted) {
        showToast(hasVoted ? "이미 투표하셨습니다." : "현재 투표가 진행 중이 아닙니다.");
        return;
      }

      dialogText.textContent = `${currentGame.teamNumber}팀 ${currentGame.title}에 투표하시겠습니까?`;
      dialog.showModal();
    });

    detail.querySelector(".detail-qr-image")?.addEventListener("error", event => {
      event.currentTarget.hidden = true;
      detail.querySelector(".detail-qr-fallback").hidden = false;
    }, { once: true });
  }

  async function loadDetail() {
    if (loading) return;

    if (!isValidTeamNumber(requestedTeamNumber)) {
      status.textContent = "게임 주소를 확인해 주세요.";
      renderMessage("게임을 찾을 수 없습니다.", "올바른 게임 상세 주소로 다시 접속해 주세요.");
      return;
    }

    loading = true;
    status.textContent = "게임 정보를 불러오는 중입니다.";
    detail.setAttribute("aria-busy", "true");

    try {
      const data = await window.HackathonAPI.getPublicGames();
      votingOpen = Boolean(data.votingOpen);

      if (!data.plazaOpen) {
        status.textContent = "게임 광장이 현재 닫혀 있습니다.";
        renderMessage("게임 광장 준비 중", "게임 광장이 열리면 이 작품의 상세 정보를 볼 수 있습니다.");
        return;
      }

      const game = (Array.isArray(data.games) ? data.games : []).find(
        item => Number(item.teamNumber) === requestedTeamNumber
      );

      if (!game) {
        status.textContent = "공개 중인 게임을 찾지 못했습니다.";
        renderMessage("게임을 찾을 수 없습니다.", "작품이 아직 공개되지 않았거나 공개가 종료되었습니다.");
        return;
      }

      currentGame = game;
      status.textContent = "공개 작품 상세를 보고 있습니다.";
      renderGame(game);
    } catch (error) {
      console.error("Game detail load failed:", error);
      status.textContent = "게임 정보를 불러오지 못했습니다.";
      renderMessage("연결을 확인해 주세요.", "잠시 후 다시 접속하거나 게임 광장으로 돌아가 주세요.");
    } finally {
      loading = false;
    }
  }

  async function submitVote() {
    if (!currentGame || voteSubmitting || hasVoted) return;

    voteSubmitting = true;
    confirmVoteButton.disabled = true;
    confirmVoteButton.textContent = "처리 중…";

    try {
      const result = await window.HackathonAPI.castVote(Number(currentGame.teamId));
      hasVoted = true;
      saveVoteState();
      dialog.close();
      showToast(result.message || "투표가 완료되었습니다.");
      renderGame(currentGame);
    } catch (error) {
      dialog.close();

      if (error.status === 409) {
        hasVoted = true;
        saveVoteState();
        showToast("이미 투표하셨습니다.");
        renderGame(currentGame);
      } else if (error.status === 403) {
        votingOpen = false;
        showToast("현재 투표가 진행 중이 아닙니다.");
        renderGame(currentGame);
      } else if (error.status === 401) {
        try {
          const session = await window.HackathonAPI.registerVisitor();
          hasVoted = Boolean(session.hasVoted);
          if (hasVoted) saveVoteState();
          showToast("방문객 연결을 새로 만들었습니다. 다시 투표해 주세요.");
          await loadDetail();
        } catch {
          showToast("방문객 연결을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.");
        }
      } else if (error.status === 429) {
        showToast("요청이 많습니다. 잠시 후 다시 시도해 주세요.");
      } else {
        console.error("Game detail vote failed:", error);
        showToast(error.message || "투표 처리 중 오류가 발생했습니다.");
      }
    } finally {
      voteSubmitting = false;
      confirmVoteButton.disabled = false;
      confirmVoteButton.textContent = "투표하기";
    }
  }

  confirmVoteButton.addEventListener("click", event => {
    event.preventDefault();
    submitVote();
  });

  window.addEventListener("hackathon:visitor-ready", event => {
    hasVoted = Boolean(event.detail?.hasVoted);
    if (hasVoted) saveVoteState();
    loadDetail();
  }, { once: true });

  window.addEventListener("hackathon:visitor-error", () => {
    loadDetail();
  }, { once: true });

  if (window.HackathonVisitor?.ready) {
    hasVoted = Boolean(window.HackathonVisitor.hasVoted);
    if (hasVoted) saveVoteState();
    loadDetail();
  }
})();
