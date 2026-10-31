(() => {
  const form =
    document.getElementById(
      "adminLoginForm"
    );

  const message =
    document.getElementById(
      "adminLoginMessage"
    );


  form.addEventListener(
    "submit",

    async event => {
      event.preventDefault();


      const username =
        document
          .getElementById(
            "adminUsername"
          )
          .value
          .trim();


      const password =
        document
          .getElementById(
            "adminPassword"
          )
          .value;


      message.textContent =
        "로그인 확인 중...";


      try {
        await HackathonAPI.adminLogin(
          username,
          password
        );


        location.href =
          "/admin/dashboard";
      } catch (error) {
        message.textContent =
          error.message;
      }
    }
  );
})();