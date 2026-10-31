(() => {
  const grid =
    document.getElementById(
      "gameGrid"
    );

  const gameCount =
    document.getElementById(
      "gameCount"
    );

  const rotationStatus =
    document.getElementById(
      "rotationStatus"
    );

  const voteStatus =
    document.getElementById(
      "voteStatus"
    );

  const refreshButton =
    document.getElementById(
      "refreshButton"
    );

  const dialog =
    document.getElementById(
      "voteDialog"
    );

  const dialogText =
    document.getElementById(
      "voteDialogText"
    );

  const confirmVoteButton =
    document.getElementById(
      "confirmVoteButton"
    );

  const toast =
    document.getElementById(
      "toast"
    );


  let selectedGame = null;

  let loading = false;

  let voteSubmitting = false;

  let votingOpen = false;
  const VOTE_STATE_KEY = "hackathon_vote_cast";
  const VOTE_COOKIE_KEY = "hackathon_vote_ui";

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

  let rotationTimer = null;
  const SHUFFLE_SLOT_MS = 5 * 60 * 1000;
  let serverClockOffsetMs = 0;

  function currentShuffleTime() {
    return Date.now() + serverClockOffsetMs;
  }

  function shuffleGamesForSlot(games, slot) {
    // 서버의 3분 순서와 무관하게, 같은 명단에는 같은 기본 순서를 사용합니다.
    const roster = [...games].sort((a, b) => Number(a.teamId) - Number(b.teamId));
    if (roster.length < 2) {
      return roster;
    }

    const cycle = Math.floor(slot / roster.length);
    const seed = `${cycle}:${roster.map(game => game.teamId).join(",")}`;
    let randomState = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      randomState = Math.imul(randomState ^ seed.charCodeAt(i), 16777619);
    }
    randomState ||= 1;

    // 한 순환 동안 모든 팀이 모든 위치에 한 번씩 나타나도록 섞은 뒤 회전합니다.
    // 첫 팀을 기준점으로 두면 순환 경계에서도 이전 슬롯과 같은 순서가 되지 않습니다.
    const shuffled = [roster[0], ...roster.slice(1)];
    for (let i = shuffled.length - 1; i > 1; i--) {
      randomState ^= randomState << 13;
      randomState ^= randomState >>> 17;
      randomState ^= randomState << 5;
      const j = 1 + Math.floor(((randomState >>> 0) / 4294967296) * i);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const offset = slot % shuffled.length;
    return shuffled.slice(offset).concat(shuffled.slice(0, offset));
  }

  function scheduleRotation() {
    clearTimeout(rotationTimer);

    const now = currentShuffleTime();
    const nextSlotAt = (Math.floor(now / SHUFFLE_SLOT_MS) + 1) * SHUFFLE_SLOT_MS;
    const delay = Math.max(1000, nextSlotAt - now + 250);

    // 같은 5분 구간에서는 순서를 유지하고, 다음 구간 경계에서만 새 명단을 받습니다.
    rotationTimer = setTimeout(() => {
      if (
        document.visibilityState === "visible" &&
        window.HackathonVisitor?.ready
      ) {
        loadPlaza();
      }
    }, delay);
  }


  // ==================================================
  // HTML ESCAPE
  // ==================================================

  function escapeHtml(value) {
    return String(
      value ?? ""
    ).replace(
      /[&<>"']/g,
      char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[char]
    );
  }


  // ==================================================
  // TOAST
  // ==================================================

  let toastTimer = null;


  function showToast(message) {
    if (!toast) {
      return;
    }

    toast.textContent =
      message;

    toast.classList.add(
      "show"
    );


    if (toastTimer) {
      clearTimeout(
        toastTimer
      );
    }


    toastTimer =
      setTimeout(
        () => {
          toast.classList.remove(
            "show"
          );
        },
        2600
      );
  }


  // ==================================================
  // STATUS
  // ==================================================

  function updateVoteStatus(
    isOpen
  ) {
    votingOpen =
      Boolean(isOpen);


    voteStatus.textContent =
      votingOpen
        ? "투표 진행 중"
        : "투표 준비 중";


    voteStatus.className =
      `status-badge ${
        votingOpen
          ? "status-on"
          : "status-off"
      }`;
  }


  // ==================================================
  // EMPTY MESSAGE
  // ==================================================

  function renderEmpty(
    plazaOpen
  ) {
    grid.innerHTML = `
      <div class="panel">
        <h3>
          ${
            plazaOpen
              ? "아직 공개된 작품이 없습니다."
              : "게임 광장이 아직 열리지 않았습니다."
          }
        </h3>

        <p class="muted">
          ${
            plazaOpen
              ? "작품이 공개되면 이곳에 자동으로 표시됩니다."
              : "운영진이 광장을 열면 참가 작품을 볼 수 있습니다."
          }
        </p>
      </div>
    `;
  }


  // ==================================================
  // GAME CARDS
  // ==================================================

  function renderGames(
    games,
    plazaOpen,
    isVotingOpen
  ) {
    const activeButton = document.activeElement;
    const focusedCard = grid.contains(activeButton)
      ? activeButton.closest(".game-card")
      : null;
    const focusTeamId = focusedCard?.dataset.teamId;
    const focusClass = activeButton?.classList.contains("vote-button")
      ? "vote-button"
      : "play-button";

    gameCount.textContent =
      String(games.length);


    updateVoteStatus(
      isVotingOpen
    );


    if (
      !Array.isArray(games) ||
      games.length === 0
    ) {
      renderEmpty(
        plazaOpen
      );

      return;
    }


    grid.innerHTML =
      games.map(game => {
        const title =
          escapeHtml(
            game.title ||
            `${game.teamNumber}팀 게임`
          );

        const description =
          escapeHtml(
            game.description || ""
          );

        const teamName =
          escapeHtml(
            game.teamName || ""
          );

        const gameUrl =
          escapeHtml(
            game.gameUrl || ""
          );

        const thumbnailUrl =
          escapeHtml(
            game.thumbnailUrl || ""
          );

        const detailUrl =
          `/game?team=${Number(game.teamNumber)}`;


        return `
          <article class="game-card" data-team-id="${Number(game.teamId)}">

            <a
              class="game-thumb"
              href="${detailUrl}"
              aria-label="${title} 상세 보기"
            >
              ${
                thumbnailUrl
                  ? `
                    <img
                      src="${thumbnailUrl}"
                      alt="${title} 대표 이미지"
                      loading="lazy"
                    >
                  `
                  : "게임 이미지 준비 중"
              }
            </a>

            <div class="game-card-body">

              <span class="team-chip">
                ${game.teamNumber}팀
                ${
                  teamName
                    ? ` · ${teamName}`
                    : ""
                }
              </span>

              <h3>
                <a class="game-title-link" href="${detailUrl}">
                  <span class="game-title-name">${title}</span>
                  <span class="game-title-detail">상세 보기</span>
                </a>
              </h3>

              <p class="muted">
                ${description}
              </p>

              <div class="card-actions">

                <button
                  class="button button-secondary play-button"
                  type="button"
                  data-url="${gameUrl}"
                >
                  게임하기
                </button>

                <button
                  class="button button-primary vote-button"
                  type="button"
                  data-id="${Number(game.teamId)}"
                  data-team="${Number(game.teamNumber)}"
                  data-title="${title}"
                  ${
                    isVotingOpen && !hasVoted
                      ? ""
                      : "disabled"
                  }
                >
                  ${hasVoted ? "투표 완료" : "투표하기"}
                </button>

              </div>

            </div>

          </article>
        `;
      }).join("");


    bindGameButtons();

    if (focusTeamId) {
      grid.querySelector(
        `.game-card[data-team-id="${Number(focusTeamId)}"] .${focusClass}`
      )?.focus({ preventScroll: true });
    }
  }


  // ==================================================
  // BUTTON EVENTS
  // ==================================================

  function bindGameButtons() {
    grid
      .querySelectorAll(
        ".play-button"
      )
      .forEach(button => {
        button.addEventListener(
          "click",
          () => {
            const url =
              button.dataset.url;

            if (!url) {
              showToast(
                "게임 주소가 아직 등록되지 않았습니다."
              );

              return;
            }


            window.open(
              url,
              "_blank",
              "noopener,noreferrer"
            );
          }
        );
      });


    grid
      .querySelectorAll(
        ".vote-button"
      )
      .forEach(button => {
        button.addEventListener(
          "click",
          () => {
            if (!votingOpen || hasVoted) {
              showToast(
                "현재 투표가 진행 중이 아닙니다."
              );

              return;
            }


            selectedGame = {
              teamId:
                Number(
                  button.dataset.id
                ),

              teamNumber:
                Number(
                  button.dataset.team
                ),

              title:
                button.dataset.title
            };


            dialogText.textContent =
              `${selectedGame.teamNumber}팀 「${selectedGame.title}」에 투표하시겠습니까?`;


            dialog.showModal();
          }
        );
      });
  }


  // ==================================================
  // LOAD PLAZA
  // ==================================================

  async function loadPlaza() {
    if (loading) {
      return;
    }


    loading = true;

    clearTimeout(rotationTimer);
    const requestStarted = performance.now();
    let rotation = null;

    refreshButton.disabled =
      true;


    try {
      const data =
        await window
          .HackathonAPI
          .getPublicGames();

      rotation = data.rotation;

      const serverTime = Number(rotation?.serverTime);
      if (Number.isFinite(serverTime) && serverTime > 0) {
        // 응답 왕복 시간의 절반을 보정해 방문객의 기기 시계 차이를 줄입니다.
        serverClockOffsetMs = serverTime + (performance.now() - requestStarted) / 2 - Date.now();
      }

      const games = Array.isArray(data.games) ? data.games : [];
      const now = currentShuffleTime();
      const slot = Math.floor(now / SHUFFLE_SLOT_MS);
      if (games.length < 2) {
        rotationStatus.textContent = games.length === 1
          ? "공개 작품이 1개라 순서가 그대로예요."
          : "공개 작품을 기다리고 있어요.";
      } else {
        const seconds = Math.max(0, Math.ceil(
          ((slot + 1) * SHUFFLE_SLOT_MS - now) / 1000
        ));
        rotationStatus.textContent =
          `5분마다 자동 변경 · 다음 변경까지 ${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
      }



      renderGames(
        shuffleGamesForSlot(games, slot),

        Boolean(
          data.plazaOpen
        ),

        Boolean(
          data.votingOpen
        )
      );
    } catch (error) {
      console.error(
        "Plaza load failed:",
        error
      );


      showToast(
        "광장 데이터를 불러오지 못했습니다."
      );

      rotationStatus.textContent = "작품 순서 정보를 확인할 수 없습니다.";


      grid.innerHTML = `
        <div class="panel">

          <h3>
            데이터를 불러오지 못했습니다.
          </h3>

          <p class="muted">
            잠시 후 새로고침해 주세요.
          </p>

        </div>
      `;
    } finally {
      loading = false;

      refreshButton.disabled =
        false;

      scheduleRotation();
    }
  }


  // ==================================================
  // VOTE
  // ==================================================

  async function submitVote() {
    if (
      !selectedGame ||
      voteSubmitting ||
      hasVoted
    ) {
      return;
    }


    voteSubmitting = true;

    confirmVoteButton.disabled =
      true;

    confirmVoteButton.textContent =
      "처리 중...";


    try {
      const result =
        await window
          .HackathonAPI
          .castVote(
            selectedGame.teamId
          );


      dialog.close();


      showToast(
        result.message ||
        "투표가 완료되었습니다."
      );

      hasVoted = true;
      saveVoteState();


      // 성공하면 같은 브라우저에서
      // 불필요하게 다시 누르지 않게 UX 차단.
      // 실제 최종 차단은 서버 DB UNIQUE가 담당.
      document
        .querySelectorAll(
          ".vote-button"
        )
        .forEach(button => {
          button.disabled =
            true;

          button.textContent =
            "투표 완료";
        });


      await loadPlaza();
    } catch (error) {
      dialog.close();


      if (
        error.status === 409
      ) {
        hasVoted = true;
        saveVoteState();
        showToast(
          "이미 투표하셨습니다."
        );


        document
          .querySelectorAll(
            ".vote-button"
          )
          .forEach(button => {
            button.disabled =
              true;
          });
      } else if (
        error.status === 429
      ) {
        showToast(
          "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요."
        );
      } else if (
        error.status === 403
      ) {
        showToast(
          "현재 투표가 진행 중이 아닙니다."
        );

        updateVoteStatus(
          false
        );
      } else if (
        error.status === 401
      ) {
        showToast(
          "방문객 세션을 다시 만드는 중입니다."
        );


        try {
          await window
            .HackathonAPI
            .registerVisitor();

          await loadPlaza();
        } catch {
          showToast(
            "방문객 세션을 만들지 못했습니다."
          );
        }
      } else {
        console.error(
          "Vote failed:",
          error
        );

        showToast(
          error.message ||
          "투표 처리 중 오류가 발생했습니다."
        );
      }
    } finally {
      voteSubmitting = false;

      confirmVoteButton.disabled =
        false;

      confirmVoteButton.textContent =
        "투표하기";

      selectedGame = null;
    }
  }


  // ==================================================
  // EVENTS
  // ==================================================

  document.addEventListener("visibilitychange", () => {
    clearTimeout(rotationTimer);
    if (document.visibilityState === "visible" && window.HackathonVisitor?.ready) {
      loadPlaza();
    }
  });

  window.addEventListener("pageshow", event => {
    if (event.persisted && window.HackathonVisitor?.ready) {
      loadPlaza();
    }
  });

  confirmVoteButton
    .addEventListener(
      "click",
      event => {
        event.preventDefault();

        submitVote();
      }
    );


  refreshButton
    .addEventListener(
      "click",
      () => {
        loadPlaza();
      }
    );


  window.addEventListener(
    "hackathon:visitor-ready",
    event => {
      // localStorage·sessionStorage의 표시값은 삭제될 수 있으므로,
      // 같은 방문객 쿠키에 연결된 서버 기록을 우선한다.
      hasVoted = Boolean(event.detail?.hasVoted);

      if (hasVoted) {
        saveVoteState();
      }

      loadPlaza();
    },
    {
      once: true
    }
  );


  window.addEventListener(
    "hackathon:visitor-error",
    event => {
      console.error(
        "Visitor init failed:",
        event.detail?.error
      );

      showToast(
        "방문객 연결에 실패했습니다."
      );

      // 세션이 실패해도 공개 작품은 읽을 수 있어야 합니다.
      loadPlaza();
    },
    {
      once: true
    }
  );


  // visitor.js가 먼저 완료된 경우도 처리
  if (
    window.HackathonVisitor?.ready
  ) {
    hasVoted = Boolean(
      window.HackathonVisitor.hasVoted
    );

    if (hasVoted) {
      saveVoteState();
    }

    loadPlaza();
  }
})();
