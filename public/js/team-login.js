(() => {
  const form =
    document.getElementById(
      "teamLoginForm"
    );

  const message =
    document.getElementById(
      "teamLoginMessage"
    );

  const submitButton =
    form.querySelector(
      'button[type="submit"]'
    );


  form.addEventListener(
    "submit",
    async event => {
      event.preventDefault();


      const teamNumber =
        Number(
          document
            .getElementById(
              "teamNumber"
            )
            .value
        );

      const accessCode =
        document
          .getElementById(
            "teamCode"
          )
          .value
          .trim();


      if (
        !Number.isInteger(
          teamNumber
        ) ||
        teamNumber < 1 ||
        !accessCode
      ) {
        message.textContent =
          "팀 번호와 접속 코드를 모두 입력하세요.";

        return;
      }


      message.textContent =
        "로그인 확인 중...";

      submitButton.disabled =
        true;


      try {
        await window
          .HackathonAPI
          .teamLogin(
            teamNumber,
            accessCode
          );


        location.href =
          "/team/dashboard";
      } catch (error) {
        message.textContent =
          error.message ||
          "팀 로그인에 실패했습니다.";
      } finally {
        submitButton.disabled =
          false;
      }
    }
  );
})();
