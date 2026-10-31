(function () {
  // A session POST is intentionally sent only once per page load.
  // Retrying an ambiguous network failure can create a second visitor row
  // after the first request was already committed by the Worker.
  let sessionRequest = null;

  function createVisitorSession() {
    if (!sessionRequest) {
      sessionRequest = window.HackathonAPI.registerVisitor();
    }

    return sessionRequest;
  }

  async function initVisitor() {
    try {
      const session = await createVisitorSession();

      window.HackathonVisitor = {
        ready: true,
        existing: Boolean(session.existing),
        // 투표 여부는 localStorage가 아니라 서버의 visitor_id 기록을 기준으로 한다.
        hasVoted: Boolean(session.hasVoted)
      };

      window.dispatchEvent(
        new CustomEvent("hackathon:visitor-ready", {
          detail: window.HackathonVisitor
        })
      );
    } catch (error) {
      console.error("Visitor session error:", error);

      window.HackathonVisitor = {
        ready: false,
        error
      };

      window.dispatchEvent(
        new CustomEvent("hackathon:visitor-error", {
          detail: { error }
        })
      );
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initVisitor, { once: true });
  } else {
    initVisitor();
  }
})();
