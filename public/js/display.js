(() => {
  const status = document.getElementById("displayStatus");
  const plazaQr = document.getElementById("plazaQr");
  const qrTargetUrl = new URL("/", window.location.origin).href;

  if (plazaQr) {
    const qrParams = new URLSearchParams({
      text: qrTargetUrl,
      size: "238",
      margin: "2"
    });
    plazaQr.src = "https://quickchart.io/qr?" + qrParams.toString();
    plazaQr.addEventListener("error", () => {
      plazaQr.alt = "게임 광장 주소: " + qrTargetUrl;
      plazaQr.hidden = true;
    }, { once: true });
  }
  const statusContainer = status.parentElement;
  const loginLink = document.getElementById("displayLoginLink");
  const games = document.getElementById("displayGames");
  const visitors = document.getElementById("displayVisitors");
  const votes = document.getElementById("displayVotes");
  let inFlight = false;
  let hasCurrentStats = false;

  function count(value) {
    if (value === null || value === undefined || value === "") return "—";
    const number = Number(value);
    return Number.isFinite(number) && number >= 0
      ? Math.floor(number).toLocaleString("ko-KR")
      : "—";
  }

  function setStatus(message) {
    if (status.textContent !== message) status.textContent = message;
  }

  async function render() {
    if (inFlight) return;
    inFlight = true;

    try {
      const stats = await window.HackathonAPI.getStats();
      games.textContent = count(stats.published);
      visitors.textContent = count(stats.visitors);
      votes.textContent = count(stats.votes);
      hasCurrentStats = true;
      setStatus("운영 현황 연결됨 · 3초마다 자동 갱신");
      statusContainer.classList.remove("is-error");
      statusContainer.classList.add("is-connected");
      loginLink.hidden = true;
    } catch (error) {
      statusContainer.classList.remove("is-connected");
      statusContainer.classList.add("is-error");

      if (error?.status === 401 || error?.status === 403) {
        games.textContent = "—";
        visitors.textContent = "—";
        votes.textContent = "—";
        hasCurrentStats = false;
        setStatus("통계를 보려면 관리자 로그인이 필요합니다. 로그인 후 현장 화면으로 돌아오세요.");
        loginLink.hidden = false;
        clearInterval(refreshTimer);
      } else {
        setStatus(hasCurrentStats
          ? "통계 연결이 끊겼습니다. 마지막 확인 값을 표시하며 다시 시도합니다."
          : "통계를 불러올 수 없습니다. 잠시 후 자동으로 다시 시도합니다.");
      }
    } finally {
      inFlight = false;
    }
  }

  const refreshTimer = setInterval(render, 3000);
  render();
})();
