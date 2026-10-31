(() => {
  const games = document.getElementById("displayGames");
  const visitors = document.getElementById("displayVisitors");
  const voting = document.getElementById("displayVoting");
  const status = document.getElementById("displayStatus");
  const statusContainer = status.parentElement;
  let inFlight = false;
  let hasData = false;

  function count(value) {
    if (value === null || value === undefined || value === "") return "—";
    const number = Number(value);
    return Number.isFinite(number) && number >= 0
      ? Math.floor(number).toLocaleString("ko-KR")
      : "—";
  }

  async function loadStatus() {
    if (inFlight) return;
    inFlight = true;

    try {
      const response = await fetch("/api/status", {
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
      const data = await response.json();
      if (!response.ok || data.ok !== true) {
        throw new Error(data.message || `HTTP ${response.status}`);
      }

      games.textContent = count(data.gameCount);
      visitors.textContent = count(data.visitorCount);
      voting.textContent = data.votingOpen ? "진행 중" : "준비 중";
      hasData = true;
      statusContainer.classList.toggle("is-error", Boolean(data.stale));
      statusContainer.classList.toggle("is-connected", !data.stale);
      status.textContent = data.stale
        ? "원격 연결이 끊겨 마지막 정상 데이터를 표시하고 있습니다."
        : "운영 현황 연결됨 · 10초마다 자동 갱신";
    } catch (error) {
      console.error("Local TV status failed:", error);
      statusContainer.classList.remove("is-connected");
      statusContainer.classList.add("is-error");
      status.textContent = hasData
        ? "연결이 끊겼습니다. 마지막 정상 데이터를 표시하고 있습니다."
        : "운영 현황을 불러오지 못했습니다. 다시 연결하는 중입니다.";
    } finally {
      inFlight = false;
    }
  }

  loadStatus();
  window.setInterval(loadStatus, 10000);
})();
