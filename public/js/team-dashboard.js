(() => {
  const api =
    window.HackathonAPI;

  const els = {
    teamLabel:
      document.getElementById(
        "teamLabel"
      ),

    status:
      document.getElementById(
        "submissionStatus"
      ),

    title:
      document.getElementById(
        "gameTitle"
      ),

    description:
      document.getElementById(
        "gameDescription"
      ),

    url:
      document.getElementById(
        "gameUrl"
      ),

    image:
      document.getElementById(
        "gameImage"
      ),

    previewImage:
      document.getElementById(
        "previewImage"
      ),

    previewTeam:
      document.getElementById(
        "previewTeam"
      ),

    previewTitle:
      document.getElementById(
        "previewTitle"
      ),

    previewDescription:
      document.getElementById(
        "previewDescription"
      ),

    message:
      document.getElementById(
        "submissionMessage"
      ),

    saveDraftButton:
      document.getElementById(
        "saveDraftButton"
      ),

    submitButton:
      document.getElementById(
        "submitButton"
      ),

    deleteActions:
      document.getElementById(
        "deleteSubmissionActions"
      ),

    deleteButton:
      document.getElementById(
        "deleteSubmissionButton"
      )
  };


  let thumbnailUrl = "";
  let localImageDataUrl = "";
  let currentStatus = "draft";
  let plazaOpen = null;
  let plazaStatusError = false;
  let plazaStatusLoading = false;
  let plazaStatusRefreshQueued = false;
  let hasSubmission = false;
  let busy = false;
  let imageSelection = 0;
  const maxImageBytes = 1024 * 1024;
  const allowedImageTypes = new Set([
    "image/jpeg",
    "image/png",
    "image/webp"
  ]);

  function syncControls() {
    const disabled = busy || currentStatus === "published";
    [
      els.title,
      els.description,
      els.url,
      els.image,
      els.saveDraftButton,
      els.submitButton
    ].forEach(element => {
      element.disabled = disabled;
    });

    const canDelete = hasSubmission && currentStatus !== "published";
    els.deleteActions.classList.toggle("hidden", !canDelete);
    els.deleteButton.disabled = busy || !canDelete;
  }

  function imageError(file) {
    if (!allowedImageTypes.has(file.type)) {
      return "JPEG, PNG, WebP 이미지 파일만 선택할 수 있습니다.";
    }
    if (file.size === 0 || file.size > maxImageBytes) {
      return "대표 이미지는 1MB 이하의 파일을 선택해 주세요.";
    }
    return "";
  }


  function updateStatus(status) {
    currentStatus =
      status || "draft";

    const labels = {
      draft:
        "작성 중",

      submitted:
        "제출 완료"
    };

    if (currentStatus === "published") {
      renderPublishedStatus();
      syncControls();
      return;
    }

    els.status.textContent =
      labels[currentStatus] ||
      "작성 중";


    els.status.className =
      `status-badge ${
        currentStatus === "draft"
          ? "status-draft"
          : "status-on"
      }`;


    syncControls();

    if (currentStatus === "submitted") {
      els.message.textContent =
        "최종 제출되었습니다. 공개 전에는 수정하거나 삭제할 수 있습니다. 내용을 바꾼 뒤 최종 제출을 다시 눌러 주세요.";
    }
  }

  function renderPublishedStatus() {
    if (currentStatus !== "published") {
      return;
    }

    if (plazaOpen === true) {
      els.status.textContent = "광장 공개 중";
      els.message.textContent =
        "현재 광장에 공개된 작품입니다. 수정이 필요하면 운영진에게 문의해 주세요.";
    } else if (plazaOpen === false) {
      els.status.textContent = "광장 닫힘";
      els.message.textContent =
        "작품은 공개 승인되었지만 현재 광장이 닫혀 있습니다. 광장이 열리면 다시 표시됩니다. 수정이 필요하면 운영진에게 문의해 주세요.";
    } else {
      els.status.textContent = plazaStatusError
        ? "상태 확인 불가"
        : "상태 확인 중";
      els.message.textContent = plazaStatusError
        ? "작품은 공개 승인되었습니다. 광장 개폐 상태를 확인하지 못했습니다. 잠시 후 다시 확인합니다. 수정이 필요하면 운영진에게 문의해 주세요."
        : "작품은 공개 승인되었습니다. 광장 개폐 상태를 확인 중입니다. 수정이 필요하면 운영진에게 문의해 주세요.";
    }

    els.status.className =
      `status-badge ${plazaOpen === true ? "status-on" : "status-off"}`;
  }

  async function refreshPlazaStatus() {
    if (plazaStatusLoading) {
      plazaStatusRefreshQueued = true;
      return;
    }

    plazaStatusLoading = true;
    try {
      const data = await api.getPublicGames();
      if (!plazaStatusRefreshQueued) {
        plazaOpen = typeof data?.plazaOpen === "boolean"
          ? data.plazaOpen
          : null;
        plazaStatusError = plazaOpen === null;
        renderPublishedStatus();
      }
    } catch (error) {
      console.error("Plaza status load failed:", error);
      if (!plazaStatusRefreshQueued) {
        plazaOpen = null;
        plazaStatusError = true;
        renderPublishedStatus();
      }
    } finally {
      plazaStatusLoading = false;
      if (plazaStatusRefreshQueued) {
        plazaStatusRefreshQueued = false;
        if (document.visibilityState !== "hidden") {
          refreshPlazaStatus();
        }
      }
    }
  }


  function updatePreview() {
    els.previewTitle.textContent =
      els.title.value.trim() ||
      "게임 제목";


    els.previewDescription.textContent =
      els.description.value.trim() ||
      "게임 소개가 여기에 표시됩니다.";


    const imageUrl = localImageDataUrl || thumbnailUrl;
    if (imageUrl) {
      const image = document.createElement("img");
      image.src = imageUrl;
      image.alt = "";
      els.previewImage.replaceChildren(image);
    } else {
      els.previewImage.textContent =
        "GAME";
    }
  }


  function collect(imageUrl = thumbnailUrl) {
    return {
      title:
        els.title.value.trim(),

      description:
        els.description.value.trim(),

      gameUrl:
        els.url.value.trim(),

      thumbnailUrl: imageUrl
    };
  }


  async function loadDashboard() {
    try {
      const [me, submissionData] =
        await Promise.all([
          api.getTeamMe(),
          api.getTeamSubmission()
        ]);


      const team =
        me.team;


      els.teamLabel.textContent =
        `${team.teamNumber}팀`;

      els.previewTeam.textContent =
        `${team.teamNumber}팀`;


      if (team.teamName) {
        els.previewTeam.textContent +=
          ` · ${team.teamName}`;
      }


      const submission =
        submissionData.submission;

      hasSubmission = Boolean(submission);


      if (submission) {
        els.title.value =
          submission.title || "";

        els.description.value =
          submission.description || "";

        els.url.value =
          submission.gameUrl || "";

        thumbnailUrl =
          submission.thumbnailUrl || "";

        updateStatus(
          submission.status
        );
      } else {
        updateStatus(
          "draft"
        );
      }


      updatePreview();
      refreshPlazaStatus();
    } catch (error) {
      if (
        error.status === 401
      ) {
        sessionStorage.removeItem(
          "hackathon_team_token"
        );

        location.href =
          "/team/login";

        return;
      }


      console.error(
        "Team dashboard load failed:",
        error
      );

      els.message.textContent =
        error.message ||
        "팀 정보를 불러오지 못했습니다.";
    }
  }


  ["input", "change"].forEach(
    eventName => {
      els.title.addEventListener(
        eventName,
        updatePreview
      );

      els.description.addEventListener(
        eventName,
        updatePreview
      );
    }
  );


  els.image.addEventListener(
    "change",
    () => {
      imageSelection += 1;
      const selectedAt = imageSelection;
      const file =
        els.image.files?.[0];

      if (!file) {
        localImageDataUrl = "";
        updatePreview();
        return;
      }


      const error = imageError(file);
      if (error) {
        els.image.value = "";
        localImageDataUrl = "";
        updatePreview();
        els.message.textContent = error;
        return;
      }


      const reader =
        new FileReader();


      reader.onload = () => {
        if (selectedAt !== imageSelection) {
          return;
        }
        localImageDataUrl =
          String(
            reader.result || ""
          );

        updatePreview();

        els.message.textContent =
          "대표 이미지를 선택했습니다. 임시 저장 또는 최종 제출을 누르면 업로드됩니다.";
      };

      reader.onerror = () => {
        if (selectedAt !== imageSelection) {
          return;
        }
        els.image.value = "";
        localImageDataUrl = "";
        updatePreview();
        els.message.textContent = "이미지를 읽지 못했습니다. 다른 파일을 선택해 주세요.";
      };


      reader.readAsDataURL(
        file
      );
    }
  );


  async function save(
    submit
  ) {
    if (
      busy ||
      currentStatus ===
        "published"
    ) {
      return;
    }


    if (
      submit &&
      !els.title.value.trim()
    ) {
      els.message.textContent =
        "게임 제목을 입력하세요.";

      return;
    }


    if (
      els.url.value &&
      !els.url.checkValidity()
    ) {
      els.message.textContent =
        "게임 주소를 올바른 URL 형식으로 입력하세요.";

      return;
    }

    const file = els.image.files?.[0];
    if (file) {
      const error = imageError(file);
      if (error) {
        els.message.textContent = error;
        return;
      }
    }


    busy = true;
    syncControls();

    els.message.textContent =
      submit
        ? "최종 제출 중..."
        : "임시 저장 중...";


    try {
      let nextThumbnailUrl = thumbnailUrl;
      if (file) {
        const upload = await api.uploadTeamThumbnail(file);
        if (
          upload?.ok !== true ||
          typeof upload.thumbnailUrl !== "string" ||
          !upload.thumbnailUrl.startsWith("/api/public/thumbnails/")
        ) {
          throw new Error("이미지 업로드 결과를 확인할 수 없습니다. 다시 시도해 주세요.");
        }
        nextThumbnailUrl = upload.thumbnailUrl;
      }

      const result =
        await api.saveTeamSubmission(
          collect(nextThumbnailUrl),
          submit
        );


      thumbnailUrl = result.submission.thumbnailUrl || nextThumbnailUrl;
      hasSubmission = true;
      imageSelection += 1;
      els.image.value = "";
      localImageDataUrl = "";

      updateStatus(
        result.submission.status
      );
      updatePreview();


      els.message.textContent =
        submit
          ? "최종 제출되었습니다. 공개 전에는 수정하거나 삭제할 수 있습니다. 내용을 바꾼 뒤 최종 제출을 다시 눌러 주세요."
          : "임시 저장이 완료되었습니다.";
    } catch (error) {
      if (
        error.status === 401
      ) {
        sessionStorage.removeItem(
          "hackathon_team_token"
        );

        location.href =
          "/team/login";

        return;
      }


      els.message.textContent =
        error.message ||
        "저장 중 오류가 발생했습니다.";
    } finally {
      busy = false;
      syncControls();
    }
  }


  async function deleteSubmission() {
    if (busy || !hasSubmission || currentStatus === "published") {
      return;
    }

    if (!window.confirm("저장된 작품을 삭제할까요? 제목, 소개, 게임 주소, 대표 이미지가 지워지며 이 작업은 되돌릴 수 없습니다.")) {
      return;
    }

    busy = true;
    syncControls();
    els.message.textContent = "작품을 삭제하는 중...";
    let deleted = false;

    try {
      const result = await api.deleteTeamSubmission();
      if (result?.ok !== true) {
        throw new Error("삭제 결과를 확인할 수 없습니다. 다시 시도해 주세요.");
      }

      imageSelection += 1;
      els.title.value = "";
      els.description.value = "";
      els.url.value = "";
      els.image.value = "";
      thumbnailUrl = "";
      localImageDataUrl = "";
      hasSubmission = false;
      updateStatus("draft");
      updatePreview();
      deleted = true;
      els.message.textContent = "작품을 삭제했습니다. 새 작품을 처음부터 등록할 수 있습니다.";
    } catch (error) {
      if (error.status === 401) {
        sessionStorage.removeItem("hackathon_team_token");
        location.href = "/team/login";
        return;
      }

      els.message.textContent = error.message || "작품을 삭제하지 못했습니다. 다시 시도해 주세요.";
    } finally {
      busy = false;
      syncControls();
      if (deleted) {
        els.title.focus();
      }
    }
  }


  els.saveDraftButton
    .addEventListener(
      "click",
      () => save(false)
    );


  els.submitButton
    .addEventListener(
      "click",
      () => save(true)
    );

  els.deleteButton.addEventListener("click", deleteSubmission);


  loadDashboard();

  setInterval(() => {
    if (document.visibilityState !== "hidden") {
      refreshPlazaStatus();
    }
  }, 15000);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refreshPlazaStatus();
    }
  });

  window.addEventListener("focus", () => {
    if (document.visibilityState !== "hidden") {
      refreshPlazaStatus();
    }
  });
})();
